import type { Pose, Result, Task } from '../api/types'
import { evaluateAgainstGroundTruth } from '../state/evaluation'

const angle = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

interface ResultBannerProps {
  result: Result | null
  task: Task
  groundTruth?: Pose | null
}

/** One quiet line: did the final heading land inside tolerance? */
export function ResultBanner({ result, task, groundTruth }: ResultBannerProps) {
  if (!result) return null

  const scored =
    groundTruth && result.final
      ? evaluateAgainstGroundTruth(task, result.final, groundTruth)
      : null
  const success = scored ? scored.success : result.success
  const failed = result.status === 'error'
  const outcome = failed
    ? 'Run failed'
    : success === null || success === undefined
      ? 'Unscored'
      : success
        ? 'Within tolerance'
        : 'Outside tolerance'
  const tone = failed ? 'error' : success ? 'success' : 'neutral'
  const detail = scored
    ? task === 'HPS'
      ? `Yaw error ${angle.format(scored.dyaw)}°, limit ${scored.toleranceYaw}°. Pitch ignored.`
      : `Yaw error ${angle.format(scored.dyaw)}°/${scored.toleranceYaw}°, pitch error ${angle.format(scored.dpitch)}°/${scored.tolerancePitch}°.`
    : undefined

  return (
    <span
      className={`verdict verdict--${tone}`}
      role="status"
      aria-label="Run result"
      title={detail}
    >
      <span className="verdict__dot" aria-hidden="true" />
      <span>{outcome}</span>
      {result.final && (
        <span className="verdict__pose">
          yaw {angle.format(result.final.yaw)}° · pitch {angle.format(result.final.pitch)}°
        </span>
      )}
      {result.error && <span className="verdict__error">{result.error}</span>}
    </span>
  )
}
