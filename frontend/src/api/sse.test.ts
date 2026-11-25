import { describe, expect, it } from 'vitest'
import { consumeSseBuffer, isIgnorableEvent, normalizeEvent } from './sse'

describe('consumeSseBuffer', () => {
  it('keeps an incomplete frame in the tail', () => {
    const first = consumeSseBuffer('data: {"type":"step_started","t":1,\n\n')
    expect(first.frames).toHaveLength(1)
    expect(first.rest).toBe('')

    const second = consumeSseBuffer('data: "pose"}\n\ndata: {"type":"error","message":"x"}\n\n')
    expect(second.frames).toHaveLength(2)
    expect(second.rest).toBe('')
  })

  it('handles CRLF, comments and event names', () => {
    const { frames, rest } = consumeSseBuffer(
      ': keepalive\r\nevent: step_completed\r\ndata: {"t":1}\r\n\r\ndata: [DONE]\r\n\r\n',
    )
    expect(rest).toBe('')
    expect(frames).toEqual([
      { event: 'step_completed', data: '{"t":1}' },
      { event: undefined, data: '[DONE]' },
    ])
  })

  it('accepts newline-delimited JSON without a data prefix', () => {
    const { frames } = consumeSseBuffer('{"type":"error","message":"bad"}\n\n')
    expect(frames[0].data).toBe('{"type":"error","message":"bad"}')
  })
})

describe('normalizeEvent', () => {
  it('passes through typed contract events', () => {
    expect(normalizeEvent({ type: 'step_started', t: 1, pose: { yaw: 0, pitch: 0 } })).toEqual({
      type: 'step_started',
      t: 1,
      pose: { yaw: 0, pitch: 0 },
    })
  })

  it('maps shorthand step, result and message shapes', () => {
    expect(normalizeEvent({ step: { t: 2, pose: { yaw: 1, pitch: 0 } } })).toMatchObject({
      type: 'step_completed',
    })
    expect(normalizeEvent({ result: { status: 'submitted' } })).toMatchObject({
      type: 'episode_finished',
    })
    expect(normalizeEvent({ message: 'model failed' })).toEqual({
      type: 'error',
      message: 'model failed',
    })
  })

  it('maps the Kaggle backend event names', () => {
    expect(normalizeEvent({ event: 'step', step: { t: 1, pose: { yaw: 0, pitch: 0 } } })).toEqual({
      type: 'step_completed',
      step: { t: 1, pose: { yaw: 0, pitch: 0 } },
    })
    expect(
      normalizeEvent({ event: 'episode_finished', final: { yaw: 285, pitch: -5 } }),
    ).toEqual({
      type: 'episode_finished',
      result: {
        status: 'submitted',
        final: { yaw: 285, pitch: -5 },
        success: null,
        error: null,
      },
    })
    expect(normalizeEvent({ event: 'error', message: 'Parse failed' })).toEqual({
      type: 'error',
      message: 'Parse failed',
    })
    expect(isIgnorableEvent({ event: 'thinking', t: 1 })).toBe(true)
    expect(normalizeEvent({ event: 'thinking', t: 1 })).toBeNull()
  })

  it('rejects unknown payloads', () => {
    expect(normalizeEvent(null)).toBeNull()
    expect(normalizeEvent('oops')).toBeNull()
    expect(normalizeEvent({ type: 'unknown' })).toBeNull()
    expect(normalizeEvent({ hello: 'world' })).toBeNull()
  })
})
