// frontend-vite/src/components/hero/shaders/vertex.glsl.ts
//
// Vertex shader injection for MeshStandardMaterial.
// Displaces vertices by a low-frequency liquid wave + a mouse-proximity bump.

export const vertexInjection = /* glsl */ `
uniform float uTime;
uniform vec2  uMouse;        // NDC [-1, 1]
uniform vec2  uMouseVel;     // screen units / frame
varying float vDisplace;

void main() {
  vec3 p = position;

  // 1. Surface liquid wave (always running)
  float wave = sin(p.x * 3.0 + uTime * 0.6)
             + cos(p.y * 2.5 - uTime * 0.5);
  p += normal * wave * 0.08;

  // 2. Mouse proximity bump
  vec2 toMouse = uMouse - p.xy;
  float dist = length(toMouse);
  float bump = smoothstep(0.6, 0.0, dist) * 0.15;
  p += normal * bump;

  vDisplace = wave + bump;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
}
`