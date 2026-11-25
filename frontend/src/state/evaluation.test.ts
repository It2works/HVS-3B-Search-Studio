import { describe, expect, it } from 'vitest'
import { angularDistanceYaw, evaluateAgainstGroundTruth } from './evaluation'

describe('evaluateAgainstGroundTruth', () => {
  it('uses HOS tolerances including pitch', () => {
    const result = evaluateAgainstGroundTruth(
      'HOS',
      { yaw: 120, pitch: 5 },
      { yaw: 145, pitch: 25 },
    )
    expect(result.success).toBe(true)
    expect(result.toleranceYaw).toBe(30)
    expect(result.tolerancePitch).toBe(20)
    expect(result.dyaw).toBe(25)
    expect(result.dpitch).toBe(20)
  })

  it('fails HOS when either axis is outside', () => {
    expect(
      evaluateAgainstGroundTruth('HOS', { yaw: 151, pitch: 5 }, { yaw: 120, pitch: 5 })
        .success,
    ).toBe(false)
    expect(
      evaluateAgainstGroundTruth('HOS', { yaw: 120, pitch: 26 }, { yaw: 120, pitch: 5 })
        .success,
    ).toBe(false)
  })

  it('wraps yaw around 0/360 and ignores pitch for HPS', () => {
    expect(angularDistanceYaw(350, 10)).toBe(20)
    const result = evaluateAgainstGroundTruth(
      'HPS',
      { yaw: 355, pitch: -80 },
      { yaw: 5, pitch: 80 },
    )
    expect(result.success).toBe(true)
    expect(result.dyaw).toBe(10)
    expect(result.tolerancePitch).toBeNull()
    expect(
      evaluateAgainstGroundTruth('HPS', { yaw: 349, pitch: 0 }, { yaw: 0, pitch: 0 })
        .success,
    ).toBe(false)
  })
})
