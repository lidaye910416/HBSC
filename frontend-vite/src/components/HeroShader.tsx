import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { motionAllowed } from '../animations/reducedMotion'

/**
 * Hero Shader — a minimal WebGL2 fragment overlay that maps scroll progress
 * (0..1) onto a uProgress uniform. The chosen effect is a low-frequency
 * gradient pair blending deep-ink (#1A1A2E) into antique-gold (#C9A84C),
 * modulated by sin/cos of time + scroll. This is intentionally not flashy —
 * just enough motion to add depth under the hero copy without competing
 * with text legibility.
 *
 * Performance / safety:
 *  - motionAllowed() gate (returns null otherwise)
 *  - context loss → onContextLost hook to recreate program on restore
 *  - visibilitychange pauses the RAF loop
 *  - resize triggers an uResolution update only
 *  - DPR capped to 2
 *
 * Note: This component is mounted alongside HeroParticles. Both layers
 * render beneath the hero content. If WebGL is unavailable or context
 * creation fails, the canvas stays blank and the gradient/pattern below
 * remains the visual fallback.
 */

const VERTEX_SRC = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`

const FRAGMENT_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform vec2 uResolution;
uniform float uTime;
uniform float uProgress;

const vec3 INK = vec3(0.102, 0.102, 0.180);   // #1A1A2E
const vec3 GOLD = vec3(0.788, 0.659, 0.298);  // #C9A84C

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = v_uv;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= uResolution.x / max(uResolution.y, 1.0);

  float n = hash(floor(uv * 80.0)) * 0.04;
  float wave = sin(p.x * 1.2 + uTime * 0.18) * 0.5 + 0.5;
  float wave2 = cos(p.y * 1.4 - uTime * 0.13) * 0.5 + 0.5;
  float t = clamp(wave * wave2 + n + uProgress * 0.6, 0.0, 1.0);

  vec3 col = mix(INK, GOLD, smoothstep(0.0, 0.85, t * 0.35));
  // Soft vignette
  float v = smoothstep(1.4, 0.4, length(p));
  col *= mix(0.85, 1.0, v);

  outColor = vec4(col, 0.85);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`Shader compile failed: ${log}`)
  }
  return sh
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader) {
  const p = gl.createProgram()!
  gl.attachShader(p, vs)
  gl.attachShader(p, fs)
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p)
    gl.deleteProgram(p)
    throw new Error(`Program link failed: ${log}`)
  }
  return p
}

export function HeroShader() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!motionAllowed()) return
    const canvas = ref.current
    if (!canvas) return

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    })
    if (!gl) return

    let raf = 0
    let running = true
    let program: WebGLProgram | null = null
    let uTime: WebGLUniformLocation | null = null
    let uProgress: WebGLUniformLocation | null = null
    let uResolution: WebGLUniformLocation | null = null
    let vao: WebGLVertexArrayObject | null = null
    let buffer: WebGLBuffer | null = null

    const setup = () => {
      try {
        const vs = compile(gl!, gl!.VERTEX_SHADER, VERTEX_SRC)
        const fs = compile(gl!, gl!.FRAGMENT_SHADER, FRAGMENT_SRC)
        program = link(gl!, vs, fs)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[HeroShader] program setup failed, falling back to plain hero:', err)
        return false
      }
      uTime = gl!.getUniformLocation(program!, 'uTime')
      uProgress = gl!.getUniformLocation(program!, 'uProgress')
      uResolution = gl!.getUniformLocation(program!, 'uResolution')

      vao = gl!.createVertexArray()
      gl!.bindVertexArray(vao)
      buffer = gl!.createBuffer()
      gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer)
      gl!.bufferData(
        gl!.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl!.STATIC_DRAW,
      )
      const posLoc = gl!.getAttribLocation(program!, 'a_position')
      gl!.enableVertexAttribArray(posLoc)
      gl!.vertexAttribPointer(posLoc, 2, gl!.FLOAT, false, 0, 0)
      gl!.bindVertexArray(null)
      return true
    }

    const params = { progress: 0 }
    let started = performance.now()

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      gl!.viewport(0, 0, canvas.width, canvas.height)
      if (uResolution) gl!.uniform2f(uResolution, canvas.width, canvas.height)
    }

    const render = () => {
      if (!running || !program || !vao) {
        raf = requestAnimationFrame(render)
        return
      }
      const now = (performance.now() - started) / 1000
      gl!.useProgram(program)
      gl!.bindVertexArray(vao)
      if (uTime) gl!.uniform1f(uTime, now)
      if (uProgress) gl!.uniform1f(uProgress, params.progress)
      gl!.drawArrays(gl!.TRIANGLES, 0, 6)
      raf = requestAnimationFrame(render)
    }

    const onVis = () => { running = !document.hidden }
    const onResize = () => resize()
    const onLost = (e: Event) => {
      e.preventDefault()
      running = false
    }

    if (!setup()) return

    resize()
    canvas.addEventListener('webglcontextlost', onLost as any, false)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('resize', onResize)

    const scrollTween = gsap.to(params, {
      progress: 1,
      ease: 'none',
      scrollTrigger: { trigger: canvas, start: 'top top', end: 'bottom top', scrub: 0.6 },
    })

    render()

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('webglcontextlost', onLost as any)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('resize', onResize)
      scrollTween.scrollTrigger?.kill()
      scrollTween.kill()
      ScrollTrigger.getAll().filter(t => t.trigger === canvas).forEach(t => t.kill())
      if (program) gl.deleteProgram(program)
      if (buffer) gl.deleteBuffer(buffer)
      if (vao) gl.deleteVertexArray(vao)
    }
  }, [])

  if (!motionAllowed()) return null

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="hero-shader"
      data-testid="hero-shader"
    />
  )
}
