import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDemoActive } from '../api/connection'
import { SettingsProvider } from '../settings/SettingsContext'
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../settings/store'
import { ConnectionChip } from './ConnectionChip'

function renderChip() {
  return render(
    <SettingsProvider>
      <ConnectionChip />
    </SettingsProvider>,
  )
}

describe('ConnectionChip', () => {
  beforeEach(() => {
    localStorage.clear()
    resetDemoActive()
  })
  afterEach(cleanup)

  it('shows Demo (simulated) when demo mode is enabled', () => {
    renderChip()
    expect(screen.getByText('Demo (simulated)')).toBeInTheDocument()
  })

  it('shows Live (Prototype) with demo mode off', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, demoMode: false }),
    )
    renderChip()
    expect(screen.getByText('Live (Prototype)')).toBeInTheDocument()
  })

  it('stays live even without a backend URL configured', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, backendUrl: '', demoMode: false }),
    )
    renderChip()
    expect(screen.getByText('Live (Prototype)')).toBeInTheDocument()
  })
})
