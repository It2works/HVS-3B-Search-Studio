/** Streams the prototype POST /api/run SSE response. Abortable, no EventSource. */

import { useCallback, useRef, useState } from 'react'
import { markBackendReached, markDemoActive } from './connection'
import { demoEvents } from './demoStream'
import { consumeSseBuffer, isIgnorableEvent, normalizeEvent } from './sse'
import type { PrototypeRunRequest, SseEvent } from './types'

export type RunRequest = PrototypeRunRequest

class BackendResponseError extends Error {}

export type StreamPhase = 'idle' | 'connecting' | 'streaming' | 'done' | 'error' | 'cancelled'

export interface EpisodeStreamState {
  phase: StreamPhase
  error: string | null
  requestSent: boolean
  parseErrors: number
  events: SseEvent[]
  start: (request: RunRequest, demoOverride?: boolean) => Promise<void>
  cancel: () => void
  reset: () => void
}

export interface EpisodeStreamOptions {
  backendUrl?: string
  apiKey?: string
  onEvent?: (event: SseEvent) => void
  demo?: boolean
  demoDelayMs?: number
  finalImageUrl?: string
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

const INITIAL: Omit<EpisodeStreamState, 'start' | 'cancel' | 'reset'> = {
  phase: 'idle',
  error: null,
  requestSent: false,
  parseErrors: 0,
  events: [],
}

export function useEpisodeStream(options: EpisodeStreamOptions = {}): EpisodeStreamState {
  const endpoint = `${(options.backendUrl ?? '').replace(/\/+$/, '')}/api/run`
  const apiKey = options.apiKey
  const demo = options.demo ?? false
  const demoDelayMs = options.demoDelayMs ?? 220
  const finalImageUrl = options.finalImageUrl
  const onEventRef = useRef(options.onEvent)
  onEventRef.current = options.onEvent
  const controllerRef = useRef<AbortController | null>(null)
  const requestSentRef = useRef(false)
  const [state, setState] = useState(INITIAL)

  const cancel = useCallback(() => controllerRef.current?.abort(), [])

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setState(INITIAL)
  }, [])

  const start = useCallback(
    async (request: RunRequest, demoOverride?: boolean) => {
      const useDemo = demoOverride ?? demo
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setState({ ...INITIAL, phase: 'connecting' })

      const publish = (event: SseEvent) => {
        setState((current) => ({ ...current, events: [...current.events, event] }))
        onEventRef.current?.(event)
      }

      const appendDemoTail = async (includeStart: boolean) => {
        // Guarantees the demo images exist even if a backend stream was empty.
        markDemoActive()
        const scripted = demoEvents(request, finalImageUrl)
        for (const event of scripted.events) {
          if (event.type === 'step_started') continue
          if (event.type === 'episode_started' && !includeStart) continue
          await delay(demoDelayMs, controller.signal)
          publish(event)
        }
        setState((current) => ({ ...current, phase: 'done', error: null }))
      }

      const playFallback = async () => {
        // No backend required: fall back to the scripted run and keep the UI live.
        markDemoActive()
        requestSentRef.current = true
        setState((current) => ({ ...current, requestSent: true, phase: 'streaming', error: null }))
        const scripted = demoEvents(request, finalImageUrl)
        for (const event of scripted.events) {
          await delay(demoDelayMs, controller.signal)
          publish(event)
        }
        setState((current) => ({ ...current, phase: 'done' }))
      }

      try {
        if (useDemo) {
          markBackendReached()
          await playFallback()
          return
        }

        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (apiKey) headers['X-API-Key'] = apiKey

        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
          signal: controller.signal,
        })
        // The request reached the backend: keep the chip green even if the
        // stream later dies mid-episode.
        requestSentRef.current = true
        markBackendReached()
        setState((current) => ({ ...current, requestSent: true }))
        if (!response.ok) {
          const body = await response.text().catch(() => '')
          throw new BackendResponseError(
            `Backend returned ${response.status}. ${body.slice(0, 180)}`.trim(),
          )
        }
        if (!response.body) {
          throw new BackendResponseError('This browser cannot read the response stream.')
        }

        setState((current) => ({ ...current, phase: 'streaming' }))
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let parseErrors = 0
        let stopped = false
        let completed = false
        let receivedImage = false

        const consumeFrame = (data: string): void => {
          if (data.trim() === '[DONE]') {
            stopped = true
            completed = true
            return
          }
          let parsed: unknown
          try {
            parsed = JSON.parse(data)
          } catch {
            parseErrors += 1
            return
          }
          if (isIgnorableEvent(parsed)) return
          const event = normalizeEvent(parsed)
          if (!event) {
            parseErrors += 1
            return
          }
          if (
            event.type === 'step_completed' &&
            (event.step.image_url || event.step.image)
          ) {
            receivedImage = true
          }
          setState((current) => ({ ...current, events: [...current.events, event] }))
          onEventRef.current?.(event)
          if (event.type === 'episode_finished' || event.type === 'error') {
            stopped = true
            completed = true
          }
        }

        while (!stopped) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const { frames, rest } = consumeSseBuffer(buffer)
          buffer = rest
          for (const frame of frames) {
            consumeFrame(frame.data)
            if (stopped) break
          }
        }
        if (!stopped && buffer.trim()) consumeFrame(buffer)

        if (controller.signal.aborted) {
          setState((current) => ({ ...current, phase: 'cancelled' }))
          return
        }

        if (!completed || !receivedImage) {
          await appendDemoTail(!completed)
          return
        }

        setState((current) => ({
          ...current,
          phase: current.events.some((event) => event.type === 'error') ? 'error' : 'done',
          parseErrors,
        }))
      } catch (cause) {
        if (controller.signal.aborted) {
          setState((current) => ({ ...current, phase: 'cancelled' }))
        } else if (!requestSentRef.current) {
          try {
            await playFallback()
          } catch {
            setState((current) => ({
              ...current,
              phase: controller.signal.aborted ? 'cancelled' : 'error',
              error: 'Stream disconnected.',
            }))
          }
        } else {
          const message =
            cause instanceof BackendResponseError ? cause.message : 'Stream disconnected.'
          setState((current) => ({ ...current, phase: 'error', error: message }))
        }
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null
      }
    },
    [endpoint, apiKey, demo, demoDelayMs, finalImageUrl],
  )

  return { ...state, start, cancel, reset }
}
