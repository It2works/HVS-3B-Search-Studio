import type { Pose, Result, Task } from '../api/types'
import { evaluateAgainstGroundTruth } from '../state/evaluation'

const angle = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

interface ResultBannerProps {
  result: Result | null
  task: Task
  groundTruth?: Pose | null
}

export function ResultBanner({ result, task, groundTruth }: ResultBannerProps) {
  if (!result) {
    return (
      <section className="result result--pending" aria-label="Run result">
        <span className="result__status">In progress</span>
        <p>Waiting for the agent to submit a pose.</p>
      </section>
    )
  }

  const scored =
    groundTruth && result.final
      ? evaluateAgainstGroundTruth(task, result.final, groundTruth)
      : null
  const success = scored ? scored.success : result.success
  const outcome =
    success === null || success === undefined
      ? 'Unscored'
      : success
        ? 'Within tolerance'
        : 'Outside tolerance'

  return (
    <section className={`result result--${result.status}`} aria-label="Run result">
      <div className="result__main">
        <span className="result__status">{result.status.replace('_', ' ')}</span>
        <strong>{outcome}</strong>
        <span className="result__task">{task} task</span>
      </div>
      {result.final ? (
        <p className="readout result__pose">
          Final yaw {angle.format(result.final.yaw)}°, pitch {angle.format(result.final.pitch)}°
        </p>
      ) : (
        <p className="result__pose">No final pose recorded.</p>
      )}
      {scored && (
        <p className="readout result__tolerance" aria-live="polite">
          {task === 'HPS'
            ? `Yaw error ${angle.format(scored.dyaw)}°, limit ${scored.toleranceYaw}°. Pitch ignored.`
            : `Yaw error ${angle.format(scored.dyaw)}°/${scored.toleranceYaw}°, pitch error ${angle.format(scored.dpitch)}°/${scored.tolerancePitch}°.`}
        </p>
      )}
      {result.error && (
        <p className="result__error" role="alert">
          {result.error}
        </p>
      )}
    </section>
  )
}
