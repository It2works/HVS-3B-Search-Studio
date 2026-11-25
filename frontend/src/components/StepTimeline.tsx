import { useCallback, type KeyboardEvent } from 'react'
import { useResourceUrl } from '../api/useResourceUrl'
import type { EpisodeSource } from '../api/source'
import type { RunFile, Step } from '../api/types'

const latency = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

interface StepTimelineProps {
  run: RunFile
  source: EpisodeSource
  current: number
  onSelect: (t: number) => void
}

function ActionChip({ step }: { step: Step }) {
  const label =
    step.action.type === 'rotate'
      ? `rotate ${step.action.dyaw}°, ${step.action.dpitch}°`
      : step.action.type === 'submit'
        ? `submit ${step.action.yaw}°, ${step.action.pitch}°`
        : 'invalid'
  return <span className={`chip chip--${step.action.type}`}>{label}</span>
}

function Thumb({
  run,
  step,
  source,
  active,
  onSelect,
}: {
  run: RunFile
  step: Step
  source: EpisodeSource
  active: boolean
  onSelect: (t: number) => void
}) {
  const inlineImage = step.image_url?.startsWith('data:image')
    ? step.image_url
    : undefined

  const load = useCallback(
    (signal: AbortSignal) => {
      // The prototype sends the thumbnail inline; no fetch needed.
      if (inlineImage) return ''
      return source.stepImage(run, step, signal)
    },
    [source, run, step, inlineImage],
  )
  const { url, error } = useResourceUrl(load)

  return (
    <li className="timeline__item">
      <button
        type="button"
        className={`timeline__step${active ? ' is-active' : ''}`}
        aria-current={active ? 'step' : undefined}
        aria-label={`Step ${step.t}, ${step.action.type}. ${step.think || 'No reasoning recorded.'}`}
        onClick={() => onSelect(step.t)}
      >
        <span className="timeline__thumb">
          {inlineImage ? (
            <img src={inlineImage} width={96} height={96} alt="" loading="lazy" />
          ) : error ? (
            <span className="timeline__thumb-error">No image</span>
          ) : url ? (
            <img src={url} width={96} height={96} alt="" loading="lazy" />
          ) : (
            <span className="timeline__thumb-loading">Loading…</span>
          )}
          <span className="timeline__index">{step.t}</span>
        </span>
        <span className="timeline__detail">
          <ActionChip step={step} />
          <span className="timeline__think">{step.think || 'No reasoning recorded.'}</span>
          <span className="readout timeline__latency">
            {step.latency_ms !== undefined ? `${latency.format(step.latency_ms)} ms` : '—'}
          </span>
        </span>
      </button>
    </li>
  )
}

export function StepTimeline({ run, source, current, onSelect }: StepTimelineProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    onSelect(current + (event.key === 'ArrowRight' ? 1 : -1))
  }

  if (run.steps.length === 0) {
    return (
      <section className="timeline timeline--empty" aria-label="Step timeline">
        <p>No steps were recorded for this run.</p>
      </section>
    )
  }

  return (
    <section className="timeline" aria-label="Step timeline">
      <div className="timeline__head">
        <h2>Steps</h2>
        <label className="timeline__scrub">
          <span>Scrub</span>
          <input
            type="range"
            min={0}
            max={run.steps.length}
            step={1}
            value={current}
            onChange={(event) => onSelect(Number(event.target.value))}
            aria-label="Scrub through steps"
          />
        </label>
      </div>
      <div
        className="timeline__track"
        role="group"
        aria-label="Steps. Use left and right arrow keys to move."
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <ol className="timeline__list">
          {run.steps.map((step) => (
            <Thumb
              key={step.t}
              run={run}
              step={step}
              source={source}
              active={step.t === current}
              onSelect={onSelect}
            />
          ))}
        </ol>
      </div>
    </section>
  )
}
