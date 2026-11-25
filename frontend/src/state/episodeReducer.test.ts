import { describe, expect, it } from 'vitest'
import type { RunFile, SseEvent, Step } from '../api/types'
import { episodeReducer, initialEpisodeState } from './episodeReducer'

function step(t: number): Step {
  return {
    t,
    pose: { yaw: t * 10, pitch: 0 },
    image: `step_${t}.jpg`,
    raw: `<answer>rotate(${t * 10},0)</answer>`,
    think: 'reasoning',
    action: { type: 'rotate', dyaw: t * 10, dpitch: 0 },
    parse_ok: true,
    latency_ms: t * 100,
  }
}

function run(steps: Step[] = [step(1), step(2)]): RunFile {
  return {
    id: 'ep_test',
    created_at: '2026-11-21T00:00:00Z',
    model: 'mock',
    task: 'HOS',
    instruction: 'find the sign',
    pano: { id: 'pano_x', width: 1024, height: 512, file: 'panorama.jpg' },
    config: {
      fov: 90,
      view_px: 448,
      max_steps: 8,
      context_turns: 2,
      start: { yaw: 0, pitch: 0 },
      prompt_sha: 'abc',
    },
    ground_truth: null,
    steps,
    result: { status: 'submitted', final: { yaw: 20, pitch: 0 }, success: true, error: null },
  }
}

