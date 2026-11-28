/** Pure motion and timing helpers for the robot-head playback. */

import type { Action, Pose } from '../api/types'

export const PITCH_LIMIT = 90

/** Normalize any yaw into ``[0, 360)``. */
export function normalizeYaw(yaw: number): number {
  const wrapped = yaw % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

/** Clamp pitch into ``[-90, 90]`` (straight down .. straight up). */
export function clampPitch(pitch: number): number {
  return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch))
}

/**
 * Signed shortest rotation between two yaws, in ``(-180, 180]``.
 * Exactly opposite headings resolve to ``-180``.
 */
export function shortestYawDelta(from: number, to: number): number {
  const delta = ((to - from + 540) % 360) - 180
  return delta === -180 ? 180 : delta
}

export interface Move {
  yawDelta: number
  pitchDelta: number
}

/** The camera movement implied by an action at the current pose. */
export function moveForAction(action: Action, current: Pose): Move {
  if (action.type === 'rotate') {
    return { yawDelta: action.dyaw, pitchDelta: action.dpitch }
  }
  if (action.type === 'submit') {
    return {
      yawDelta: shortestYawDelta(current.yaw, action.yaw),
      pitchDelta: action.pitch - current.pitch,
    }
  }
  return { yawDelta: 0, pitchDelta: 0 }
}

/** Pose after an action, normalized to the contract's ranges. */
export function poseAfterAction(current: Pose, action: Action): Pose {
  const move = moveForAction(action, current)
  return {
    yaw: normalizeYaw(current.yaw + move.yawDelta),
    pitch: clampPitch(current.pitch + move.pitchDelta),
  }
}

/** Symmetric ease used for every camera turn. */
export function easeInOutCubic(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** A turn should feel physical: short moves are quick, long sweeps take longer. */
export function moveDuration(degrees: number): number {
  const travel = Math.abs(degrees)
  return Math.min(1700, Math.max(420, 380 + travel * 8))
}

/** Keep the typewriter readable without letting a long thought stall the run. */
export function typingDuration(length: number): number {
  return Math.min(2800, Math.max(850, 620 + length * 9))
}
