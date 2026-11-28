import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDemoActive } from '../api/connection'
import { SettingsProvider } from '../settings/SettingsContext'
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../settings/store'
import { PlayPage } from './PlayPage'

/** The playback respects reduced motion, which keeps these tests fast. */
function forceReducedMotion() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

/**
 * jsdom delivers animation frames slower than the wall clock, so the playback
 * loop is driven by a virtual clock instead.
 */
function fastFrames() {
  let offset = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => {
      offset += 1000
      callback(performance.now() + offset)
    }, 5),
  )
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
}

function renderPage() {
  return render(
    <SettingsProvider>
      <PlayPage />
    </SettingsProvider>,
  )
}

describe('PlayPage demo', () => {
  beforeEach(() => {
    localStorage.clear()
    resetDemoActive()
    forceReducedMotion()
    fastFrames()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it(
    'runs fake data from the Demo button even when demo mode is off',
    async () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...DEFAULT_SETTINGS, demoMode: false }),
      )
      renderPage()
      expect(screen.queryByText('Simulated')).not.toBeInTheDocument()

      fireEvent.change(screen.getByLabelText('Instruction'), {
        target: { value: 'Find the sun' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Demo (fake data)' }))

      await waitFor(
        () => expect(screen.getByText('Within tolerance')).toBeInTheDocument(),
        { timeout: 10000 },
      )
      expect(screen.getByText('Simulated')).toBeInTheDocument()
      expect(screen.getByText('All thinking')).toBeInTheDocument()
      expect(screen.getAllByText(/sun is behind the thin cloud/).length).toBeGreaterThan(0)
      expect(screen.queryByText(/red bus parked/)).not.toBeInTheDocument()
    },
    15000,
  )

  it(
    'auto-plays the sweep on load with no backend setup',
    async () => {
      renderPage()
      expect(screen.getByText('Simulated')).toBeInTheDocument()

      await waitFor(
        () => expect(screen.getByText('Within tolerance')).toBeInTheDocument(),
        { timeout: 10000 },
      )

      expect(screen.getAllByText(/4 steps/).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/sweep left along the bridge/).length).toBeGreaterThan(0)
      expect(screen.getByText('All thinking')).toBeInTheDocument()
      expect(
        document.querySelector('img[src="/demo-assets/final_view.jpg"]'),
      ).toBeInTheDocument()
    },
    15000,
  )

  it(
    'auto-plays once when the app is mounted under StrictMode',
    async () => {
      render(
        <StrictMode>
          <SettingsProvider>
            <PlayPage />
          </SettingsProvider>
        </StrictMode>,
      )

      await waitFor(
        () => expect(screen.getByText('Within tolerance')).toBeInTheDocument(),
        { timeout: 10000 },
      )
      expect(screen.queryByText('Cancelled')).not.toBeInTheDocument()
      expect(screen.getAllByText(/4 steps/).length).toBeGreaterThan(0)
    },
    15000,
  )
})