describe('episodeReducer', () => {
  it('loads a run and selects its last step', () => {
    const state = episodeReducer(initialEpisodeState, { type: 'LOAD_SUCCESS', run: run() })
    expect(state.status).toBe('ready')
    expect(state.currentStep).toBe(2)
    expect(state.result?.status).toBe('submitted')
  })

  it('handles a run with no steps without going negative', () => {
    const state = episodeReducer(initialEpisodeState, { type: 'LOAD_SUCCESS', run: run([]) })
    expect(state.currentStep).toBe(0)
    expect(episodeReducer(state, { type: 'PREV_STEP' }).currentStep).toBe(0)
  })

  it('moves between steps and clamps at both ends', () => {
    const loaded = episodeReducer(initialEpisodeState, { type: 'LOAD_SUCCESS', run: run() })
    expect(episodeReducer(loaded, { type: 'PREV_STEP' }).currentStep).toBe(1)
    const first = episodeReducer(loaded, { type: 'SELECT_STEP', t: 0 })
    expect(first.currentStep).toBe(0)
    expect(episodeReducer(first, { type: 'PREV_STEP' }).currentStep).toBe(0)
    expect(episodeReducer(first, { type: 'NEXT_STEP' }).currentStep).toBe(1)
    const beyond = episodeReducer(loaded, { type: 'SELECT_STEP', t: 99 })
    expect(beyond.currentStep).toBe(2)
    expect(episodeReducer(beyond, { type: 'NEXT_STEP' }).currentStep).toBe(2)
    expect(episodeReducer(loaded, { type: 'SELECT_STEP', t: Number.NaN }).currentStep).toBe(0)
  })

  it('reports load errors and reset', () => {
    const failed = episodeReducer(initialEpisodeState, {
      type: 'LOAD_ERROR',
      error: 'Not found',
    })
    expect(failed.status).toBe('error')
    expect(failed.error).toBe('Not found')
    expect(episodeReducer(failed, { type: 'RESET' })).toEqual(initialEpisodeState)
  })

  it('applies SSE events without mutating the previous state', () => {
    const original = episodeReducer(initialEpisodeState, {
      type: 'LOAD_SUCCESS',
      run: run([]),
    })
    const events: SseEvent[] = [
      { type: 'step_started', t: 1, pose: { yaw: 0, pitch: 0 } },
      { type: 'step_completed', step: step(1) },
      { type: 'step_completed', step: { ...step(1), latency_ms: 999 } },
      {
        type: 'episode_finished',
        result: { status: 'max_steps', final: { yaw: 10, pitch: 0 }, success: null, error: null },
      },
    ]
    let state = original
    for (const event of events) state = episodeReducer(state, { type: 'EVENT', event })
    expect(state.run?.steps).toHaveLength(1)
    expect(state.run?.steps[0].latency_ms).toBe(999)
    expect(state.currentStep).toBe(1)
    expect(state.result?.status).toBe('max_steps')
    expect(original.run?.steps).toHaveLength(0)
  })

  it('keeps state on an error event and clears playing', () => {
    const loaded = episodeReducer(initialEpisodeState, {
      type: 'LOAD_SUCCESS',
      run: run(),
    })
    const playing = episodeReducer(loaded, { type: 'SET_PLAYING', playing: true })
    const errored = episodeReducer(playing, {
      type: 'EVENT',
      event: { type: 'error', message: 'Invalid model output' },
    })
    expect(errored.error).toBe('Invalid model output')
    expect(errored.playing).toBe(false)
    expect(errored.run).toBe(loaded.run)
  })

  it('returns the same object for an unknown action', () => {
    const state = episodeReducer(initialEpisodeState, { type: 'RESET' })
    expect(episodeReducer(state, { type: 'NOPE' } as never)).toBe(state)
  })

  it('creates a display skeleton when a prototype run starts', () => {
    const state = episodeReducer(initialEpisodeState, {
      type: 'RUN_STARTED',
      request: { task: 'HPS', instruction: 'face the sign', model: 'mock' },
    })
    expect(state.live).toBe(true)
    expect(state.connState).toBe('streaming')
    expect(state.run?.task).toBe('HPS')
    expect(state.run?.instruction).toBe('face the sign')
    expect(state.run?.steps).toEqual([])
    expect(state.run?.pano.file).toBe('') // no image until the stream supplies one
  })

  it('keeps the uploaded panorama on the run skeleton', () => {
    const state = episodeReducer(initialEpisodeState, {
      type: 'RUN_STARTED',
      request: { task: 'HOS', instruction: 'go', model: 'mock' },
      panoBase64: 'data:image/jpeg;base64,QUJD',
    })
    expect(state.run?.pano.file).toBe('data:image/jpeg;base64,QUJD')
  })

  it('replaces the skeleton with an authoritative episode_started run', () => {
    let state = episodeReducer(initialEpisodeState, {
      type: 'RUN_STARTED',
      request: { task: 'HOS', instruction: 'go', model: 'mock' },
    })
    state = episodeReducer(state, {
      type: 'EVENT',
      event: {
        type: 'episode_started',
        episode_id: 'ep_real',
        run: { ...run([]), id: 'ep_real' },
      },
    })
    expect(state.run?.id).toBe('ep_real')
    expect(state.live).toBe(true)
  })

  it('tracks a live stream from start through steps to finish', () => {
    let state = episodeReducer(initialEpisodeState, {
      type: 'STREAM_START',
      episodeId: 'ep_live',
    })
    expect(state.live).toBe(true)
    expect(state.connState).toBe('connecting')
    expect(state.episodeId).toBe('ep_live')

    state = episodeReducer(state, { type: 'STREAM_STATE', connState: 'open' })
    state = episodeReducer(state, {
      type: 'EVENT',
      event: { type: 'episode_started', episode_id: 'ep_live', run: run([]) },
    })
    expect(state.run?.steps).toHaveLength(0)
    expect(state.live).toBe(true)

    state = episodeReducer(state, {
      type: 'EVENT',
      event: { type: 'step_completed', step: step(1) },
    })
    expect(state.currentStep).toBe(1)
    expect(state.run?.steps).toHaveLength(1)

    state = episodeReducer(state, {
      type: 'EVENT',
      event: {
        type: 'episode_finished',
        result: { status: 'cancelled', final: { yaw: 10, pitch: 0 }, success: null, error: null },
      },
    })
    expect(state.live).toBe(false)
    expect(state.result?.status).toBe('cancelled')
    expect(state.connState).toBe('closed')
  })

  it('keeps image_url from a step event in run-file state', () => {
    let state = episodeReducer(initialEpisodeState, {
      type: 'RUN_STARTED',
      request: { task: 'HOS', instruction: 'go', model: 'mock' },
    })
    state = episodeReducer(state, {
      type: 'EVENT',
      event: {
        type: 'step_completed',
        step: { ...step(1), image_url: 'data:image/jpeg;base64,QUJD' },
      },
    })
    expect(state.run?.steps[0].image_url).toBe('data:image/jpeg;base64,QUJD')
  })

  it('records a stream failure without discarding accumulated steps', () => {
    let state = episodeReducer(initialEpisodeState, {
      type: 'STREAM_START',
      episodeId: 'ep_live',
    })
    state = episodeReducer(state, {
      type: 'EVENT',
      event: { type: 'episode_started', episode_id: 'ep_live', run: run([]) },
    })
    state = episodeReducer(state, {
      type: 'EVENT',
      event: { type: 'step_completed', step: step(1) },
    })
    state = episodeReducer(state, {
      type: 'EVENT',
      event: { type: 'error', message: 'Model failed' },
    })
    expect(state.error).toBe('Model failed')
    expect(state.live).toBe(false)
    expect(state.run?.steps).toHaveLength(1)

    state = episodeReducer(state, {
      type: 'STREAM_ERROR',
      error: 'Stream closed',
    })
    expect(state.error).toBe('Stream closed')
    expect(state.connState).toBe('closed')
  })
})
