import type { Step } from '../api/types'

const angle = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const count = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

interface AgentTraceProps {
  steps: Step[]
  current: number
}

function signed(value: number): string {
  const formatted = angle.format(value)
  return value > 0 ? `+${formatted}` : formatted
}

function actionLabel(step: Step): string {
  if (step.action.type === 'rotate') {
    return `rotate ${signed(step.action.dyaw)}°, ${signed(step.action.dpitch)}°`
  }
  if (step.action.type === 'submit') {
    return `submit ${angle.format(step.action.yaw)}°, ${angle.format(step.action.pitch)}°`
  }
  return 'invalid'
}

/** The full, verbatim reasoning log. The live thought is typed above it. */
export function AgentTrace({ steps, current }: AgentTraceProps) {
  if (steps.length === 0) return null

  return (
    <ol className="trace__list" aria-label="Model thinking, in order">
      {steps.map((step) => (
        <li
          key={step.t}
          className={step.t === current ? 'trace__item is-current' : 'trace__item'}
          aria-current={step.t === current ? 'step' : undefined}
        >
          <span className="trace__index">{String(step.t).padStart(2, '0')}</span>
          <div className="trace__body">
            <div className="trace__head">
              <span className="trace__action">{actionLabel(step)}</span>
              <span className="trace__pose">
                yaw {angle.format(step.pose.yaw)}° · pitch {angle.format(step.pose.pitch)}°
              </span>
              <span className="trace__latency">
                {step.latency_ms === undefined ? '—' : `${count.format(step.latency_ms)} ms`}
              </span>
            </div>
            <p className="trace__think">{step.think || 'No reasoning recorded.'}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
