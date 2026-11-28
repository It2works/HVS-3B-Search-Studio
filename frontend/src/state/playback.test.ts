import { describe, expect, it } from 'vitest'
import type { Pose } from '../api/types'
import {
  clampPitch,
  easeInOutCubic,
  moveDuration,
  moveForAction,
  normalizeYaw,
  poseAfterAction,
  shortestYawDelta,
  typingDuration,
} from './playback'

describe('normalizeYaw', () => {
  it('wraps negatives into the contract range', () => {
    expect(normalizeYaw(-10)).toBe(350)
    expect(normalizeYaw(-370)).toBe(350)
  })

  it('wraps whole turns to zero', () => {
    expect(normalizeYaw(0)).toBe(0)
    expect(normalizeYaw(360)).toBe(0)
    expect(normalizeYaw(725)).toBe(5)
  })
})

describe('shortestYawDelta', () => {
  it('takes the short way across the 0/360 seam', () => {
    expect(shortestYawDelta(350, 10)).toBe(20)
    expect(shortestYawDelta(10, 350)).toBe(-20)
  })

  it('resolves the exact opposite heading deterministically', () => {
    expect(shortestYawDelta(0, 180)).toBe(180)
    expect(shortestYawDelta(0, 181)).toBe(-179)
  })

  it('is zero for an unchanged heading', () => {
    expect(shortestYawDelta(90, 90)).toBe(0)
  })
})

describe('clampPitch', () => {
  it('keeps pitch inside the visible hemisphere', () => {
    expect(clampPitch(100)).toBe(90)
    expect(clampPitch(-100)).toBe(-90)
    expect(clampPitch(45)).toBe(45)
  })
})

describe('moveForAction', () => {
  const current: Pose = { yaw: 350, pitch: 10 }

  it('uses the rotation deltas directly', () => {
    expect(moveForAction({ type: 'rotate', dyaw: -30, dpitch: -5 }, current)).toEqual({
      yawDelta: -30,
      pitchDelta: -5,
    })
  })

  it('turns toward the submitted pose by the shortest arc', () => {
    expect(moveForAction({ type: 'submit', yaw: 10, pitch: 0 }, current)).toEqual({
      yawDelta: 20,
      pitchDelta: -10,
    })
  })

  it('does not move on an invalid action', () => {
    expect(moveForAction({ type: 'invalid' }, current)).toEqual({
      yawDelta: 0,
      pitchDelta: 0,
    })
  })
})

describe('poseAfterAction', () => {
  it('wraps yaw and clamps pitch after a rotation', () => {
    expect(
      poseAfterAction(
        { yaw: 10, pitch: 80 },
        { type: 'rotate', dyaw: -30, dpitch: 30 },
      ),
    ).toEqual({ yaw: 340, pitch: 90 })
  })

  it('settles exactly on a submitted pose', () => {
    expect(
      poseAfterAction({ yaw: 300, pitch: 0 }, { type: 'submit', yaw: 45, pitch: -12 }),
    ).toEqual({ yaw: 45, pitch: -12 })
  })
})

describe('easeInOutCubic', () => {
  it('pins the endpoints and the midpoint', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(0.5)).toBe(0.5)
    expect(easeInOutCubic(1)).toBe(1)
  })

  it('clamps out-of-range progress', () => {
    expect(easeInOutCubic(-1)).toBe(0)
    expect(easeInOutCubic(2)).toBe(1)
  })
})

describe('timing', () => {
  it('keeps a turn between the readable bounds', () => {
    expect(moveDuration(0)).toBe(420)
    expect(moveDuration(90)).toBe(1100)
    expect(moveDuration(200)).toBe(1700)
    expect(moveDuration(200)).toBeGreaterThan(moveDuration(45))
  })

  it('keeps typing between the readable bounds', () => {
    expect(typingDuration(0)).toBe(850)
    expect(typingDuration(50)).toBe(1070)
    expect(typingDuration(1000)).toBe(2800)
  })
})
