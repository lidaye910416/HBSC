// frontend-vite/src/components/hero/shaders/vertex.glsl.ts
//
// Vertex shader injection for MeshStandardMaterial.
// We HOOK into existing Three.js chunks, not write our own main().
// Three.js generates `void main() { #include <begin_vertex> ... #include <project_vertex> ... }`
// and we replace `<begin_vertex>` to displace position, then `<project_vertex>`
// to multiply with instanceMatrix (already included by default for InstancedMesh).

export const beginVertexInjection = /* glsl */ `
  vec3 transformed = vec3( position );

  // 1. Surface liquid wave (always running)
  float wave = sin( transformed.x * 3.0 + uTime * 0.6 )
             + cos( transformed.y * 2.5 - uTime * 0.5 );
  transformed += normal * wave * 0.08;

  // 2. Mouse proximity bump (in local vertex space approximation)
  //    uMouse is NDC [-1, 1]; we use it as a 2D bias in object XY plane
  vec2 toMouse = uMouse - transformed.xy;
  float dist = length( toMouse );
  float bump = smoothstep( 0.6, 0.0, dist ) * 0.15;
  transformed += normal * bump;

  vDisplace = wave + bump;
`

export const commonInjection = /* glsl */ `
varying float vDisplace;
uniform float uTime;
uniform vec2  uMouse;
uniform vec2  uMouseVel;
`