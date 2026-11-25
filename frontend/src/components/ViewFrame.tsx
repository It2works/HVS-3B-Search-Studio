import { useCallback } from 'react'
import { useResourceUrl } from '../api/useResourceUrl'
import type { EpisodeSource } from '../api/source'
import type { Pose, RunFile, Step } from '../api/types'

const angle = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

interface ViewFrameProps {
  run: RunFile
  step?: Step
  source: EpisodeSource
}

export function ViewFrame({ run, step, source }: ViewFrameProps) {
  const imageUrl = step?.image_url

  const load = useCallback(
    (signal: AbortSignal) => {
      // The prototype sends the rendered view inline; no image fetch needed.
      if (step?.image_url) return ''
      return step ? source.stepImage(run, step, signal) : source.panoramaImage(run, signal)
    },
    [source, run, step],
  )
  const { url, error, empty } = useResourceUrl(load)
  const pose: Pose | null = step?.pose ?? null
  const alt = pose
    ? `View at yaw ${angle.format(pose.yaw)} degrees, pitch ${angle.format(pose.pitch)} degrees, step ${step?.t}`
    : `Equirectangular panorama ${run.pano.width} by ${run.pano.height}`

  return (
    <figure className="view">
      <div className={step ? 'view__canvas' : 'view__canvas view__canvas--pano'}>
        {imageUrl ? (
          <>
            <img src={imageUrl} width={448} height={448} alt={alt} />
            <span className="view__crosshair" aria-hidden="true" />
          </>
        ) : error ? (
          <p className="view__message view__message--error" role="alert">
            {error}
          </p>
        ) : empty ? (
          <p className="view__message">No image was sent with this step.</p>
        ) : url ? (
          <img src={url} width={448} height={448} alt={alt} />
        ) : (
          <p className="view__message">Loading view…</p>
        )}
      </div>
      <figcaption className="view__caption">
        <span>{pose ? `Step ${step?.t}` : 'Source panorama'}</span>
        <span className="readout">
          {pose
            ? `yaw ${angle.format(pose.yaw)}°, pitch ${angle.format(pose.pitch)}°`
            : `${run.pano.width} × ${run.pano.height}`}
        </span>
      </figcaption>
    </figure>
  )
}
