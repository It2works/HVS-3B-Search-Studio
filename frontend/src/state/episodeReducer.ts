/** Pure state machine for the live prototype stream. */

import type { ModelId, Result, RunFile, SseEvent, Step, Task } from '../api/types'

export type ConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'streaming'
  | 'reconnecting'
  | 'closed'

export interface EpisodeState {
  run: RunFile | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  currentStep: number
  playing: boolean
  result: Result | null
  episodeId: string | null
  live: boolean
  connState: ConnectionPhase
}

export type EpisodeAction =
  | { type: 'LOAD_START' }
  | {
      type: 'RUN_STARTED'
      request: { task: Task; instruction: string; model: ModelId }
      panoBase64?: string
    }
  | { type: 'LOAD_SUCCESS'; run: RunFile }
  | { type: 'LOAD_ERROR'; error: string }
  | { type: 'STREAM_START'; episodeId: string }
  | { type: 'STREAM_STATE'; connState: ConnectionPhase }
  | { type: 'STREAM_ERROR'; error: string }
  | { type: 'SELECT_STEP'; t: number }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'SET_PLAYING'; playing: boolean }
  | { type: 'EVENT'; event: SseEvent }
  | { type: 'RESET' }

export const initialEpisodeState: EpisodeState = {
  run: null,
  status: 'idle',
  error: null,
  currentStep: 0,
  playing: false,
  result: null,
  episodeId: null,
  live: false,
  connState: 'idle',
}

/** Display-only skeleton: streamed steps fill it; a real episode_started replaces it. */
function prototypeRun(
  request: { task: Task; instruction: string; model: ModelId },
  panoBase64?: string,
): RunFile {
  return {
    id: 'live-prototype',
    created_at: new Date().toISOString(),
    model: request.model,
    task: request.task,
    instruction: request.instruction,
    pano: { id: 'pano-live', width: 4096, height: 2048, file: panoBase64 ?? '' },
    config: {
      fov: 90,
      view_px: 448,
      max_steps: 8,
      context_turns: 0,
      start: { yaw: 0, pitch: 0 },
      prompt_sha: '',
    },
    ground_truth: null,
    steps: [],
    result: { status: 'error', final: null, success: null, error: null },
  }
}

function lastStep(run: RunFile | null): number {
  if (!run || run.steps.length === 0) return 0
  return run.steps[run.steps.length - 1].t
}

function clampStep(run: RunFile | null, t: number): number {
  if (!run) return 0
  const max = lastStep(run)
  if (!Number.isFinite(t)) return 0
  return Math.min(max, Math.max(0, Math.trunc(t)))
}

/** Keep the inline data URI from the prototype's step event in run-file state. */
function withImageUrl(step: Step): Step {
  const copy: Step = { ...step }
  if (step.image_url) copy.image_url = step.image_url
  return copy
}

function upsertStep(steps: Step[], step: Step): Step[] {
  const incoming = withImageUrl(step)
  const index = steps.findIndex((item) => item.t === incoming.t)
  if (index === -1) return [...steps, incoming]
  const next = steps.slice()
  next[index] = incoming
  return next
}

export function episodeReducer(state: EpisodeState, action: EpisodeAction): EpisodeState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...initialEpisodeState, status: 'loading' }

    case 'RUN_STARTED':
      return {
        ...initialEpisodeState,
        run: prototypeRun(action.request, action.panoBase64),
        status: 'ready',
        episodeId: 'live-prototype',
        live: true,
        connState: 'streaming',
      }

    case 'LOAD_SUCCESS':
      return {
        ...initialEpisodeState,
        run: action.run,
        status: 'ready',
        currentStep: lastStep(action.run),
        result: action.run.result,
      }

    case 'LOAD_ERROR':
      return { ...state, status: 'error', error: action.error, playing: false }

    case 'STREAM_START':
      return {
        ...initialEpisodeState,
        status: 'loading',
        episodeId: action.episodeId,
        live: true,
        connState: 'connecting',
      }

    case 'STREAM_STATE':
      return { ...state, connState: action.connState }

    case 'STREAM_ERROR':
      return {
        ...state,
        error: action.error,
        live: false,
        connState: 'closed',
        playing: false,
        status: state.run ? state.status : 'error',
      }

    case 'SELECT_STEP':
      return { ...state, currentStep: clampStep(state.run, action.t) }

    case 'NEXT_STEP':
      return { ...state, currentStep: clampStep(state.run, state.currentStep + 1) }

    case 'PREV_STEP':
      return { ...state, currentStep: clampStep(state.run, state.currentStep - 1) }

    case 'SET_PLAYING':
      return { ...state, playing: action.playing }

    case 'EVENT': {
      const event = action.event
      if (event.type === 'episode_started') {
        return {
          ...initialEpisodeState,
          run: event.run,
          status: 'ready',
          episodeId: state.episodeId ?? event.episode_id,
          live: state.live,
          connState: state.live ? state.connState : 'idle',
        }
      }
      if (event.type === 'step_completed') {
        if (!state.run) return state
        return {
          ...state,
          run: { ...state.run, steps: upsertStep(state.run.steps, event.step) },
          currentStep: event.step.t,
        }
      }
      if (event.type === 'episode_finished') {
        return {
          ...state,
          result: event.result,
          playing: false,
          live: false,
          connState: 'closed',
        }
      }
      if (event.type === 'error') {
        return {
          ...state,
          error: event.message,
          playing: false,
          live: false,
          connState: 'closed',
        }
      }
      return state // step_started has no durable state
    }

    case 'RESET':
      return initialEpisodeState

    default:
      return state
  }
}
