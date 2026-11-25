/** Fetch wrapper: attaches X-API-Key and turns failures into typed errors. */

import type {
  ApiErrorBody,
  CompareRequest,
  CompareResponse,
  CreateEpisodeRequest,
  UploadResponse,
} from './types'

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, message: string, body: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export interface ApiClientConfig {
  baseUrl: string
  apiKey: string
}

export interface ApiClient {
  uploadPanorama(file: File): Promise<UploadResponse>
  createEpisode(payload: CreateEpisodeRequest): Promise<{ episode_id: string }>
  cancelEpisode(id: string): Promise<{ episode_id: string; cancelled: boolean }>
  compare(payload: CompareRequest): Promise<CompareResponse>
  fetchStepImage(id: string, step: number, signal?: AbortSignal): Promise<string>
  fetchPanorama(path: string, signal?: AbortSignal): Promise<string>
}

function messageFrom(status: number, body: unknown): string {
  const parsed = body as ApiErrorBody | null
  if (parsed && typeof parsed === 'object') {
    if (typeof parsed.error === 'string') return parsed.error
    if (typeof parsed.detail === 'string') return parsed.detail
    if (parsed.detail && typeof parsed.detail.error === 'string') {
      return parsed.detail.error
    }
  }
  if (status === 401) return 'Invalid API key. Update it in Settings.'
  if (status === 0) return 'The run could not be started.'
  return `Backend request failed (${status}).`
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const base = config.baseUrl.replace(/\/+$/, '')

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('X-API-Key', config.apiKey)
    if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    let response: Response
    try {
      response = await fetch(`${base}${path}`, { ...init, headers })
    } catch (cause) {
      throw new ApiError(0, messageFrom(0, null), cause)
    }

    if (!response.ok) {
      let body: unknown = null
      try {
        body = await response.json()
      } catch {
        body = await response.text().catch(() => null)
      }
      throw new ApiError(response.status, messageFrom(response.status, body), body)
    }
    return (await response.json()) as T
  }

  async function fetchProtectedImage(
    url: string,
    signal?: AbortSignal,
  ): Promise<string> {
    let response: Response
    try {
      response = await fetch(url, { headers: { 'X-API-Key': config.apiKey }, signal })
    } catch (cause) {
      throw new ApiError(0, messageFrom(0, null), cause)
    }
    if (!response.ok) {
      throw new ApiError(response.status, messageFrom(response.status, null))
    }
    return URL.createObjectURL(await response.blob())
  }

  return {
    uploadPanorama: (file) => {
      const form = new FormData()
      form.append('file', file)
      return request<UploadResponse>('/api/panoramas', {
        method: 'POST',
        body: form,
      })
    },
    createEpisode: (payload) =>
      request<{ episode_id: string }>('/api/episodes', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    cancelEpisode: (id) =>
      request<{ episode_id: string; cancelled: boolean }>(
        `/api/episodes/${encodeURIComponent(id)}/cancel`,
        { method: 'POST' },
      ),
    compare: (payload) =>
      request<CompareResponse>('/api/compare', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    fetchStepImage: (id, step, signal) =>
      fetchProtectedImage(
        `${base}/api/episodes/${encodeURIComponent(id)}/steps/${step}/image`,
        signal,
      ),
    fetchPanorama: (path, signal) =>
      fetchProtectedImage(`${base}/api/panoramas/${encodeURIComponent(path)}/image`, signal),
  }
}
