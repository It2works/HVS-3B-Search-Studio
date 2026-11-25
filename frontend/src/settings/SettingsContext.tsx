import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createApiClient } from '../api/client'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './store'
import { SettingsContext, type SettingsContextValue } from './context'

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(loadSettings)

  // Persist after every committed change, including paste and autofill events.
  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  const update = useCallback((patch: Partial<typeof settings>) => {
    setSettings((current) => ({ ...current, ...patch }))
  }, [])

  const updateDefaults = useCallback((patch: Partial<(typeof settings)['defaults']>) => {
    setSettings((current) => ({
      ...current,
      defaults: { ...current.defaults, ...patch },
    }))
  }, [])

  const save = useCallback(() => saveSettings(settings), [settings])

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
  }, [])

  const client = useMemo(
    () => createApiClient({ baseUrl: settings.backendUrl, apiKey: settings.apiKey }),
    [settings.backendUrl, settings.apiKey],
  )

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, client, update, updateDefaults, save, reset }),
    [settings, client, update, updateDefaults, save, reset],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
