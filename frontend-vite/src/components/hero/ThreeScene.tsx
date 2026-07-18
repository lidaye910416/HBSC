// frontend-vite/src/components/hero/ThreeScene.tsx
//
// ThreeScene — pure three renderer. No React state.
//
// Responsibilities:
//   - WebGLRenderer + Scene + PerspectiveCamera + Lights
//   - InstancedMesh of N icosahedrons (A/B alternating)
//   - GLSL vertex displacement (uTime + uMouse bump) + emissive fragment modulation
//   - RAF tick: stepCluster + write instanceMatrix + update uniforms
//   - DPR cap + visibility gate + cleanup (StrictMode-safe)
//   - ScrollTrigger: drive camera dolly + cluster rotation as hero scrolls out
//   - Mouse world position: derived from ndcRef + own camera in RAF (pointer.worldRef
//     may be null when hook is created with camera=null — see B2 fix below)

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { vertexInjection } from './shaders/vertex.glsl'
import { fragmentInjection } from './shaders/fragment.glsl'
import {
  buildCluster,
  stepCluster,
  applyClusterStep,
  type ClusterNode,
  type Vec3Like,
} from './geometryCluster'
import type { PointerGravityRefs } from './usePointerGravity'
import type { GpuTier } from './useHeroCapability'

export interface ThreeSceneProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  tier: GpuTier
  pointer: PointerGravityRefs
}

const TIER_INSTANCE_COUNT: Record<GpuTier, number> = {
  high: 24,
  mid: 18,
  low: 12,
  none: 0,
}

const TIER_DPR_CAP: Record<GpuTier, number> = {
  high: 2,
  mid: 1.5,
  low: 1,
  none: 1,
}

