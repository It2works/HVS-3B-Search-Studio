import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsProvider } from '../settings/SettingsContext'
import { SETTINGS_KEY } from '../settings/store'
import { SettingsPage } from './SettingsPage'

function renderPage() {
  return render(
    <SettingsProvider>
      <SettingsPage />
    </SettingsProvider>,
  )
}

describe('SettingsPage', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('saves explicitly with the Save Settings button and shows Saved!', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Backend URL'), {
      target: { value: 'https://example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(screen.getByText('Saved!')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').backendUrl).toBe(
      'https://example.test',
    )
  })

  it('persists a pasted URL without needing the button', async () => {
    renderPage()
    const input = screen.getByLabelText('Backend URL')
    fireEvent.change(input, { target: { value: 'https://pasted.test' } })
    fireEvent.paste(input)

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').backendUrl).toBe(
        'https://pasted.test',
      )
    })
  })
})
