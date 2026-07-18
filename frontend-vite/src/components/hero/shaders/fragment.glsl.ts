// frontend-vite/src/components/hero/shaders/fragment.glsl.ts

export const fragmentInjection = /* glsl */ `
varying float vDisplace;

void main() {
  // Standard MeshStandardMaterial output is already composed above this point.
  // We just modulate emissive by displacement (subtle).
  // Note: totalEmissiveRadiance is the variable name in three.js shaders.
  totalEmissiveRadiance *= (1.0 + vDisplace * 0.4);
}
`