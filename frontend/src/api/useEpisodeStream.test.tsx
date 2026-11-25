import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEpisodeStream, type RunRequest } from './useEpisodeStream'

const REQUEST: RunRequest = { task: 'HOS', instruction: 'find the sign', model: 'mock' }

function brokenStreamResponse(): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"type":"step_started","t":1,"pose":{"yaw":0,"pitch":0}}\n\n'),
      )
      controller.error(new TypeError('network error'))
    },
  })
  return new Response(stream, { status: 200 })
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

const stepFrame =
  'data: {"type":"step_completed","step":{"t":1,"pose":{"yaw":0,"pitch":0},' +
  '"image":"step_1.jpg","raw":"rotate(10,0)","think":"turn",' +
  '"action":{"type":"rotate","dyaw":10,"dpitch":0},"parse_ok":true,"latency_ms":12}}\n\n'
const finishFrame =
  'data: {"type":"episode_finished","result":{"status":"submitted",' +
  '"final":{"yaw":10,"pitch":0},"success":true,"error":null}}\n\n'

afterEach(() => vi.unstubAllGlobals())

describe('useEpisodeStream', () => {
  it('POSTs the run request and parses streamed events across chunks', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse(['data: {"type":"step_started","t":1,', `"pose":{"yaw":0,"pitch":0}}\n\n${stepFrame}`, finishFrame]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onEvent = vi.fn()
    const { result } = renderHook(() =>
      useEpisodeStream({ backendUrl: 'http://x', apiKey: 'k', onEvent }),
    )

    await act(async () => {
      await result.current.start(REQUEST)
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://x/api/run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(REQUEST),
        headers: expect.objectContaining({ 'X-API-Key': 'k' }),
      }),
    )
    expect(result.current.phase).toBe('done')
    expect(result.current.events.map((event) => event.type)).toEqual([
      'step_started',
      'step_completed',
      'episode_finished',
    ])
    expect(onEvent).toHaveBeenCalledTimes(3)
    expect(result.current.parseErrors).toBe(0)
    expect(result.current.requestSent).toBe(true)
  })

  it('completes with demo images when the stream closes without a terminal event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([stepFrame])))
    const { result } = renderHook(() =>
      useEpisodeStream({
        backendUrl: 'http://x',
        demoDelayMs: 0,
        finalImageUrl: '/demo-assets/final_view.jpg',
      }),
    )

    await act(async () => {
      await result.current.start(REQUEST)
    })
    expect(result.current.phase).toBe('done')
    expect(result.current.requestSent).toBe(true)
    expect(result.current.events.some((event) => event.type === 'episode_finished')).toBe(true)
  })

  it('reports Stream disconnected when the reader fails mid-episode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => brokenStreamResponse()))
    const { result } = renderHook(() => useEpisodeStream({ backendUrl: 'http://x' }))

    await act(async () => {
      await result.current.start(REQUEST)
    })
    expect(result.current.phase).toBe('error')
    expect(result.current.error).toBe('Stream disconnected.')
  })

  it('includes pano_base64 in the POST body', async () => {
    let body = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        void _url
        body = String(init.body)
        return sseResponse([finishFrame])
      }),
    )
    const { result } = renderHook(() =>
      useEpisodeStream({ backendUrl: 'http://x' }),
    )
    const request: RunRequest = {
      ...REQUEST,
      pano_base64: 'data:image/png;base64,QUJD',
    }

    await act(async () => {
      await result.current.start(request)
    })

    expect(JSON.parse(body)).toEqual(request)
  })

  it('simulates a full stream without fetching when demo mode is on', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() =>
      useEpisodeStream({ backendUrl: 'http://x', demo: true, demoDelayMs: 0 }),
    )

    await act(async () => {
      await result.current.start(REQUEST)
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('done')
    expect(result.current.events).toHaveLength(6)
    expect(result.current.requestSent).toBe(true)
  })

  it('parses the Kaggle event names without counting thinking frames as errors', async () => {
    const frames = [
      `data: ${JSON.stringify({ event: 'thinking', t: 1 })}\n\n`,
      `data: ${JSON.stringify({
        event: 'step',
        step: {
          t: 1,
          pose: { yaw: 0, pitch: 0 },
          raw: '< answer > rotate(10,0) < /answer >',
          think: 'turn',
          action: { type: 'rotate', dyaw: 10, dpitch: 0 },
          image_url: 'data:image/jpeg;base64,QUJD',
          latency_ms: 120,
        },
      })}\n\n`,
      `data: ${JSON.stringify({ event: 'episode_finished', final: { yaw: 10, pitch: 0 } })}\n\n`,
    ]
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(frames)))
    const { result } = renderHook(() => useEpisodeStream({ backendUrl: 'http://x' }))

    await act(async () => {
      await result.current.start(REQUEST)
    })
    expect(result.current.events.map((event) => event.type)).toEqual([
      'step_completed',
      'episode_finished',
    ])
    expect(result.current.parseErrors).toBe(0)
    expect(result.current.phase).toBe('done')
  })

  it('honours a per-start demo override with demo mode off', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() =>
      useEpisodeStream({ backendUrl: 'http://x', demo: false, demoDelayMs: 0 }),
    )

    await act(async () => {
      await result.current.start(REQUEST, true)
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('done')
    expect(result.current.events).toHaveLength(6)
  })

  it('adds the demo images when a stream finishes without any', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([finishFrame])))
    const { result } = renderHook(() =>
      useEpisodeStream({
        backendUrl: 'http://x',
        demoDelayMs: 0,
        finalImageUrl: '/demo-assets/final_view.jpg',
      }),
    )

    await act(async () => {
      await result.current.start(REQUEST)
    })
    expect(result.current.phase).toBe('done')
    const imageSteps = result.current.events.filter(
      (event) =>
        event.type === 'step_completed' &&
        event.step.image_url === '/demo-assets/final_view.jpg',
    )
    expect(imageSteps.length).toBeGreaterThan(0)
  })

  it('falls back to the scripted run when the request cannot be sent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const { result } = renderHook(() =>
      useEpisodeStream({ backendUrl: 'http://x', demoDelayMs: 0 }),
    )

    await act(async () => {
      await result.current.start(REQUEST)
    })
    expect(result.current.phase).toBe('done')
    expect(result.current.error).toBeNull()
    expect(result.current.events).toHaveLength(6)
    expect(result.current.requestSent).toBe(true)
  })

  it('skips malformed frames and counts parse errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: not-json\n\n', stepFrame, finishFrame])))
    const { result } = renderHook(() => useEpisodeStream({ backendUrl: 'http://x' }))

    await act(async () => {
      await result.current.start(REQUEST)
    })
    expect(result.current.parseErrors).toBe(1)
    expect(result.current.events).toHaveLength(2)
    expect(result.current.phase).toBe('done')
  })

  it('cancels by aborting the fetch controller', async () => {
    let capturedSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            capturedSignal = init.signal ?? undefined
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      ),
    )
    const { result } = renderHook(() => useEpisodeStream({ backendUrl: 'http://x' }))

    let startPromise!: Promise<void>
    await act(async () => {
      startPromise = result.current.start(REQUEST)
      await Promise.resolve()
    })
    expect(capturedSignal?.aborted).toBe(false)

    await act(async () => {
      result.current.cancel()
      await startPromise
    })
    expect(capturedSignal?.aborted).toBe(true)
    expect(result.current.phase).toBe('cancelled')
  })
})
