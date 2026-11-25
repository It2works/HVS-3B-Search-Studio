import type { Step } from '../api/types'

const angle = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const count = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

interface AgentTraceProps {
  steps: Step[]
  current: number
}

function actionLabel(step: Step): string {
  if (step.action.type === 'rotate') {
    return `rotate(${step.action.dyaw}, ${step.action.dpitch})`
  }
  if (step.action.type === 'submit') {
    return `submit(${step.action.yaw}, ${step.action.pitch})`
  }
  return 'invalid'
}

/** The model's reasoning log, shown verbatim as a numbered sequence. */
export function AgentTrace({ steps, current }: AgentTraceProps) {
  if (steps.length === 0) return null

  return (
    <section className="trace" aria-labelledby="trace-title">
      <h2 id="trace-title">Agent trace</h2>
      <ol className="trace__list">
        {steps.map((step) => (
          <li
            key={step.t}
            className={step.t === current ? 'trace__item is-current' : 'trace__item'}
            aria-current={step.t === current ? 'step' : undefined}
          >
            <span className="trace__index">{step.t}</span>
            <div className="trace__body">
              <div className="trace__head">
                <span className="readout">
                  yaw {angle.format(step.pose.yaw)}°, pitch {angle.format(step.pose.pitch)}°
                </span>
                <span className={`chip chip--${step.action.type}`}>
                  {actionLabel(step)}
                </span>
                <span className="readout trace__latency">
                  {step.latency_ms === undefined
                    ? '—'
                    : `${count.format(step.latency_ms)} ms`}
                </span>
              </div>
              <p className="trace__think">{step.think || 'No reasoning recorded.'}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
