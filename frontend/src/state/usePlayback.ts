/** Performs streamed steps in order: type the thought, then turn the head. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Pose, RunFile, Step } from '../api/types'
import {
  clampPitch,
  easeInOutCubic,
  moveDuration,
  moveForAction,
  normalizeYaw,
  typingDuration,
} from './playback'

export type PlaybackPhase = 'waiting' | 'thinking' | 'resting' | 'moving' | 'idle'

export interface PlaybackState {
  pose: Pose
  phase: PlaybackPhase
  typed: string
  activeStep: Step | null
  done: boolean
  replay: () => void
}

const START: Pose = { yaw: 0, pitch: 0 }

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Runs one sequential performance per episode. The loop polls the run file so
 * steps that arrive mid-performance are picked up without restarting it.
 */
export function usePlayback(run: RunFile | null, finished: boolean): PlaybackState {
  const [pose, setPose] = useState<Pose>(START)
  const [phase, setPhase] = useState<PlaybackPhase>('waiting')
  const [typed, setTyped] = useState('')
  const [activeStep, setActiveStep] = useState<Step | null>(null)
  const [done, setDone] = useState(false)
  const [replayToken, setReplayToken] = useState(0)

  const runRef = useRef(run)
  runRef.current = run
  const finishedRef = useRef(finished)
  finishedRef.current = finished
  const poseRef = useRef<Pose>(START)
  const cancelRef = useRef<(() => void) | null>(null)
  const generationRef = useRef(0)

  const replay = useCallback(() => {
    setReplayToken((value) => value + 1)
  }, [])

  const runKey = run ? `${run.id}:${run.created_at}` : ''

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    let cancelled = false
    const alive = () => !cancelled && generationRef.current === generation
    const reduced = prefersReducedMotion()

    // One cancellable rAF driver for typing, pauses and camera movement.
    function drive(duration: number, onFrame: (progress: number) => void): Promise<void> {
      // A zero-length beat (reduced motion) needs no frame at all.
      if (duration <= 0) {
        onFrame(1)
        return Promise.resolve()
      }
      return new Promise((resolve) => {
        const started = performance.now()
        let frame = 0
        const finish = () => {
          cancelAnimationFrame(frame)
          if (cancelRef.current === finish) cancelRef.current = null
          resolve()
        }
        const step = (now: number) => {
          const progress = Math.min(1, (now - started) / Math.max(1, duration))
          onFrame(progress)
          if (progress < 1) frame = requestAnimationFrame(step)
          else finish()
        }
        cancelRef.current = finish
        frame = requestAnimationFrame(step)
      })
    }

    const start = runRef.current?.config.start ?? START
    const performedSteps = new Set<number>()
    poseRef.current = { ...start }
    setPose({ ...start })
    setPhase('waiting')
    setTyped('')
    setActiveStep(null)
    setDone(false)

    async function perform(step: Step): Promise<void> {
      if (!alive()) return
      setActiveStep(step)
      setPhase('thinking')
      setTyped('')

      if (reduced) {
        setTyped(step.think)
      } else if (step.think) {
        const text = step.think
        await drive(typingDuration(text.length), (progress) => {
          setTyped(text.slice(0, Math.floor(progress * text.length)))
        })
        if (!alive()) return
        setTyped(text)
      }

      if (!alive()) return
      setPhase('resting')
      await drive(reduced ? 0 : 260, () => {})
      if (!alive()) return

      const move = moveForAction(step.action, poseRef.current)
      const degrees = Math.abs(move.yawDelta) + Math.abs(move.pitchDelta)
      if (degrees > 0.01) {
        setPhase('moving')
        const from = { ...poseRef.current }
        await drive(reduced ? 0 : moveDuration(degrees), (progress) => {
          const eased = easeInOutCubic(progress)
          const next = {
            yaw: from.yaw + move.yawDelta * eased,
            pitch: clampPitch(from.pitch + move.pitchDelta * eased),
          }
          poseRef.current = next
          setPose(next)
        })
        if (!alive()) return
        const settled = {
          yaw: normalizeYaw(from.yaw + move.yawDelta),
          pitch: clampPitch(from.pitch + move.pitchDelta),
        }
        poseRef.current = settled
        setPose(settled)
      }

      performedSteps.add(step.t)
      setPhase('idle')
    }

    async function loop(): Promise<void> {
      while (alive()) {
        const steps = runRef.current?.steps ?? []
        const next = steps.find((step) => !performedSteps.has(step.t))
        if (!next) {
          // Only finish once the stream is over: a fast playback must not
          // declare a verdict while steps are still arriving.
          if (finishedRef.current) {
            if (steps.length > 0) {
              setDone(true)
              setPhase('idle')
            }
            return
          }
          await drive(200, () => {})
          continue
        }
        await perform(next)
      }
    }

    void loop()

    return () => {
      cancelled = true
      cancelRef.current?.()
    }
  }, [runKey, replayToken])

  return { pose, phase, typed, activeStep, done, replay }
}
