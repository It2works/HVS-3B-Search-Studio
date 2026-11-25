import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { EpisodeSource } from '../api/source'
import type { RunFile, Step } from '../api/types'
import { StepTimeline } from './StepTimeline'

const source = {} as EpisodeSource

function runWith(step: Step): RunFile {
  return {
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
    steps: [step],
    result: { status: 'submitted', final: { yaw: 0, pitch: 0 }, success: null, error: null },
  }
}

const baseStep: Step = {
  t: 1,
  pose: { yaw: 0, pitch: 0 },
  image: 'step_1.jpg',
  raw: 'rotate(1,0)',
  think: 'turn',
  action: { type: 'rotate', dyaw: 1, dpitch: 0 },
  parse_ok: true,
}

afterEach(cleanup)

describe('StepTimeline', () => {
  it('uses the inline data URI for the thumbnail and shows latency_ms', () => {
    const { container } = render(
      <StepTimeline
        run={runWith({
          ...baseStep,
          image_url: 'data:image/jpeg;base64,QUJD',
          latency_ms: 2310,
        })}
        source={source}
        current={1}
        onSelect={() => {}}
      />,
    )
    const thumbnail = container.querySelector('.timeline__thumb img')
    expect(thumbnail).toHaveAttribute('src', 'data:image/jpeg;base64,QUJD')
    expect(screen.getByText('2,310 ms')).toBeInTheDocument()
    expect(screen.queryByText('NaN ms')).toBeNull()
  })

  it('shows a dash when latency_ms is absent', () => {
    render(
      <StepTimeline
        run={runWith(baseStep)}
        source={source}
        current={1}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
