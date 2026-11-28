import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { EpisodeSource } from '../api/source'
import type { RunFile, Step } from '../api/types'
import { PanoramaStage } from './PanoramaStage'

const source: EpisodeSource = {
  stepImage: async () => '',
  panoramaImage: async () => '',
}

const run: RunFile = {
  id: 'ep_x',
  created_at: '2026-11-21T00:00:00Z',
  model: 'mock',
  task: 'HOS',
  instruction: 'go',
  pano: { id: 'p', width: 1024, height: 512, file: 'panorama.jpg' },
  config: {
    fov: 90,
    view_px: 448,
    max_steps: 8,
    context_turns: 0,
    start: { yaw: 0, pitch: 0 },
    prompt_sha: '',
  },
  ground_truth: null,
  steps: [],
  result: { status: 'submitted', final: { yaw: 0, pitch: 0 }, success: null, error: null },
}

const step: Step = {
  t: 1,
  pose: { yaw: 350, pitch: 0 },
  image: 'step_1.jpg',
  image_url: 'data:image/jpeg;base64,QUJD',
  raw: 'rotate(-10,0)',
  think: 'turn',
  action: { type: 'rotate', dyaw: -10, dpitch: 0 },
  parse_ok: true,
  latency_ms: 10,
}

function renderStage(props: Partial<Parameters<typeof PanoramaStage>[0]> = {}) {
  return render(
    <PanoramaStage
      run={run}
      source={source}
      pose={{ yaw: 350, pitch: 0 }}
      fov={90}
      activeStep={null}
      locked={false}
      {...props}
    />,
  )
}

describe('PanoramaStage', () => {
  afterEach(cleanup)

  it('labels the view with the normalized heading', () => {
    renderStage()
    expect(
      screen.getByRole('img', {
        name: 'Robot view at yaw 350 degrees, pitch 0 degrees',
      }),
    ).toBeInTheDocument()
  })

  it('falls back to the active step frame when WebGL is unavailable', () => {
    renderStage({ activeStep: step })
    const image = document.querySelector('img[src="data:image/jpeg;base64,QUJD"]')
    expect(image).toBeInTheDocument()
  })

  it('invites a scene before a run exists', () => {
    renderStage({ run: null, activeStep: null })
    expect(screen.getByText('Waiting for a scene…')).toBeInTheDocument()
  })
})
