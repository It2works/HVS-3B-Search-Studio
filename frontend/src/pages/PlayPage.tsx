import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { useDemoActive } from '../api/connection'
import { readFileAsDataURL } from '../api/files'
import type { EpisodeSource } from '../api/source'
import type { ModelId, Task } from '../api/types'
import { useEpisodeStream, type RunRequest, type StreamPhase } from '../api/useEpisodeStream'
import { AgentTrace } from '../components/AgentTrace'
import { PanoramaStage } from '../components/PanoramaStage'
import { ResultBanner } from '../components/ResultBanner'
import { useSettings } from '../settings/useSettings'
import { episodeReducer, initialEpisodeState } from '../state/episodeReducer'
import { usePlayback, type PlaybackPhase } from '../state/usePlayback'

const MODELS: ModelId[] = ['hvs-3b', 'hvs-3b-sft', 'mock']
const FINAL_IMAGE_URL = `${import.meta.env.BASE_URL}demo-assets/final_view.jpg`
const DEFAULT_INSTRUCTION = 'Find the bus'

/** The prototype only streams events, so images come straight from each step. */
function usePrototypeSource(): EpisodeSource {
  return useMemo(
    () => ({
      stepImage: async (_run, step) => step.image_url || step.image || '',
      panoramaImage: async (run) => run.pano.file || '',
    }),
    [],
  )
}

type Tone = 'idle' | 'thinking' | 'moving' | 'complete' | 'error'

function statusOf(
  phase: PlaybackPhase,
  stream: StreamPhase,
  done: boolean,
): { label: string; tone: Tone } {
  if (stream === 'error') return { label: 'Error', tone: 'error' }
  if (stream === 'cancelled') return { label: 'Cancelled', tone: 'idle' }
  if (phase === 'thinking') return { label: 'Thinking', tone: 'thinking' }
  if (phase === 'resting') return { label: 'Deciding', tone: 'thinking' }
  if (phase === 'moving') return { label: 'Turning', tone: 'moving' }
  if (done) return { label: 'Complete', tone: 'complete' }
  if (stream === 'connecting') return { label: 'Connecting', tone: 'idle' }
  if (stream === 'streaming') return { label: 'Watching', tone: 'idle' }
  return { label: 'Ready', tone: 'idle' }
}

function thoughtLabel(phase: PlaybackPhase, done: boolean): string {
  if (phase === 'thinking') return 'Thinking'
  if (phase === 'resting') return 'Deciding'
  if (phase === 'moving') return 'Turning'
  if (done) return 'Done'
  return 'Watching'
}

