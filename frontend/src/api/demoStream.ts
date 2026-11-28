/** Browser-only scripted stream so the app can be demoed with no backend. */

import { normalizeYaw, shortestYawDelta } from '../state/playback'
import type {
  Pose,
  RotateAction,
  RunFile,
  SseEvent,
  Step,
  SubmitAction,
} from './types'

export interface DemoRequest {
  task: 'HOS' | 'HPS'
  instruction: string
  model: string
}

interface DemoScenario {
  key: string
  match?: RegExp
  yaw: number
  pitch: number
  thoughts: [string, string, string, string]
  /** null means the simulated scene has no ground truth for this target. */
  success: boolean | null
  finalImage?: boolean
}

/**
 * The demo panorama is a bridge in Zaragoza. These are the targets that are
 * actually in the frame, so a demo run can honour the instruction instead of
 * always replaying the bus.
 */
const TARGETS: DemoScenario[] = [
  {
    key: 'bus',
    match: /\b(bus|coach|minibus)\b/i,
    yaw: 90,
    pitch: 0,
    success: true,
    finalImage: true,
    thoughts: [
      'Starting on the bridge. The view runs down the river with the cathedral on the left ' +
        'and no bus in sight. I will sweep left along the bridge to check the far bank.',
      'Mostly water, trees and distant rooftops. Still nothing that looks like a bus. ' +
        'Continuing the sweep to the left.',
      'This is the far end of the bridge behind the start. No bus here either. One more ' +
        'turn should bring the street side into view.',
      'There it is. A red bus parked on the right side of the bridge, close to the centre ' +
        'of the frame. Submitting this heading.',
    ],
  },
  {
    key: 'cathedral',
    match: /\b(cathedral|church|basilica|seo|tower|spire|steeple)\b/i,
    yaw: 212,
    pitch: 8,
    success: true,
    thoughts: [
      'Starting on the bridge. The old town should be on the far bank to the left. ' +
        'Sweeping left to find the cathedral.',
      'The river and the rooftops are opening up. No towers yet — continuing the sweep.',
      'The skyline is nearly behind me. One more turn to the left should put the old town in view.',
      'There it is. The cathedral towers rise above the far bank, left of the river. ' +
        'Submitting this heading.',
    ],
  },
  {
    key: 'river',
    match: /\b(river|water|ebro|stream|channel)\b/i,
    yaw: 235,
    pitch: -16,
    success: true,
    thoughts: [
      'Starting on the bridge. The river should run below the left side of the deck. ' +
        'Sweeping left and down to find the water.',
      'The bank and the trees are in view, but I want the channel itself. Continuing left.',
      'The water is below the bridge here. One more turn to line up the river.',
      'There it is. The river running under the bridge with the far bank behind it. ' +
        'Submitting this heading.',
    ],
  },
  {
    key: 'bridge',
    match: /\b(bridge|arch|arches|viaduct)\b/i,
    yaw: 129,
    pitch: -8,
    success: true,
    thoughts: [
      'Starting on the bridge. The old stone arches should be behind me on the right. ' +
        'Sweeping right to find them.',
      'The street and the bus are in view. No arches yet — continuing the sweep.',
      'The far end of the deck is coming round. One more turn to the right.',
      'There they are. The stone arches carrying the road across the river. Submitting this heading.',
    ],
  },
  {
    key: 'sun',
    match: /\b(sun|sunlight|sky|clouds?)\b/i,
    yaw: 17,
    pitch: 19,
    success: true,
    thoughts: [
      'Starting on the bridge. The sun is high and diffused behind the clouds. ' +
        'Sweeping round and tilting up to scan the sky.',
      'The clouds are bright but I have not found the disc yet. Continuing the sweep.',
      'The sky is brightest over the bridge ahead. One more turn to centre it.',
      'There it is. The sun is behind the thin cloud, high above the bridge. ' +
        'Submitting this heading.',
    ],
  },
]

