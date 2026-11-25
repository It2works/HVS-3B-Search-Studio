/** Browser-only scripted stream so the app can be demoed with no backend. */

import type { RunFile, SseEvent, Step } from './types'

export interface DemoRequest {
  task: 'HOS' | 'HPS'
  instruction: string
  model: string
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

export function demoFrame(t: number): string {
  const colors = ['#2b6f63', '#b84d27', '#8d3241']
  const color = colors[(t - 1) % colors.length]
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="448" height="448">' +
    '<rect width="448" height="448" fill="#142024"/>' +
    `<circle cx="224" cy="224" r="150" fill="${color}" opacity="0.65"/>` +
    '<line x1="224" y1="40" x2="224" y2="408" stroke="#e7e8e1" stroke-width="2" opacity="0.5"/>' +
    `<text x="224" y="240" text-anchor="middle" fill="#f2f2ec" font-size="56">${t}</text>` +
    '</svg>'
  return svgDataUri(svg)
}

export function demoPanorama(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512">' +
    '<rect width="1024" height="512" fill="#16272c"/>' +
    '<line x1="512" y1="0" x2="512" y2="512" stroke="#4d646a" stroke-width="2"/>' +
    '<circle cx="853" cy="256" r="28" fill="#b84d27"/>' +
    '</svg>'
  return svgDataUri(svg)
}

export function demoEvents(
  request: DemoRequest,
  finalImageUrl?: string,
): { run: RunFile; events: SseEvent[] } {
  const run: RunFile = {
    id: 'ep_demo_local',
    created_at: new Date().toISOString(),
    model: request.model as RunFile['model'],
    task: request.task,
    instruction: request.instruction,
    pano: { id: 'pano_demo', width: 1024, height: 512, file: demoPanorama() },
    config: {
      fov: 90,
      view_px: 448,
      max_steps: 8,
      context_turns: 2,
      start: { yaw: 0, pitch: 0 },
      prompt_sha: 'demo',
    },
    ground_truth: null,
    steps: [],
    result: { status: 'error', final: null, success: null, error: null },
  }

  // Mirrors the Kaggle run: rotate 90 degrees, then submit at yaw 90.
  const actions = [
    {
      pose: { yaw: 0, pitch: 0 },
      action: { type: 'rotate' as const, dyaw: 90, dpitch: 0 },
      think:
        'The current view shows an outdoor area with a bridge and people walking along it. ' +
        'There are buildings in the background, but no visible signs of a bus. Since the ' +
        'task is to find a bus, and there are no clear indicators or buses in this view, ' +
        'it makes sense to explore further. Rotating 90 degrees mig',
    },
    {
      pose: { yaw: 90, pitch: 0 },
      action: { type: 'submit' as const, yaw: 90, pitch: 0 },
      think:
        'The current view shows a street with a red bus parked on the side of the road. ' +
        'The bus is clearly visible and located near the center of the image. Since the ' +
        'task is to find a bus, and it is already centered in the view, it confirms the ' +
        'target has been found. Therefore, the next action is to submit(',
    },
  ]
  const events: SseEvent[] = [
    { type: 'episode_started', episode_id: run.id, run: { ...run } },
  ]

  actions.forEach((entry, index) => {
    const t = index + 1
    const answer =
      entry.action.type === 'rotate'
        ? `rotate(${entry.action.dyaw},${entry.action.dpitch})`
        : `submit(${entry.action.yaw},${entry.action.pitch})`
    events.push({ type: 'step_started', t, pose: entry.pose })
    const step: Step = {
      t,
      pose: entry.pose,
      image: `step_${t}.jpg`,
      image_url:
        index === actions.length - 1 && finalImageUrl
          ? finalImageUrl
          : demoFrame(t),
      raw: `< think > ${entry.think} < /think > < answer > ${answer} < /answer >`,
      think: entry.think,
      action: entry.action,
      parse_ok: true,
      latency_ms: 640 + index * 80,
    }
    events.push({ type: 'step_completed', step })
  })

  events.push({
    type: 'episode_finished',
    result: { status: 'submitted', final: { yaw: 90, pitch: 0 }, success: true, error: null },
  })
  return { run, events }
}
