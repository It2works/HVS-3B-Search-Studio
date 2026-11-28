import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { markDemoActive, resetDemoActive } from '../api/connection'
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

  it('shows Demo when demo mode is enabled', () => {
    renderChip()
    expect(screen.getByText('Demo')).toBeInTheDocument()
  })

  it('shows Live with demo mode off', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, demoMode: false }),
    )
    renderChip()
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  it('shows Demo once a simulated run has played', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, demoMode: false }),
    )
    markDemoActive()
    renderChip()
    expect(screen.getByText('Demo')).toBeInTheDocument()
  })
})
