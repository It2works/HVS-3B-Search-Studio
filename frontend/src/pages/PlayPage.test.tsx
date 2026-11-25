import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDemoActive } from '../api/connection'
import { SettingsProvider } from '../settings/SettingsContext'
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../settings/store'
import { PlayPage } from './PlayPage'

describe('PlayPage demo', () => {
  beforeEach(() => {
    localStorage.clear()
    resetDemoActive()
  })
  afterEach(cleanup)

  it('runs fake data from the Try demo button even when demo mode is off', async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, demoMode: false }),
    )
    render(
      <SettingsProvider>
        <PlayPage />
      </SettingsProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try demo (fake data)' }))

    await waitFor(
      () => expect(screen.getByText(/Stream: done/)).toBeInTheDocument(),
      { timeout: 5000 },
    )
    expect(screen.getByText('Demo mode')).toBeInTheDocument()
  })

  it('auto-plays a fake run on load with no backend setup', async () => {
    render(
      <SettingsProvider>
        <PlayPage />
      </SettingsProvider>,
    )

    expect(screen.getByText('Demo mode')).toBeInTheDocument()
    await waitFor(
      () => expect(screen.getByText(/Stream: done/)).toBeInTheDocument(),
      { timeout: 5000 },
    )
    expect(screen.getByText(/Within tolerance/)).toBeInTheDocument()
    expect(screen.getByText('2 steps received')).toBeInTheDocument()
    expect(screen.getAllByText(/Rotating 90 degrees mig/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/the next action is to submit\(/).length).toBeGreaterThan(0)
    const finalImage = document.querySelector('img[src="/demo-assets/final_view.jpg"]')
    expect(finalImage).toBeInTheDocument()
  })
})
