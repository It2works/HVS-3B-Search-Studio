import { describe, expect, it } from 'vitest'
import { demoEvents, demoFrame, demoPanorama } from './demoStream'

describe('demoStream', () => {
  it('uses the bundled 360 panorama and inline frames for the sweep', () => {
    expect(demoPanorama()).toBe('/demo-assets/panorama.jpg')
    expect(demoFrame(1)).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('uses the supplied final image for the last step', () => {
    const { events } = demoEvents(
      { task: 'HOS', instruction: 'Find the bus', model: 'hvs-3b-sft' },
      '/demo-assets/final_view.jpg',
    )
    const steps = events.filter((event) => event.type === 'step_completed')
    expect(steps).toHaveLength(4)
    expect(steps[0].type === 'step_completed' && steps[0].step.image_url).toMatch(
      /^data:image/,
    )
    expect(steps[3].type === 'step_completed' && steps[3].step.image_url).toBe(
      '/demo-assets/final_view.jpg',
    )
  })

  it('scripts a complete contract event stream with latency and images', () => {
    const { run, events } = demoEvents({
      task: 'HOS',
      instruction: 'Find the bus',
      model: 'hvs-3b-sft',
    })
    expect(run.pano.file).toBe('/demo-assets/panorama.jpg')
    expect(run.pano.width).toBe(1632)
    expect(run.config.max_steps).toBe(8)
    expect(events.map((event) => event.type)).toEqual([
      'episode_started',
      'step_started',
      'step_completed',
      'step_started',
      'step_completed',
      'step_started',
      'step_completed',
      'step_started',
      'step_completed',
      'episode_finished',
    ])
    for (const event of events) {
      if (event.type === 'step_completed') {
        expect(event.step.image_url).toMatch(/^(data:image|\/demo-assets\/)/)
        expect(typeof event.step.latency_ms).toBe('number')
      }
    }
    const steps = events.filter((event) => event.type === 'step_completed')
    const thinks = steps.map((event) =>
      event.type === 'step_completed' ? event.step.think : '',
    )
    expect(thinks[0]).toMatch(/sweep left/)
    expect(thinks[3]).toMatch(/Submitting this heading/)
    expect(
      steps.map((event) =>
        event.type === 'step_completed' ? event.step.pose : null,
      ),
    ).toEqual([
      { yaw: 0, pitch: 0 },
      { yaw: 270, pitch: 0 },
      { yaw: 180, pitch: 0 },
      { yaw: 90, pitch: 0 },
    ])
    expect(
      steps.map((event) => (event.type === 'step_completed' ? event.step.action : null)),
    ).toEqual([
      { type: 'rotate', dyaw: -90, dpitch: 0 },
      { type: 'rotate', dyaw: -90, dpitch: 0 },
      { type: 'rotate', dyaw: -90, dpitch: 0 },
      { type: 'submit', yaw: 90, pitch: 0 },
    ])
    expect(events[events.length - 1]).toMatchObject({
      type: 'episode_finished',
      result: { status: 'submitted', success: true, final: { yaw: 90, pitch: 0 } },
    })
  })

  it('follows a different instruction to the sun instead of the bus', () => {
    const { run, events } = demoEvents({
      task: 'HOS',
      instruction: 'Find the sun',
      model: 'hvs-3b-sft',
    })
    const steps = events.filter((event) => event.type === 'step_completed')
    const thinks = steps.map((event) =>
      event.type === 'step_completed' ? event.step.think : '',
    )
    expect(thinks[0]).toMatch(/tilting up to scan the sky/)
    expect(thinks.join(' ')).not.toMatch(/red bus/)
    expect(steps[steps.length - 1].type === 'step_completed' && steps[steps.length - 1].step.pose).toEqual(
      { yaw: 17, pitch: 19 },
    )
    expect(run.ground_truth).toEqual({ yaw: 17, pitch: 19 })
    expect(events[events.length - 1]).toMatchObject({
      type: 'episode_finished',
      result: { status: 'submitted', success: true, final: { yaw: 17, pitch: 19 } },
    })
  })

  it('sweeps the full circle and stays unscored for an unknown target', () => {
    const { run, events } = demoEvents({
      task: 'HOS',
      instruction: 'Find the unicorn',
      model: 'hvs-3b-sft',
    })
    const steps = events.filter((event) => event.type === 'step_completed')
    const thinks = steps.map((event) =>
      event.type === 'step_completed' ? event.step.think : '',
    )
    expect(thinks.join(' ')).toMatch(/the unicorn/)
    expect(steps[steps.length - 1].type === 'step_completed' && steps[steps.length - 1].step.pose).toEqual(
      { yaw: 270, pitch: 0 },
    )
    expect(run.ground_truth).toBeNull()
    expect(events[events.length - 1]).toMatchObject({
      type: 'episode_finished',
      result: { status: 'submitted', success: null, final: { yaw: 270, pitch: 0 } },
    })
  })
})
