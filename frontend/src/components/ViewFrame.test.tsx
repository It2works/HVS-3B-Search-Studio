import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { EpisodeSource } from '../api/source'
import type { RunFile, Step } from '../api/types'
import { ViewFrame } from './ViewFrame'

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
  pose: { yaw: 0, pitch: 0 },
  image: 'step_1.jpg',
  image_url: 'data:image/jpeg;base64,QUJD',
  raw: 'rotate(1,0)',
  think: 'turn',
  action: { type: 'rotate', dyaw: 1, dpitch: 0 },
  parse_ok: true,
  latency_ms: 10,
}

const source = {} as EpisodeSource

afterEach(cleanup)

describe('ViewFrame', () => {
  it('renders the inline data URI with a center crosshair', () => {
    const { container } = render(<ViewFrame run={run} step={step} source={source} />)
    const image = screen.getByRole('img', { name: /view at yaw 0 degrees/i })
    expect(image).toHaveAttribute('src', 'data:image/jpeg;base64,QUJD')
    expect(container.querySelector('.view__crosshair')).toBeInTheDocument()
    expect(screen.queryByText('No image was sent with this step.')).toBeNull()
  })
})
