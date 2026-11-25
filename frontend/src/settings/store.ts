/** Versioned, validated settings persisted in localStorage. */

import type { ModelId, Task } from '../api/types'

export interface Settings {
  version: 1
  backendUrl: string
  apiKey: string
  demoMode: boolean
  defaults: {
    task: Task
    model: ModelId
    fov: number
    maxSteps: number
    viewPx: number
    contextTurns: number
  }
}

export const SETTINGS_KEY = 'hvs.settings.v1'

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  backendUrl: 'http://localhost:8000',
  apiKey: '',
  demoMode: true,
  defaults: {
    task: 'HOS',
    model: 'hvs-3b-sft',
    fov: 90,
    maxSteps: 8,
    viewPx: 448,
    contextTurns: 2,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function parseSettings(raw: unknown): Settings {
  if (!isRecord(raw) || raw.version !== 1) return DEFAULT_SETTINGS
  const defaults = isRecord(raw.defaults) ? raw.defaults : {}
  return {
    version: 1,
    backendUrl:
      typeof raw.backendUrl === 'string'
        ? raw.backendUrl.trim()
        : DEFAULT_SETTINGS.backendUrl,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    demoMode:
      typeof raw.demoMode === 'boolean' ? raw.demoMode : DEFAULT_SETTINGS.demoMode,
    defaults: {
      task: defaults.task === 'HPS' ? 'HPS' : 'HOS',
      model:
        typeof defaults.model === 'string' &&
        ['hvs-3b', 'hvs-3b-sft', 'mock'].includes(defaults.model)
          ? (defaults.model as ModelId)
          : DEFAULT_SETTINGS.defaults.model,
      fov: clampNumber(defaults.fov, 30, 170, 90),
      maxSteps: Math.round(clampNumber(defaults.maxSteps, 1, 32, 8)),
      viewPx: Math.round(clampNumber(defaults.viewPx, 128, 1024, 448)),
      contextTurns: Math.round(clampNumber(defaults.contextTurns, 0, 8, 2)),
    },
  }
}

export function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY)
    return stored ? parseSettings(JSON.parse(stored) as unknown) : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: Settings): boolean {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    return true
  } catch {
    // Storage can be disabled; the app still works for this session.
    return false
  }
}
