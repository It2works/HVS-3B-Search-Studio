/** Image resolution for the live prototype's streamed steps. */

import type { RunFile, Step } from './types'

export interface EpisodeSource {
  stepImage(run: RunFile, step: Step, signal?: AbortSignal): Promise<string>
  panoramaImage(run: RunFile, signal?: AbortSignal): Promise<string>
}