export function PlayPage() {
  const { settings } = useSettings()
  const demoActive = useDemoActive()
  const liveSource = usePrototypeSource()
  const [state, dispatch] = useReducer(episodeReducer, initialEpisodeState)
  const [task, setTask] = useState<Task>(settings.defaults.task)
  const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION)
  const [model, setModel] = useState<ModelId>(settings.defaults.model)
  const [formError, setFormError] = useState<string | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [panoBase64, setPanoBase64] = useState<string | null>(null)
  const [panoName, setPanoName] = useState('')
  const [panoReading, setPanoReading] = useState(false)
  const instructionRef = useRef<HTMLInputElement>(null)
  const panoRef = useRef<HTMLInputElement>(null)

  const stream = useEpisodeStream({
    backendUrl: settings.backendUrl,
    apiKey: settings.apiKey || undefined,
    demo: settings.demoMode,
    finalImageUrl: FINAL_IMAGE_URL,
    onEvent: (event) => dispatch({ type: 'EVENT', event }),
  })

  const streamFinished =
    stream.phase === 'done' || stream.phase === 'error' || stream.phase === 'cancelled'
  const playback = usePlayback(state.run, streamFinished)
  const steps = state.run?.steps ?? []
  const active = playback.activeStep
  const status = statusOf(playback.phase, stream.phase, playback.done)
  const streaming = stream.phase === 'connecting' || stream.phase === 'streaming'
  const simulated = settings.demoMode || demoActive
  const locked =
    active?.action.type === 'submit' && playback.phase !== 'thinking' && playback.phase !== 'waiting'
  const showVerdict =
    playback.done || stream.phase === 'error' || stream.phase === 'cancelled'

  // Fake data on arrival: open the app and the demo run plays itself.
  const demoAtMount = useRef(settings.demoMode).current
  const scenarioAtMount = useRef({
    task: settings.defaults.task,
    model: settings.defaults.model,
  }).current
  const startRef = useRef(stream.start)
  startRef.current = stream.start
  const autoStarted = useRef(false)

  useEffect(() => {
    if (!demoAtMount || autoStarted.current) return
    autoStarted.current = true
    const request: RunRequest = {
      task: scenarioAtMount.task,
      instruction: DEFAULT_INSTRUCTION,
      model: scenarioAtMount.model,
    }
    dispatch({ type: 'RUN_STARTED', request })
    void startRef.current(request)
    // Keep the guard set across StrictMode's simulated remount: resetting it
    // here starts a second stream that aborts the first one.
  }, [demoAtMount, scenarioAtMount, dispatch])

  async function handlePanoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      setPanoBase64(null)
      setPanoName('')
      return
    }
    setFormError(null)
    setPanoReading(true)
    try {
      const dataUrl = await readFileAsDataURL(file)
      setPanoBase64(dataUrl)
      setPanoName(file.name)
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not read the panorama file.')
    } finally {
      setPanoReading(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (streaming) return
    setFormError(null)
    if (!settings.demoMode && !panoBase64) {
      setFormError('Attach a 360° panorama to run a live episode.')
      setOptionsOpen(true)
      window.setTimeout(() => panoRef.current?.focus(), 0)
      return
    }
    if (!instruction.trim()) {
      setFormError('Describe what the agent should look for.')
      instructionRef.current?.focus()
      return
    }
    const request: RunRequest = {
      task,
      instruction: instruction.trim(),
      model,
      pano_base64: panoBase64 ?? undefined,
    }
    dispatch({ type: 'RUN_STARTED', request, panoBase64: panoBase64 ?? undefined })
    void stream.start(request)
  }

  function handleDemo() {
    if (streaming) return
    setFormError(null)
    const request: RunRequest = {
      task,
      instruction: instruction.trim() || DEFAULT_INSTRUCTION,
      model,
    }
    dispatch({ type: 'RUN_STARTED', request })
    void stream.start(request, true)
  }

  return (
    <section className="play">
      <header className="play__intro">
        <p className="play__eyebrow">
          <span className={`status-dot status-dot--${status.tone}`} aria-hidden="true" />
          <span>{status.label}</span>
          <span className="play__sep" aria-hidden="true">
            /
          </span>
          <span>{state.run?.task ?? task}</span>
          <span className="play__sep" aria-hidden="true">
            /
          </span>
          <span>{state.run?.model ?? model}</span>
          {simulated && <span className="badge">Simulated</span>}
        </p>
        <h1>{state.run?.instruction ?? (instruction.trim() || DEFAULT_INSTRUCTION)}</h1>
        <p className="play__sub">A 3B vision model searching a 360° scene.</p>
      </header>

      <div className="stage">
        <PanoramaStage
          run={state.run}
          source={liveSource}
          pose={playback.pose}
          fov={state.run?.config.fov ?? settings.defaults.fov}
          activeStep={active}
          locked={locked}
        />

        <div className="thought">
          <div className="thought__head">
            <span className="thought__label">
              <span
                className={`thought__dot${playback.phase === 'thinking' ? ' is-live' : ''}`}
                aria-hidden="true"
              />
              {thoughtLabel(playback.phase, playback.done)}
            </span>
            {active && (
              <span className="thought__step">
                step {String(active.t).padStart(2, '0')}
              </span>
            )}
          </div>
          <p className="sr-only" aria-live="polite">
            {active?.think ?? ''}
          </p>
          <p className="thought__text" aria-hidden="true">
            {active ? (
              <>
                {playback.typed}
                {playback.phase === 'thinking' && <span className="thought__caret" />}
              </>
            ) : (
              <span className="thought__placeholder">Waiting for the first look…</span>
            )}
          </p>
        </div>

        <div className="stage__controls">
          <button
            type="button"
            className="text-button"
            onClick={playback.replay}
            disabled={steps.length === 0}
          >
            ↺ Replay
          </button>
          <span className="stage__count">
            {steps.length} step{steps.length === 1 ? '' : 's'}
          </span>
          <span className="stage__spacer" />
          {showVerdict && (
            <ResultBanner
              result={state.result}
              task={state.run?.task ?? task}
              groundTruth={state.run?.ground_truth ?? null}
            />
          )}
          {streaming && (
            <button
              type="button"
              className="text-button text-button--danger"
              onClick={stream.cancel}
            >
              Stop
            </button>
          )}
        </div>
      </div>

      {stream.error && (
        <p className="form-error" role="alert">
          {stream.requestSent ? stream.error : `Run could not start. ${stream.error}`}
        </p>
      )}
      {state.error && stream.phase !== 'error' && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {stream.phase === 'cancelled' && (
        <p className="form-error" role="status">
          Run cancelled.
        </p>
      )}

      <form className="composer" onSubmit={handleSubmit}>
        <span className="composer__icon" aria-hidden="true">
          ◎
        </span>
        <input
          id="instruction"
          name="instruction"
          ref={instructionRef}
          type="text"
          autoComplete="off"
          placeholder="What should it find?"
          aria-label="Instruction"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          disabled={streaming}
        />
        <button
          type="submit"
          className="composer__send"
          aria-label="Start episode"
          disabled={streaming || panoReading}
        >
          {streaming ? <span className="spinner" aria-hidden="true" /> : '→'}
        </button>
      </form>

      <div className="composer__meta">
        <span>
          {model} · {task}
          {!settings.demoMode && panoName ? ` · ${panoName}` : ''}
        </span>
        <span className="composer__spacer" />
        <button
          type="button"
          className="text-button"
          onClick={handleDemo}
          disabled={streaming}
          aria-label="Demo (fake data)"
        >
          Demo
        </button>
        <button
          type="button"
          className="text-button"
          aria-expanded={optionsOpen}
          onClick={() => setOptionsOpen((open) => !open)}
        >
          Options
        </button>
      </div>

      {optionsOpen && (
        <div className="composer__options">
          <div className="field">
            <label htmlFor="task-select">Task</label>
            <select
              id="task-select"
              name="task"
              value={task}
              onChange={(event) => setTask(event.target.value as Task)}
            >
              <option value="HOS">HOS — find an object</option>
              <option value="HPS">HPS — face a direction</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="model-select">Model</label>
            <select
              id="model-select"
              name="model"
              value={model}
              onChange={(event) => setModel(event.target.value as ModelId)}
            >
              {MODELS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
          {!settings.demoMode && (
            <div className="field field--wide">
              <label htmlFor="pano-file">360° panorama</label>
              <input
                id="pano-file"
                name="pano"
                ref={panoRef}
                type="file"
                accept="image/jpeg,image/png"
                onChange={(event) => void handlePanoChange(event)}
              />
              {panoReading && (
                <span className="readout" aria-live="polite">
                  Reading panorama…
                </span>
              )}
              {panoName && !panoReading && <span className="readout">{panoName}</span>}
            </div>
          )}
        </div>
      )}

      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}

      {steps.length > 0 && (
        <section className="log" aria-label="All thinking">
          <div className="log__head">
            <span>All thinking</span>
            <span className="log__meta">
              {steps.length} step{steps.length === 1 ? '' : 's'} · {state.run?.model}
            </span>
          </div>
          <AgentTrace steps={steps} current={active?.t ?? 0} />
        </section>
      )}
    </section>
  )
}
