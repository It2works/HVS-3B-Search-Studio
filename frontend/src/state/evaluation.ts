/** Success thresholds from AGENTS.md / CONTRACT.md, shared with the result UI. */

import type { Pose, Task } from '../api/types'

export interface Evaluation {
  success: boolean
  dyaw: number
  dpitch: number
  toleranceYaw: number
  tolerancePitch: number | null
}

export function angularDistanceYaw(a: number, b: number): number {
  const diff = Math.abs((a - b) % 360)
  return diff > 180 ? 360 - diff : diff
}

export function evaluateAgainstGroundTruth(
  task: Task,
  final: Pose,
  groundTruth: Pose,
): Evaluation {
  const dyaw = angularDistanceYaw(final.yaw, groundTruth.yaw)
  const dpitch = Math.abs(final.pitch - groundTruth.pitch)
  if (task === 'HPS') {
    return { success: dyaw <= 10, dyaw, dpitch, toleranceYaw: 10, tolerancePitch: null }
  }
  return { success: dyaw <= 30 && dpitch <= 20, dyaw, dpitch, toleranceYaw: 30, tolerancePitch: 20 }
}
