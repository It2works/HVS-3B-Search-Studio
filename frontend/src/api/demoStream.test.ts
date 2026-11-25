import { describe, expect, it } from 'vitest'
import { demoEvents, demoFrame, demoPanorama } from './demoStream'

describe('demoStream', () => {
  it('produces inline image data URIs', () => {
    expect(demoFrame(1)).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(demoPanorama()).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('uses the supplied final image for the last step', () => {
    const { events } = demoEvents(
      { task: 'HOS', instruction: 'Find the bus', model: 'hvs-3b-sft' },
      '/demo-assets/final_view.jpg',
    )
    const steps = events.filter((event) => event.type === 'step_completed')
    expect(steps).toHaveLength(2)
    expect(steps[0].type === 'step_completed' && steps[0].step.image_url).toMatch(
      /^data:image/,
    )
    expect(steps[1].type === 'step_completed' && steps[1].step.image_url).toBe(
      '/demo-assets/final_view.jpg',
    )
  })

  it('scripts a complete contract event stream with latency and images', () => {
    const { run, events } = demoEvents({
      task: 'HOS',
      instruction: 'Find the bus',
      model: 'hvs-3b-sft',
    })
    expect(run.pano.file).toMatch(/^data:image/)
    expect(run.config.max_steps).toBe(8)
    expect(events.map((event) => event.type)).toEqual([
      'episode_started',
      'step_started',
      'step_completed',
      'step_started',
      'step_completed',
      'episode_finished',
    ])
    for (const event of events) {
      if (event.type === 'step_completed') {
        expect(event.step.image_url).toMatch(/^data:image/)
        expect(typeof event.step.latency_ms).toBe('number')
      }
    }
    const steps = events.filter((event) => event.type === 'step_completed')
    const thinks = steps.map((event) =>
      event.type === 'step_completed' ? event.step.think : '',
    )
    expect(thinks[0]).toMatch(/Rotating 90 degrees mig$/)
    expect(thinks[1]).toMatch(/submit\($/)
    expect(steps.map((event) => (event.type === 'step_completed' ? event.step.action : null))).toEqual([
      { type: 'rotate', dyaw: 90, dpitch: 0 },
      { type: 'submit', yaw: 90, pitch: 0 },
    ])
    expect(events[events.length - 1]).toMatchObject({
      type: 'episode_finished',
      result: { status: 'submitted', success: true, final: { yaw: 90, pitch: 0 } },
    })
  })
})
