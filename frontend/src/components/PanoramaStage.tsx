import { useCallback, useEffect, useRef, useState } from 'react'
import type { EpisodeSource } from '../api/source'
import type { Pose, RunFile, Step } from '../api/types'
import { useResourceUrl } from '../api/useResourceUrl'
import { normalizeYaw } from '../state/playback'

interface PanoramaStageProps {
  run: RunFile | null
  source: EpisodeSource
  pose: Pose
  fov: number
  activeStep: Step | null
  locked: boolean
}

const VERTEX_SHADER = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uPano;
uniform vec2 uResolution;
uniform float uYaw;
uniform float uPitch;
uniform float uFov;

const float TAU = 6.28318530718;
const float PI = 3.14159265359;

void main() {
  vec2 p = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
  float focal = tan(uFov * 0.5);
  float x = p.x * focal;
  float y = p.y * focal;

  float sy = sin(uYaw);
  float cy = cos(uYaw);
  float sp = sin(uPitch);
  float cp = cos(uPitch);

  float dx = sy * cp + x * cy + y * (-sy * sp);
  float dy = sp + y * cp;
  float dz = cy * cp + x * (-sy) + y * (-cy * sp);

  float lon = atan(dx, dz);
  float lat = atan(dy, sqrt(dx * dx + dz * dz));
  vec2 uv = vec2(lon / TAU + 0.5, 0.5 - lat / PI);

  gl_FragColor = texture2D(uPano, uv);
}
`

const PANO_WIDTH = 2048
const PANO_HEIGHT = 1024

const TICKS = Array.from({ length: 24 }, (_, index) => {
  const angle = (index * 15 * Math.PI) / 180
  const inner = index % 6 === 0 ? 87 : 92
  const outer = 97
  return {
    x1: 100 + Math.sin(angle) * inner,
    y1: 100 - Math.cos(angle) * inner,
    x2: 100 + Math.sin(angle) * outer,
    y2: 100 - Math.cos(angle) * outer,
    major: index % 6 === 0,
  }
})

function supportsWebgl(): boolean {
  return (
    typeof WebGLRenderingContext !== 'undefined' ||
    typeof WebGL2RenderingContext !== 'undefined'
  )
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function buildProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
    return null
  }
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    return null
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  return program
}

function uploadPanorama(gl: WebGLRenderingContext, image: HTMLImageElement): WebGLTexture | null {
  const canvas = document.createElement('canvas')
  canvas.width = PANO_WIDTH
  canvas.height = PANO_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(image, 0, 0, PANO_WIDTH, PANO_HEIGHT)

  const texture = gl.createTexture()
  if (!texture) return null
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.bindTexture(gl.TEXTURE_2D, null)
  return texture
}

interface Uniforms {
  pano: WebGLUniformLocation | null
  resolution: WebGLUniformLocation | null
  yaw: WebGLUniformLocation | null
  pitch: WebGLUniformLocation | null
  fov: WebGLUniformLocation | null
  position: number
}

/** A circular robot-eye view rendered live from the equirectangular panorama. */
export function PanoramaStage({
  run,
  source,
  pose,
  fov,
  activeStep,
  locked,
}: PanoramaStageProps) {
  const [canRender] = useState(supportsWebgl)
  const [failed, setFailed] = useState(false)
  const [failedPano, setFailedPano] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [size, setSize] = useState({ width: 0, height: 0 })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<WebGLRenderingContext | null>(null)
  const programRef = useRef<WebGLProgram | null>(null)
  const bufferRef = useRef<WebGLBuffer | null>(null)
  const textureRef = useRef<WebGLTexture | null>(null)
  const uniformsRef = useRef<Uniforms | null>(null)

  const runRef = useRef(run)
  runRef.current = run
  const stepRef = useRef(activeStep)
  stepRef.current = activeStep

  const panoKey = run ? `${run.pano.id}:${run.pano.file}` : ''
  const loadPano = useCallback(
    (signal: AbortSignal) => {
      const current = runRef.current
      if (!current || !panoKey) return ''
      return source.panoramaImage(current, signal)
    },
    [source, panoKey],
  )
  const pano = useResourceUrl(loadPano)

  const stepKey = activeStep ? `${activeStep.t}:${activeStep.image_url ?? activeStep.image}` : ''
  const loadStep = useCallback(
    (signal: AbortSignal) => {
      const current = runRef.current
      const step = stepRef.current
      if (!current || !step || step.image_url || !stepKey) return ''
      return source.stepImage(current, step, signal)
    },
    [source, stepKey],
  )
  const stepImage = useResourceUrl(loadStep)

  // One GL context, program and full-screen triangle per mounted stage.
  useEffect(() => {
    if (!canRender) return
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false })
    if (!gl) {
      setFailed(true)
      return
    }
    const program = buildProgram(gl)
    const buffer = gl.createBuffer()
    if (!program || !buffer) {
      if (program) gl.deleteProgram(program)
      if (buffer) gl.deleteBuffer(buffer)
      setFailed(true)
      return
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )
    glRef.current = gl
    programRef.current = program
    bufferRef.current = buffer
    uniformsRef.current = {
      pano: gl.getUniformLocation(program, 'uPano'),
      resolution: gl.getUniformLocation(program, 'uResolution'),
      yaw: gl.getUniformLocation(program, 'uYaw'),
      pitch: gl.getUniformLocation(program, 'uPitch'),
      fov: gl.getUniformLocation(program, 'uFov'),
      position: gl.getAttribLocation(program, 'aPos'),
    }
    return () => {
      if (textureRef.current) gl.deleteTexture(textureRef.current)
      if (bufferRef.current) gl.deleteBuffer(bufferRef.current)
      if (programRef.current) gl.deleteProgram(programRef.current)
      textureRef.current = null
      bufferRef.current = null
      programRef.current = null
      glRef.current = null
      uniformsRef.current = null
    }
  }, [canRender])

  // Load the panorama into a power-of-two texture so REPEAT is seamless.
  useEffect(() => {
    if (!canRender || failed || !pano.url) return
    const gl = glRef.current
    if (!gl) return
    let cancelled = false
    setReady(false)
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => {
      if (cancelled) return
      const texture = uploadPanorama(gl, image)
      if (!texture) {
        setFailedPano(pano.url ?? null)
        return
      }
      if (textureRef.current) gl.deleteTexture(textureRef.current)
      textureRef.current = texture
      setReady(true)
    }
    image.onerror = () => {
      if (!cancelled) setFailedPano(pano.url ?? null)
    }
    image.src = pano.url
    return () => {
      cancelled = true
      image.onload = null
      image.onerror = null
    }
  }, [canRender, failed, pano.url])

  // Keep the drawing buffer matched to the circular lens at device resolution.
  useEffect(() => {
    if (!canRender) return
    const parent = canvasRef.current?.parentElement
    if (!parent) return
    const update = () => {
      const rect = parent.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      setSize({
        width: Math.max(1, Math.round(rect.width * dpr)),
        height: Math.max(1, Math.round(rect.height * dpr)),
      })
    }
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [canRender])

  useEffect(() => {
    const gl = glRef.current
    const program = programRef.current
    const buffer = bufferRef.current
    const texture = textureRef.current
    const uniforms = uniformsRef.current
    const canvas = canvasRef.current
    if (!ready || !gl || !program || !buffer || !texture || !uniforms || !canvas) return

    const width = size.width || canvas.clientWidth || 1
    const height = size.height || canvas.clientHeight || 1
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(uniforms.position)
    gl.vertexAttribPointer(uniforms.position, 2, gl.FLOAT, false, 0, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(uniforms.pano, 0)
    gl.uniform2f(uniforms.resolution, width, height)
    gl.uniform1f(uniforms.yaw, (pose.yaw * Math.PI) / 180)
    gl.uniform1f(uniforms.pitch, (pose.pitch * Math.PI) / 180)
    gl.uniform1f(uniforms.fov, (fov * Math.PI) / 180)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }, [ready, size, pose.yaw, pose.pitch, fov])

  const fallbackUrl = activeStep?.image_url || stepImage.url
  const showingCanvas = canRender && ready && !failed && failedPano !== pano.url
  const yaw = Math.round(normalizeYaw(pose.yaw)) % 360
  const pitch = Math.round(pose.pitch)
  const viewAlt = `Robot view at yaw ${yaw} degrees, pitch ${pitch} degrees`

  return (
    <div className="stage__lens">
      <svg
        className="stage__ring"
        viewBox="0 0 200 200"
        aria-hidden="true"
        style={{ transform: `rotate(${-pose.yaw}deg)` }}
      >
        <circle cx="100" cy="100" r="97" className="ring__track" />
        {TICKS.map((tick, index) => (
          <line
            key={index}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            className={tick.major ? 'ring__tick ring__tick--major' : 'ring__tick'}
          />
        ))}
      </svg>

      <div
        className={`lens${locked ? ' lens--locked' : ''}`}
        role="img"
        aria-label={viewAlt}
      >
        {canRender && (
          <canvas
            ref={canvasRef}
            className={`lens__canvas${showingCanvas ? '' : ' is-hidden'}`}
            aria-hidden="true"
          />
        )}
        {!showingCanvas && fallbackUrl && (
          <img className="lens__fallback" src={fallbackUrl} alt="" />
        )}
        {!showingCanvas && !fallbackUrl && (
          <p className="lens__empty">
            {pano.error ?? (run ? 'Loading the scene…' : 'Waiting for a scene…')}
          </p>
        )}
        <span className="lens__vignette" aria-hidden="true" />
        <span className="lens__reticle" aria-hidden="true" />
        <span className="lens__hud" aria-hidden="true">
          <span>YAW {String(yaw).padStart(3, '0')}°</span>
          <span className="lens__hud-sep" />
          <span>PITCH {pitch >= 0 ? '+' : '−'}{String(Math.abs(pitch)).padStart(2, '0')}°</span>
        </span>
      </div>

      <span className="stage__marker" aria-hidden="true" />
    </div>
  )
}
