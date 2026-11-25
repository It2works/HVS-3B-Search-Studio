/** Status chip for the demo-first app. It never displays an offline state. */

import { useDemoActive } from '../api/connection'
import { useSettings } from '../settings/useSettings'

export function ConnectionChip() {
  const { settings } = useSettings()
  const demoActive = useDemoActive()
  const label = settings.demoMode || demoActive ? 'Demo (simulated)' : 'Live (Prototype)'

  return (
    <span
      className="connection connection--live"
      role="status"
      title="Runs are available"
    >
      <span className="connection__dot" aria-hidden="true" />
      {label}
    </span>
  )
}
