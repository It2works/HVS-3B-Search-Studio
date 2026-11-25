import { useEffect, useState } from 'react'
import { ApiError } from './client'

interface ResourceState {
  url?: string
  error: string | null
  empty: boolean
}

/** Resolves an image through the source and revokes blob URLs on change. */
export function useResourceUrl(
  load: (signal: AbortSignal) => Promise<string> | string,
): ResourceState {
  const [state, setState] = useState<ResourceState>({ error: null, empty: false })

  useEffect(() => {
    const controller = new AbortController()
    let createdBlob: string | undefined
    setState({ error: null, empty: false })

    void Promise.resolve()
      .then(() => load(controller.signal))
      .then((url) => {
        if (controller.signal.aborted) return
        if (!url) {
          setState({ error: null, empty: true })
          return
        }
        if (url.startsWith('blob:')) createdBlob = url
        setState({ url, error: null, empty: false })
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        const message =
          cause instanceof ApiError || cause instanceof Error
            ? cause.message
            : 'Image could not be loaded.'
        setState({ error: message, empty: false })
      })

    return () => {
      controller.abort()
      if (createdBlob) URL.revokeObjectURL(createdBlob)
    }
  }, [load])

  return state
}
