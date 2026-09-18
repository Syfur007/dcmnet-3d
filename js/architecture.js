/**
 * architecture.js
 * ----------------------------------------------------------------------------
 * A DATA-ONLY description of the DCM-Net architecture
 * (Atabansi et al., "DCM-Net: dual-encoder CNN-Mamba network with
 * cross-branch fusion for robust medical image segmentation",
 * BMC Medical Imaging (2025) 25:395).
 *
 * This file has no THREE.js dependency on purpose — it is the "ground truth"
 * graph (nodes + directed edges) that scene.js turns into 3D geometry and
 * flow.js turns into an animation. Edit the numbers here to change the
 * layout without touching any rendering code.
 *
 * The graph mirrors the paper's own equations:
 *   F_s   = DSConv(GN(A_f^s)) (+) DSConv(GN(P_f^s))          [CBFFM, eq.1]
 *   AP_f^s= F_s (+) MLP(GN(F_s))                              [CBFFM, eq.2]
 *   L3    = DoubleConv( concat( Up(AP_f^4), AP_f^3 ) )
 *   L2    = DoubleConv( concat( Up(D3),     AP_f^2 ) )
 *   L1    = DoubleConv( concat( Up(D2),     AP_f^1 ) )
 *   D_s   = DFEM(L_s)
 *   Y     = SegHead(D1)
 * ----------------------------------------------------------------------------
 */

// ---- Palette (hex numbers, ready for THREE.Color) --------------------------
export const PALETTE = {
  auxiliary: 0x4fd3ff,   // VSS / Mamba branch — "global" — cyan
  primary: 0xff9d4d,     // CNN / EfficientNet-B2 branch — "local" — orange
  fusion: 0xffd166,      // CBFFM — gold
  decoder: 0x63e6a0,     // DFEM decoder — green
  seghead: 0xff6f91,     // Segmentation head — pink
  io: 0xe8eef2,          // input/output image frames — near-white
  skipWire: 0xb388ff,    // skip-connection tint — violet
};

// ---- Helpers to derive visual size from real numbers in the paper ---------
const AUX_CH = [96, 192, 384, 768];      // auxiliary encoder channel widths
const PRI_CH = [24, 48, 120, 352];       // primary encoder / CBFFM channel widths
const MAX_CH = 768;

const STAGE_SPATIAL = [2.4, 2.0, 1.65, 1.35]; // relative spatial footprint (shrinks — downsampling)
const STAGE_X = [-10.8, -7.0, -3.2, 0.6];     // x position of each of the 4 stages
const DEC_X = [4.6, 8.2, 11.8];               // x position of the 3 decoder blocks (mirrors upsampling)
const DEC_SPATIAL = [1.65, 2.0, 2.4];         // growing back as the decoder upsamples

function depthFromChannels(c) {
  return 0.5 + 1.7 * (c / MAX_CH);
}

