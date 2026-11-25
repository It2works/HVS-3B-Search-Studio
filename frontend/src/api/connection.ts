/** Remembers whether a request ever reached the prototype backend. */

import { useSyncExternalStore } from 'react'

let reached = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function markBackendReached() {
  if (reached) return
  reached = true
  emit()
}

export function resetBackendReached() {
  if (!reached) return
  reached = false
  emit()
}

let demoActive = false

export function markDemoActive() {
  if (demoActive) return
  demoActive = true
  emit()
}

export function resetDemoActive() {
  if (!demoActive) return
  demoActive = false
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useBackendReached(): boolean {
  return useSyncExternalStore(subscribe, () => reached, () => false)
}

export function useDemoActive(): boolean {
  return useSyncExternalStore(subscribe, () => demoActive, () => false)
}
