/** Status chip for the demo-first app. It never displays an offline state. */

import { useDemoActive } from '../api/connection'
import { useSettings } from '../settings/useSettings'

export function ConnectionChip() {
  const { settings } = useSettings()
  const demoActive = useDemoActive()
  const demo = settings.demoMode || demoActive

  return (
    <span
      className={`connection${demo ? ' connection--demo' : ''}`}
      role="status"
      title={demo ? 'Runs are simulated in this browser' : 'Connected to the prototype backend'}
    >
      <span className="connection__dot" aria-hidden="true" />
      {demo ? 'Demo' : 'Live'}
    </span>
  )
}