// ---- NODES ------------------------------------------------------------------
// type: "image" | "box" | "fusion" (octahedron) | "seghead"
// pos:  [x, y, z] in world units. size: spatial footprint. depth: channel-count viz.
export const NODES = [
  {
    id: "input", type: "image", role: "io",
    pos: [-15.2, 0, 0], size: 2.6,
    title: "Input Image",
    desc: "A medical image tensor I ∈ ℝ^(C×W×H) — a dermoscopy photo, endoscopy frame, ultrasound frame, or CT slice. It is fed into BOTH encoder branches at the same time.",
  },

  // --- Auxiliary encoder (Vision Mamba / VSS blocks) — the "global" branch
  ...[0, 1, 2, 3].map((i) => ({
    id: `aux${i + 1}`, type: "box", role: "auxiliary",
    pos: [STAGE_X[i], 4.3, 0], size: STAGE_SPATIAL[i], depth: depthFromChannels(AUX_CH[i]),
    title: `Auxiliary Encoder — Stage ${i + 1}`,
    desc: `${i === 0 ? "Patch Embedding" : "Patch Merging"} + VSS Block (SS2D). ` +
      `Output E_f^${i + 1} ∈ ℝ^(${AUX_CH[i]} × W/${2 ** (i + 2)} × H/${2 ** (i + 2)}). ` +
      `Captures long-range, non-local context with linear complexity.`,
  })),

  // --- Primary encoder (pretrained EfficientNet-B2 ConvNet) — the "local" branch
  ...[0, 1, 2, 3].map((i) => ({
    id: `pri${i + 1}`, type: "box", role: "primary",
    pos: [STAGE_X[i], -4.3, 0], size: STAGE_SPATIAL[i], depth: depthFromChannels(PRI_CH[i]),
    title: `Primary Encoder — Stage ${i + 1}`,
    desc: `ConvNet block from pretrained EfficientNet-B2. ` +
      `Output P_f^${i + 1} ∈ ℝ^(${PRI_CH[i]} × W/${2 ** (i + 2)} × H/${2 ** (i + 2)}). ` +
      `Captures fine-grained local texture and boundaries via ImageNet-pretrained weights.`,
  })),

  // --- Cross-Branch Feature Fusion Module (CBFFM) — one per stage
  ...[0, 1, 2, 3].map((i) => ({
    id: `cbffm${i + 1}`, type: "fusion", role: "fusion",
    pos: [STAGE_X[i], 0, 0], size: STAGE_SPATIAL[i] * 0.85, depth: depthFromChannels(PRI_CH[i]),
    title: `CBFFM — Stage ${i + 1}`,
    desc: `F_s = DSConv(GN(A_f^${i + 1})) ⊕ DSConv(GN(P_f^${i + 1})) \n` +
      `AP_f^${i + 1} = F_s ⊕ MLP(GN(F_s)) \n` +
      `Fuses global (Mamba) and local (CNN) features — no attention, linear complexity.`,
  })),

  // --- Decoder: Decoder Feature Enhancement Module (DFEM), 3 blocks
  ...[0, 1, 2].map((i) => {
    const decoderIdx = 3 - i; // D3, D2, D1
    return {
      id: `dec${decoderIdx}`, type: "box", role: "decoder",
      pos: [DEC_X[i], 0, 0], size: DEC_SPATIAL[i], depth: 1.4 - i * 0.3,
      title: `Decoder — DFEM block (D${decoderIdx})`,
      desc: decoderIdx === 3
        ? "L3 = DoubleConv3x3(concat(Up(AP_f^4), AP_f^3)); D3 = DFEM(L3). DFEM = DSConv + MLP with GroupNorm + residual adds — no self-attention needed."
        : `L${decoderIdx} = DoubleConv3x3(concat(Up(D${decoderIdx + 1}), AP_f^${decoderIdx})); D${decoderIdx} = DFEM(L${decoderIdx}).`,
    };
  }),

  // --- Segmentation Head
  {
    id: "seghead", type: "seghead", role: "seghead",
    pos: [15.2, 0, 0], size: 1.0, depth: 0.7,
    title: "Segmentation Head",
    desc: "Upsample → Double 3×3 Conv+ReLU → Residual Block → 1×1 Conv. Turns D1's feature map into the final per-pixel class scores.",
  },

  {
    id: "output", type: "image", role: "io",
    pos: [18.6, 0, 0], size: 2.6,
    title: "Predicted Mask",
    desc: "Y ∈ ℝ^(1×W×H) — the final segmentation mask. Trained against the ground truth with a binary cross-entropy loss.",
  },
];

// ---- EDGES -------------------------------------------------------------------
// Every edge is a directed flow of information. `skip: true` edges are drawn
// as a bowed curve (through +Z) so they read clearly against the main pipeline.
export const EDGES = [
  { from: "input", to: "aux1", role: "auxiliary" },
  { from: "input", to: "pri1", role: "primary" },

  { from: "aux1", to: "aux2", role: "auxiliary" },
  { from: "aux2", to: "aux3", role: "auxiliary" },
  { from: "aux3", to: "aux4", role: "auxiliary" },

  { from: "pri1", to: "pri2", role: "primary" },
  { from: "pri2", to: "pri3", role: "primary" },
  { from: "pri3", to: "pri4", role: "primary" },

  { from: "aux1", to: "cbffm1", role: "auxiliary" },
  { from: "pri1", to: "cbffm1", role: "primary" },
  { from: "aux2", to: "cbffm2", role: "auxiliary" },
  { from: "pri2", to: "cbffm2", role: "primary" },
  { from: "aux3", to: "cbffm3", role: "auxiliary" },
  { from: "pri3", to: "cbffm3", role: "primary" },
  { from: "aux4", to: "cbffm4", role: "auxiliary" },
  { from: "pri4", to: "cbffm4", role: "primary" },

  // decoder main path (upsample) + skip connections (bowed)
  { from: "cbffm4", to: "dec3", role: "fusion" },
  { from: "cbffm3", to: "dec3", role: "fusion", skip: true },

  { from: "dec3", to: "dec2", role: "decoder" },
  { from: "cbffm2", to: "dec2", role: "fusion", skip: true },

  { from: "dec2", to: "dec1", role: "decoder" },
  { from: "cbffm1", to: "dec1", role: "fusion", skip: true },

  { from: "dec1", to: "seghead", role: "decoder" },
  { from: "seghead", to: "output", role: "seghead" },
];

// Convenience: how many DISTINCT incoming edges each node needs before it
// "fires" (used by flow.js to synchronise fan-in, e.g. CBFFM needs both
// branches; DFEM D3/D2/D1 need both the upsample path AND the skip path).
export function computeFanIn() {
  const fanIn = {};
  for (const n of NODES) fanIn[n.id] = 0;
  for (const e of EDGES) fanIn[e.to] += 1;
  return fanIn;
}