const LEAD_VERB =
  /^(please\s+)?(find|locate|look for|search for|where is|where's|spot|show me)\s+/i

/** "Find the sun" → "the sun", so an unknown target can still be named. */
function targetPhrase(instruction: string): string {
  const cleaned = instruction.trim().replace(/[.!?]+$/, '')
  const phrase = cleaned.replace(LEAD_VERB, '').trim()
  return phrase || 'the target'
}

function unknownScenario(instruction: string): DemoScenario {
  const phrase = targetPhrase(instruction)
  return {
    key: 'unknown',
    yaw: 270,
    pitch: 0,
    success: null,
    thoughts: [
      `Starting on the bridge. I will sweep the whole scene looking for ${phrase}.`,
      'Nothing on this side. Continuing the sweep.',
      `Still nothing that matches ${phrase}. Finishing the circle.`,
      `I swept the full scene and did not find ${phrase}. Submitting my best guess so the run ends cleanly.`,
    ],
  }
}

function scenarioFor(instruction: string): DemoScenario {
  return TARGETS.find((target) => target.match?.test(instruction)) ?? unknownScenario(instruction)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Four stops on the way to the target: three turns, then the pose the model
 * submits from. Targets close to the start are approached the long way round
 * so the head still performs a full sweep.
 */
function routeFor(yaw: number, pitch: number): Pose[] {
  let delta = shortestYawDelta(0, yaw)
  if (Math.abs(delta) < 100) delta -= Math.sign(delta) * 360
  const yaws = [0, delta / 3, (delta * 2) / 3, delta]
  return yaws.map((value, index) => ({
    yaw: index === yaws.length - 1 ? normalizeYaw(yaw) : normalizeYaw(round1(value)),
    pitch: index === yaws.length - 1 ? pitch : 0,
  }))
}

function actionFor(
  pose: Pose,
  next: Pose | null,
  target: Pose,
): RotateAction | SubmitAction {
  if (!next) {
    return { type: 'submit', yaw: target.yaw, pitch: target.pitch }
  }
  return {
    type: 'rotate',
    dyaw: round1(shortestYawDelta(pose.yaw, next.yaw)),
    dpitch: round1(next.pitch - pose.pitch),
  }
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
  return `${import.meta.env.BASE_URL}demo-assets/panorama.jpg`
}

export function demoEvents(
  request: DemoRequest,
  finalImageUrl?: string,
): { run: RunFile; events: SseEvent[] } {
  const scenario = scenarioFor(request.instruction)
  const target: Pose = { yaw: scenario.yaw, pitch: scenario.pitch }
  const route = routeFor(scenario.yaw, scenario.pitch)
  const groundTruth = scenario.success === null ? null : target

  const run: RunFile = {
    id: 'ep_demo_local',
    created_at: new Date().toISOString(),
    model: request.model as RunFile['model'],
    task: request.task,
    instruction: request.instruction,
    pano: { id: 'pano_demo', width: 1632, height: 816, file: demoPanorama() },
    config: {
      fov: 90,
      view_px: 448,
      max_steps: 8,
      context_turns: 2,
      start: { yaw: 0, pitch: 0 },
      prompt_sha: 'demo',
    },
    ground_truth: groundTruth,
    steps: [],
    result: { status: 'error', final: null, success: null, error: null },
  }

  const events: SseEvent[] = [
    { type: 'episode_started', episode_id: run.id, run: { ...run } },
  ]

  route.forEach((pose, index) => {
    const t = index + 1
    const next = route[index + 1] ?? null
    const action = actionFor(pose, next, target)
    const think = scenario.thoughts[index]
    const answer =
      action.type === 'rotate'
        ? `rotate(${action.dyaw},${action.dpitch})`
        : `submit(${action.yaw},${action.pitch})`
    events.push({ type: 'step_started', t, pose })
    const step: Step = {
      t,
      pose,
      image: `step_${t}.jpg`,
      image_url:
        scenario.finalImage && !next && finalImageUrl ? finalImageUrl : demoFrame(t),
      raw: ` thinking${think}</think><answer>${answer}</answer>`,
      think,
      action,
      parse_ok: true,
      latency_ms: 640 + index * 80,
    }
    events.push({ type: 'step_completed', step })
  })

  events.push({
    type: 'episode_finished',
    result: {
      status: 'submitted',
      final: target,
      success: scenario.success,
      error: null,
    },
  })
  return { run, events }
}
