import { createContext } from 'react'
import type { ApiClient } from '../api/client'
import type { Settings } from './store'

export interface SettingsContextValue {
  settings: Settings
  client: ApiClient
  update: (patch: Partial<Settings>) => void
  updateDefaults: (patch: Partial<Settings['defaults']>) => void
  save: () => boolean
  reset: () => void
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)
