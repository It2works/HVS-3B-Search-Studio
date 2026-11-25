import { useCallback } from 'react'
import { useResourceUrl } from '../api/useResourceUrl'
import type { EpisodeSource } from '../api/source'
import type { Pose, RunFile } from '../api/types'

interface MinimapProps {
  run: RunFile
  pose: Pose
  source: EpisodeSource
}

function normalizedYaw(yaw: number): number {
  return ((yaw % 360) + 360) % 360
}

/** Contract math: u = (lon/2π + 0.5)·W, v = (0.5 − lat/π)·H. */
function project(pose: Pose, width: number, height: number) {
  return {
    u: (normalizedYaw(pose.yaw) / 360 + 0.5) * width,
    v: (0.5 - pose.pitch / 180) * height,
  }
}

export function Minimap({ run, pose, source }: MinimapProps) {
  const load = useCallback(
    (signal: AbortSignal) => source.panoramaImage(run, signal),
    [source, run],
  )
  const { url, error, empty } = useResourceUrl(load)
  const { width: W, height: H } = run.pano
  const fov = run.config.fov

  const center = project(pose, W, H)
  const fovWidth = (fov / 360) * W
  const fovHeight = (fov / 180) * H
  const trail = [run.config.start, ...run.steps.map((step) => step.pose)]
  const points = trail.map((item) => project(item, W, H))

  // Split the trajectory at the horizontal seam so it does not stripe the map.
  const segments: Array<Array<{ u: number; v: number }>> = []
  let current = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    if (Math.abs(points[i].u - points[i - 1].u) > W / 2) {
      segments.push(current)
      current = [points[i]]
    } else {
      current.push(points[i])
    }
  }
  segments.push(current)

  const target = run.ground_truth ? project(run.ground_truth, W, H) : null

  return (
    <figure className="minimap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Panorama map. Field of view ${fov} degrees at yaw ${pose.yaw.toFixed(1)}, pitch ${pose.pitch.toFixed(1)}.`}
      >
        <title>Panorama and trajectory</title>
        {url && <image href={url} x={0} y={0} width={W} height={H} />}
        {segments.map((segment, index) =>
          segment.length > 1 ? (
            <polyline
              key={index}
              points={segment.map((p) => `${p.u},${p.v}`).join(' ')}
              className="minimap__trail"
            />
          ) : null,
        )}
        <rect
          x={center.u - fovWidth / 2}
          y={center.v - fovHeight / 2}
          width={fovWidth}
          height={fovHeight}
          className="minimap__fov"
        />
        {target && (
          <g className="minimap__target">
            <line x1={target.u - 24} y1={target.v} x2={target.u + 24} y2={target.v} />
            <line x1={target.u} y1={target.v - 24} x2={target.u} y2={target.v + 24} />
          </g>
        )}
        <circle cx={center.u} cy={center.v} r={10} className="minimap__here" />
      </svg>
      <figcaption className="minimap__caption">
        {error
          ? error
          : empty
            ? 'No panorama supplied by the prototype'
            : target
              ? 'Dashed line: path. Cross: target.'
              : 'Dashed line: path taken'}
      </figcaption>
    </figure>
  )
}
