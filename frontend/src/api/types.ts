/** Types mirrored from docs/CONTRACT.md. Keep in sync with the backend. */

export type Task = 'HOS' | 'HPS'
export type ModelId = 'hvs-3b' | 'hvs-3b-sft' | 'mock'
export type EpisodeStatus = 'submitted' | 'max_steps' | 'error' | 'cancelled'

export interface Pose {
  yaw: number
  pitch: number
}

export interface Pano {
  id: string
  width: number
  height: number
  file: string
}

export interface EpisodeConfig {
  fov: number
  view_px: number
  max_steps: number
  context_turns: number
  start: Pose
  prompt_sha: string
}

export interface RotateAction {
  type: 'rotate'
  dyaw: number
  dpitch: number
}

export interface SubmitAction {
  type: 'submit'
  yaw: number
  pitch: number
}

export interface InvalidAction {
  type: 'invalid'
}

export type Action = RotateAction | SubmitAction | InvalidAction

export interface Step {
  t: number
  pose: Pose
  image: string
  image_url?: string
  raw: string
  think: string
  action: Action
  parse_ok: boolean
  latency_ms?: number
}

export interface Result {
  status: EpisodeStatus
  final: Pose | null
  success: boolean | null
  error: string | null
}

export interface RunFile {
  id: string
  created_at: string
  model: ModelId
  task: Task
  instruction: string
  pano: Pano
  config: EpisodeConfig
  ground_truth: Pose | null
  steps: Step[]
  result: Result
}

export interface EpisodeSummary {
  id: string
  created_at: string | null
  model: ModelId | null
  task: Task | null
  instruction: string | null
  status: EpisodeStatus | null
  success: boolean | null
  step_count: number
  final: Pose | null
}

export interface Gpu {
  index: number
  name: string
}

export interface ModelDescriptor {
  id: string
  label: string
  loaded: boolean
  device: string
}

export interface HealthResponse {
  gpus: Gpu[]
  models: ModelDescriptor[]
}

export interface EpisodeStartedEvent {
  type: 'episode_started'
  episode_id: string
  run: RunFile
}

export interface StepStartedEvent {
  type: 'step_started'
  t: number
  pose: Pose
}

export interface StepCompletedEvent {
  type: 'step_completed'
  step: Step
}

export interface EpisodeFinishedEvent {
  type: 'episode_finished'
  result: Result
}

export interface ErrorEvent {
  type: 'error'
  message: string
}

export type SseEvent =
  | EpisodeStartedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | EpisodeFinishedEvent
  | ErrorEvent

export interface CreateEpisodeRequest {
  pano_id: string
  task: Task
  instruction: string
  model: ModelId
  start?: Pose
  max_steps?: number
  fov?: number
  ground_truth?: Pose | null
}

/** Payload for the prototype POST /api/run endpoint. */
export interface PrototypeRunRequest {
  task: Task
  instruction: string
  model: ModelId
  pano_base64?: string
}

export interface CompareRequest extends CreateEpisodeRequest {
  models: ModelId[]
}

export interface CompareResponse {
  comparison_id: string
  episodes: string[]
}

export interface UploadResponse {
  pano_id: string
  width: number
  height: number
}

export interface ApiErrorBody {
  error?: string
  detail?: string | { error?: string }
}
