/** Tolerant SSE parsing for the Kaggle prototype /api/run stream. */

import type { Pose, Result, SseEvent, Step } from './types'

export interface SseFrame {
  event?: string
  data: string
}

/** Split a growing text buffer into complete frames, keeping the partial tail. */
export function consumeSseBuffer(buffer: string): { frames: SseFrame[]; rest: string } {
  const normalized = buffer.replace(/\r\n|\r/g, '\n')
  const parts = normalized.split('\n\n')
  const rest = parts.pop() ?? ''
  const frames: SseFrame[] = []

  for (const part of parts) {
    const lines = part.split('\n').filter((line) => line && !line.startsWith(':'))
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    const eventLine = lines.find((line) => line.startsWith('event:'))
    // Also accept newline-delimited JSON if the prototype omits `data:`.
    const payload = data || (part.trim().startsWith('{') ? part.trim() : '')
    if (payload) frames.push({ event: eventLine?.slice(6).trim(), data: payload })
  }
  return { frames, rest }
}

function eventKind(value: Record<string, unknown>): string | undefined {
  const kind = value.type ?? value.event
  return typeof kind === 'string' ? kind : undefined
}

/** Progress frames carry no durable state and must not count as parse errors. */
export function isIgnorableEvent(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  return eventKind(value as Record<string, unknown>) === 'thinking'
}

/** Map contract events and the Kaggle prototype's `event:` names onto SseEvents. */
export function normalizeEvent(value: unknown): SseEvent | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const kind = eventKind(raw)

  if (kind === 'step_completed' || kind === 'step') {
    if (typeof raw.step === 'object' && raw.step !== null) {
      return { type: 'step_completed', step: raw.step as Step }
    }
    return null
  }
  if (kind === 'step_started' && typeof raw.pose === 'object' && raw.pose !== null) {
    return {
      type: 'step_started',
      t: Number(raw.t),
      pose: raw.pose as Pose,
    }
  }
  if (kind === 'episode_finished') {
    if (typeof raw.result === 'object' && raw.result !== null) {
      return { type: 'episode_finished', result: raw.result as Result }
    }
    // Kaggle backend sends the final pose as `final` instead of `result`.
    if (typeof raw.final === 'object' && raw.final !== null) {
      const result: Result = {
        status: 'submitted',
        final: raw.final as Pose,
        success: null,
        error: null,
      }
      return { type: 'episode_finished', result }
    }
    return null
  }
  if (kind === 'error' && typeof raw.message === 'string') {
    return { type: 'error', message: raw.message }
  }
  if (kind === 'episode_started' && typeof raw.run === 'object' && raw.run !== null) {
    return value as SseEvent
  }
  if (typeof raw.step === 'object' && raw.step !== null) {
    return { type: 'step_completed', step: raw.step as Step }
  }
  if (typeof raw.result === 'object' && raw.result !== null) {
    return { type: 'episode_finished', result: raw.result as Result }
  }
  if (typeof raw.final === 'object' && raw.final !== null) {
    return {
      type: 'episode_finished',
      result: { status: 'submitted', final: raw.final as Pose, success: null, error: null },
    }
  }
  if (typeof raw.message === 'string') {
    return { type: 'error', message: raw.message }
  }
  return null
}