export function ThreeScene({ canvasRef, tier, pointer }: ThreeSceneProps) {
  const sceneStateRef = useRef<{
    renderer?: THREE.WebGLRenderer
    scene?: THREE.Scene
    camera?: THREE.PerspectiveCamera
    mesh?: THREE.InstancedMesh
    material?: THREE.MeshStandardMaterial
    geometry?: THREE.IcosahedronGeometry
    nodes?: ClusterNode[]
    raf?: number
    running?: boolean
    startTime?: number
    lastTime?: number
    scrollExitT?: number
  }>({})

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (tier === 'none') return

    const count = TIER_INSTANCE_COUNT[tier]
    const dprCap = TIER_DPR_CAP[tier]

    // 1. Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: tier !== 'low',
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap))

    // 2. Scene + camera
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 0, 6)

    // 3. Lights — warm gold key + cool blue hemi
    const key = new THREE.DirectionalLight(0xffd89b, 0.6)
    key.position.set(3, 4, 4)
    const hemi = new THREE.HemisphereLight(0x1a2e5a, 0x0f172a, 0.4)
    scene.add(key, hemi)

    // 4. Geometry — alternating A/B sizes, with shader injection
    const geometry = new THREE.IcosahedronGeometry(1, 0)
    const material = new THREE.MeshStandardMaterial({
      color: 0xc9a84c,
      emissive: 0x3a2e14,
      metalness: 0.85,
      roughness: 0.25,
      transparent: true,
      opacity: 0.92,
    })

    // Shader uniforms (shared with onBeforeCompile injection below)
    const uniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uMouseVel: { value: new THREE.Vector2(0, 0) },
    }

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime
      shader.uniforms.uMouse = uniforms.uMouse
      shader.uniforms.uMouseVel = uniforms.uMouseVel

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\n${vertexInjection}`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\n${fragmentInjection}`,
        )
    }
    material.needsUpdate = true

    const mesh = new THREE.InstancedMesh(geometry, material, count)
    scene.add(mesh)

    // 5. Cluster data
    const nodes = buildCluster(count)
    const dummy = new THREE.Object3D()
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!
      dummy.position.set(n.basePos.x, n.basePos.y, n.basePos.z)
      const s = n.scale * (n.type === 'A' ? 1.0 : 0.7)
      dummy.scale.set(s, s, s)
      dummy.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI,
      )
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true

    // 6. Sizing
    const resize = () => {
      const w = canvas.clientWidth || canvas.parentElement?.clientWidth || window.innerWidth
      const h = canvas.clientHeight || canvas.parentElement?.clientHeight || window.innerHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(h, 1)
      camera.updateProjectionMatrix()
    }
    resize()
    window.addEventListener('resize', resize)

    // 7. Visibility / context-lost
    let running = true
    const onVis = () => {
      running = !document.hidden
    }
    const onLost = (e: Event) => {
      e.preventDefault()
      running = false
    }
    document.addEventListener('visibilitychange', onVis)
    canvas.addEventListener('webglcontextlost', onLost as EventListener)

    // 8. RAF tick
    const startTime = performance.now()
    let lastTime = startTime
    // B1 fix: drive scrollExitT via ScrollTrigger so the camera/cluster actually
    // respond to hero scrolling out of view (was dead code before — declared,
    // never written, always 0).
    let scrollExitT = 0
    const scrollTrigger = ScrollTrigger.create({
      trigger: canvas.parentElement || document.body,
      start: 'top top',
      end: 'bottom top',
      scrub: 0.6,
      onUpdate: (self) => {
        scrollExitT = self.progress
      },
    })

    // B2 fix: derive worldRef in RAF from ndcRef + this camera.
    // (usePointerGravity was created with camera:null so worldRef stayed (0,0,0).)
    const _tmpVec = new THREE.Vector3()
    const _mouseWorldEuler: Vec3Like = { x: 0, y: 0, z: 0 }

    const tick = () => {
      if (!running) {
        sceneStateRef.current.raf = requestAnimationFrame(tick)
        return
      }
      const now = performance.now()
      const dt = Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now

      // Derive world position from NDC + camera (fix B2)
      _tmpVec.set(pointer.ndcRef.current.x, pointer.ndcRef.current.y, 0.5)
        .unproject(camera)
      const dir = _tmpVec.sub(camera.position).normalize()
      if (Math.abs(dir.z) > 0.001) {
        const distance = -camera.position.z / dir.z
        _tmpVec.copy(camera.position).add(dir.multiplyScalar(distance))
        _mouseWorldEuler.x = _tmpVec.x
        _mouseWorldEuler.y = _tmpVec.y
        _mouseWorldEuler.z = _tmpVec.z
      }

      // Step cluster forces
      const next = stepCluster(nodes, _mouseWorldEuler, dt)
      applyClusterStep(nodes, next)

      // Write instance matrix
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!
        dummy.position.set(n.basePos.x, n.basePos.y, n.basePos.z)
        const s = n.scale * (n.type === 'A' ? 1.0 : 0.7)
        dummy.scale.set(s, s, s)
        dummy.rotation.x += n.spin.x
        dummy.rotation.y += n.spin.y
        dummy.rotation.z += n.spin.z
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true

      // Apply scroll-coupled exit transform
      camera.position.z = 6 - 1.5 * scrollExitT
      mesh.rotation.z = 0.4 * scrollExitT

      // Update shader uniforms
      uniforms.uTime!.value = (now - startTime) / 1000
      uniforms.uMouse!.value.copy(pointer.ndcRef.current)
      uniforms.uMouseVel!.value.copy(pointer.velocityRef.current)

      renderer.render(scene, camera)
      sceneStateRef.current.raf = requestAnimationFrame(tick)
    }
    sceneStateRef.current.startTime = startTime
    tick()

    // 9. Expose for cleanup
    sceneStateRef.current.renderer = renderer
    sceneStateRef.current.scene = scene
    sceneStateRef.current.camera = camera
    sceneStateRef.current.mesh = mesh
    sceneStateRef.current.material = material
    sceneStateRef.current.geometry = geometry
    sceneStateRef.current.nodes = nodes
    sceneStateRef.current.running = true
    sceneStateRef.current.scrollExitT = scrollExitT
    sceneStateRef.current.lastTime = lastTime
    ;(sceneStateRef.current as unknown as { uniforms?: typeof uniforms }).uniforms = uniforms

    // 10. Cleanup
    return () => {
      running = false
      if (sceneStateRef.current.raf) {
        cancelAnimationFrame(sceneStateRef.current.raf)
      }
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
      canvas.removeEventListener('webglcontextlost', onLost as EventListener)
      scrollTrigger.kill()
      // B4 fix: InstancedMesh has no dispose() — remove the no-op call.
      // B5 fix: WebGLRenderer.dispose() does not release the GL context
      // — explicit forceContextLoss() is required.
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      const loseExt = renderer.getContext().getExtension('WEBGL_lose_context')
      loseExt?.loseContext()
      // Drop references
      sceneStateRef.current = {}
    }
  }, [canvasRef, tier, pointer])

  return null
}