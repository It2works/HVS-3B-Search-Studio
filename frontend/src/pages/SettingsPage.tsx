import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../settings/useSettings'
import type { ModelId, Task } from '../api/types'

interface NumberFieldProps {
  id: string
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}

function NumberField({ id, label, value, min, max, onChange }: NumberFieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

export function SettingsPage() {
  const { settings, update, updateDefaults, save, reset } = useSettings()
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const savedTimer = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      if (savedTimer.current !== undefined) window.clearTimeout(savedTimer.current)
    },
    [],
  )

  function handleSave() {
    if (save()) {
      setSaveError(null)
      setSaved(true)
      if (savedTimer.current !== undefined) window.clearTimeout(savedTimer.current)
      savedTimer.current = window.setTimeout(() => setSaved(false), 2500)
    } else {
      setSaved(false)
      setSaveError('Could not save in this browser. Storage may be disabled.')
    }
  }

  return (
    <section className="page">
      <header className="page__head">
        <div>
          <h1>Settings</h1>
          <p className="page__lede">
            Stored in this browser only. The API key is sent as a request header, never in a URL.
          </p>
        </div>
      </header>

      <form className="settings" onSubmit={(event) => event.preventDefault()}>
        <fieldset className="settings__group">
          <legend>Connection</legend>
          <div className="field">
            <label htmlFor="backend-url">Backend URL</label>
            <input
              id="backend-url"
              name="backendUrl"
              type="url"
              autoComplete="off"
              spellCheck={false}
              value={settings.backendUrl}
              onChange={(event) => update({ backendUrl: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="api-key">API key</label>
            <input
              id="api-key"
              name="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={settings.apiKey}
              onChange={(event) => update({ apiKey: event.target.value })}
            />
          </div>
          <div className="field field--checkbox">
            <input
              id="demo-mode"
              name="demoMode"
              type="checkbox"
              checked={settings.demoMode}
              onChange={(event) => update({ demoMode: event.target.checked })}
            />
            <label htmlFor="demo-mode">
              Demo mode — simulate the stream in this browser, no backend needed
            </label>
          </div>
        </fieldset>

        <fieldset className="settings__group">
          <legend>Episode defaults</legend>
          <div className="field">
            <label htmlFor="default-task">Task</label>
            <select
              id="default-task"
              name="task"
              value={settings.defaults.task}
              onChange={(event) =>
                updateDefaults({ task: event.target.value as Task })
              }
            >
              <option value="HOS">HOS</option>
              <option value="HPS">HPS</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="default-model">Model</label>
            <select
              id="default-model"
              name="model"
              value={settings.defaults.model}
              onChange={(event) =>
                updateDefaults({ model: event.target.value as ModelId })
              }
            >
              <option value="hvs-3b">hvs-3b</option>
              <option value="hvs-3b-sft">hvs-3b-sft</option>
              <option value="mock">mock</option>
            </select>
          </div>
          <div className="settings__grid">
            <NumberField
              id="default-fov"
              label="Field of view"
              value={settings.defaults.fov}
              min={30}
              max={170}
              onChange={(fov) => updateDefaults({ fov })}
            />
            <NumberField
              id="default-max-steps"
              label="Max steps"
              value={settings.defaults.maxSteps}
              min={1}
              max={32}
              onChange={(maxSteps) => updateDefaults({ maxSteps })}
            />
            <NumberField
              id="default-view-px"
              label="View size"
              value={settings.defaults.viewPx}
              min={128}
              max={1024}
              onChange={(viewPx) => updateDefaults({ viewPx })}
            />
            <NumberField
              id="default-context"
              label="Context turns"
              value={settings.defaults.contextTurns}
              min={0}
              max={8}
              onChange={(contextTurns) => updateDefaults({ contextTurns })}
            />
          </div>
        </fieldset>

        <div className="settings__actions">
          <button type="button" className="settings__save" onClick={handleSave}>
            Save Settings
          </button>
          {saved && (
            <span className="settings__saved" role="status" aria-live="polite">
              Saved!
            </span>
          )}
          {saveError && (
            <span className="form-error" role="alert">
              {saveError}
            </span>
          )}
          <button
            type="button"
            className="settings__reset"
            onClick={() => {
              if (window.confirm('Reset settings saved in this browser?')) reset()
            }}
          >
            Reset saved settings
          </button>
        </div>
      </form>
    </section>
  )
}
