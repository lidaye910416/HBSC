// frontend-vite/src/components/hero/shaders/fragment.glsl.ts
//
// Fragment shader injection for MeshStandardMaterial.
// We modulate `totalEmissiveRadiance` AFTER Three.js has computed it
// (it's declared as a vec3 in <emissivemap_fragment> chunk territory).

export const commonInjection = /* glsl */ `
varying float vDisplace;
`

export const emissiveInjection = /* glsl */ `
  totalEmissiveRadiance *= ( 1.0 + vDisplace * 0.4 );
`