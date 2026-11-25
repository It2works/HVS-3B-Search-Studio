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
import { useEpisodeStream, type RunRequest } from '../api/useEpisodeStream'
import { AgentTrace } from '../components/AgentTrace'
import { Minimap } from '../components/Minimap'
import { ResultBanner } from '../components/ResultBanner'
import { StepTimeline } from '../components/StepTimeline'
import { ViewFrame } from '../components/ViewFrame'
import { useSettings } from '../settings/useSettings'
import { episodeReducer, initialEpisodeState } from '../state/episodeReducer'

const MODELS: ModelId[] = ['hvs-3b', 'hvs-3b-sft', 'mock']
const FINAL_IMAGE_URL = `${import.meta.env.BASE_URL}demo-assets/final_view.jpg`

/** The prototype only streams events, so images come straight from each step. */
function usePrototypeSource(): EpisodeSource {
  return useMemo(
    () => ({
      stepImage: async (_run, step) => step.image || '',
      panoramaImage: async (run) => run.pano.file || '',
    }),
    [],
  )
}

export function PlayPage() {
  const { settings } = useSettings()
  const demoActive = useDemoActive()
  const liveSource = usePrototypeSource()
  const [state, dispatch] = useReducer(episodeReducer, initialEpisodeState)
  const [task, setTask] = useState<Task>(settings.defaults.task)
  const [instruction, setInstruction] = useState('Find the bus')
  const [model, setModel] = useState<ModelId>(settings.defaults.model)
  const [formError, setFormError] = useState<string | null>(null)
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
      instruction: 'Find the bus',
      model: scenarioAtMount.model,
    }
    dispatch({ type: 'RUN_STARTED', request })
    void startRef.current(request)
    return () => {
      autoStarted.current = false
    }
  }, [demoAtMount, scenarioAtMount, dispatch])

  const streaming = stream.phase === 'connecting' || stream.phase === 'streaming'
  const latest = state.run?.steps.find((step) => step.t === state.currentStep)
  const currentPose = latest?.pose ?? state.run?.config.start

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
      setFormError('Choose a panorama image to run.')
      panoRef.current?.focus()
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
      instruction: instruction.trim() || 'Find the bus',
      model,
    }
    dispatch({ type: 'RUN_STARTED', request })
    void stream.start(request, true)
  }

  function handleCancel() {
    stream.cancel()
  }

  return (
    <section className="page">
      <header className="page__head">
        <div>
          <h1>Play</h1>
          <p className="page__lede">
            Start a 360° search run against <code>POST /api/run</code>. Default scenario:
            Find the bus, HOS, hvs-3b-sft, 8 steps.
          </p>
        </div>
        {(settings.demoMode || demoActive) && <span className="source-badge">Demo mode</span>}
      </header>

      <form className="run-form" onSubmit={handleSubmit}>
        <h2>New episode</h2>
        <div className="run-form__grid">
          <div className="field">
            <label htmlFor="pano-file">Panorama</label>
            <input
              id="pano-file"
              name="pano"
              ref={panoRef}
              type="file"
              accept="image/jpeg,image/png"
              onChange={(event) => void handlePanoChange(event)}
            />
            {panoName && (
              <span className="readout" aria-live="polite">
                {panoName} ready
              </span>
            )}
          </div>
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
          <div className="field">
            <label htmlFor="instruction">Instruction</label>
            <input
              id="instruction"
              name="instruction"
              ref={instructionRef}
              type="text"
              placeholder="Find the bus…"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </div>
        </div>

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        <div className="run-form__actions">
          <button type="submit" disabled={streaming || panoReading}>
            {panoReading ? 'Reading panorama…' : streaming ? 'Running…' : 'Run'}
          </button>
          <button
            type="button"
            className="button--demo"
            onClick={handleDemo}
            disabled={streaming}
          >
            Try demo (fake data)
          </button>
        </div>
      </form>

      {state.run && (
        <div className="live-stage">
          <div className="live-status" aria-live="polite">
            <strong>Stream: {stream.phase}</strong>
            <span>{state.run.steps.length} steps received</span>
            {stream.parseErrors > 0 && (
              <span className="live-status__warn">
                {stream.parseErrors} frame{stream.parseErrors === 1 ? '' : 's'} could not be parsed
              </span>
            )}
            {streaming && (
              <button type="button" className="button--danger" onClick={handleCancel}>
                Cancel episode
              </button>
            )}
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

          {currentPose ? (
            <>
              <div className="run-viewer__stage">
                <ViewFrame run={state.run} step={latest} source={liveSource} />
                <Minimap run={state.run} pose={currentPose} source={liveSource} />
              </div>
              <StepTimeline
                run={state.run}
                source={liveSource}
                current={state.currentStep}
                onSelect={(t) => dispatch({ type: 'SELECT_STEP', t })}
              />
              <AgentTrace steps={state.run.steps} current={state.currentStep} />
              {(settings.demoMode || demoActive) && (
                <figure className="demo-result">
                  <img
                    src={FINAL_IMAGE_URL}
                    width={448}
                    height={448}
                    alt="Final view with the red bus centred"
                  />
                  <figcaption>Final view: Find the bus</figcaption>
                </figure>
              )}
              <ResultBanner result={state.result} task={state.run.task} />
            </>
          ) : (
            <div className="state-panel" role="status">
              Waiting for the first stream frame…
            </div>
          )}
        </div>
      )}
    </section>
  )
}
