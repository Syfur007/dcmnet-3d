/**
 * architecture.js
 * ----------------------------------------------------------------------------
 * DATA ONLY (no THREE.js dependency) description of DCM-Net, matching:
 *
 *   Atabansi et al., "DCM-Net: dual-encoder CNN-Mamba network with
 *   cross-branch fusion for robust medical image segmentation",
 *   BMC Medical Imaging (2025) 25:395.
 *
 * Every top-level block is sized as a TENSOR VOLUME: `grid` = a representative
 * spatial resolution (cubes placed side by side), `depth` = a representative
 * channel count (cubes stacked along the flow axis). These are ILLUSTRATIVE,
 * scaled from the paper's real numbers (see AUX_CH / PRI_CH below) but capped
 * to a size that's still readable and fast to render — not literal pixel/
 * channel counts.
 *
 * Positions are computed programmatically so every block's "exit face"
 * lines up exactly with the next block's "entry face" (see PITCH/GAP) —
 * edges are drawn face-to-face, matching how a real tensor pipeline flows.
 *
 * `INTERNALS` describes what appears when a block is "opened" (Level 2):
 * a small, self-contained sub-graph illustrating that block's real internal
 * computation, built from the paper's own equations where given exactly
 * (CBFFM, DFEM, Seg-Head) or a representative structure otherwise (VSS
 * block, EfficientNet-B2 MBConv block).
 * ----------------------------------------------------------------------------
 */
import { PITCH } from "./tensor.js";

export const PALETTE = {
  auxiliary: 0x4fd3ff,
  primary: 0xff9d4d,
  fusion: 0xffd166,
  decoder: 0x63e6a0,
  seghead: 0xff6f91,
  io: 0xd8e6ee,
  skipWire: 0xb388ff,
  neutral: 0x9fb0bd,
};

const GAP = 1.55; // world units between one block's exit face and the next block's entry face

// ---- real numbers from the paper, used to derive representative sizes -----
const AUX_CH = [96, 192, 384, 768];
const PRI_CH = [24, 48, 120, 352]; // == CBFFM's reduced channel schedule Ĉs

function depthFromChannels(c, maxC = 768, lo = 3, hi = 15) {
  return Math.round(lo + (hi - lo) * Math.sqrt(c / maxC));
}
const AUX_DEPTH = AUX_CH.map((c) => depthFromChannels(c));         // [7,9,11,15]
const PRI_DEPTH = PRI_CH.map((c) => depthFromChannels(c));         // [5,6,8,11]
const STAGE_GRID = [17, 13, 10, 7];                                 // shrinks each stage (downsampling)

const INPUT_GRID = 24, INPUT_DEPTH = 3;                              // RGB
const OUTPUT_GRID = 24, OUTPUT_DEPTH = 1;                            // 1-channel mask
const DEC_GRID = [STAGE_GRID[2], STAGE_GRID[1], STAGE_GRID[0]];      // D3,D2,D1 mirror stage 3,2,1 resolution
const DEC_DEPTH = [10, 8, 5];                                        // illustrative: shrinks toward the output
const SEG_GRID = DEC_GRID[2], SEG_DEPTH = 2;

function thickness(depth) { return depth * PITCH; }

// ---- programmatic left-to-right layout -------------------------------------
const inputX = 0;
const inputExitX = inputX + thickness(INPUT_DEPTH) / 2;

const stageX = [];
{
  let prevExit = inputExitX;
  for (let i = 0; i < 4; i++) {
    const th = thickness(AUX_DEPTH[i]); // aux is always the "thicker" (deeper-channel) branch
    const entry = prevExit + GAP;
    const cx = entry + th / 2;
    stageX.push(cx);
    prevExit = cx + th / 2;
  }
}
const auxExitX = stageX.map((cx, i) => cx + thickness(AUX_DEPTH[i]) / 2);

const cbffmX = [];
{
  for (let i = 0; i < 4; i++) {
    const th = thickness(PRI_DEPTH[i]);
    const entry = auxExitX[i] + GAP;
    cbffmX.push(entry + th / 2);
  }
}
const cbffmExitX = cbffmX.map((cx, i) => cx + thickness(PRI_DEPTH[i]) / 2);

const decX = [];
{
  let prevExit = cbffmExitX[3];
  for (let i = 0; i < 3; i++) {
    const th = thickness(DEC_DEPTH[i]);
    const entry = prevExit + GAP;
    const cx = entry + th / 2;
    decX.push(cx);
    prevExit = cx + th / 2;
  }
}
const decExitX = decX.map((cx, i) => cx + thickness(DEC_DEPTH[i]) / 2);

const segEntryX = decExitX[2] + GAP;
const segX = segEntryX + thickness(SEG_DEPTH) / 2;
const segExitX = segX + thickness(SEG_DEPTH) / 2;

const outputEntryX = segExitX + GAP;
const outputX = outputEntryX + thickness(OUTPUT_DEPTH) / 2;

// re-center the whole pipeline around x=0
const shift = (inputX + outputX) / 2;
const X = (v) => v - shift;

const AUX_Y = 4.9, PRI_Y = -4.9;

// ---- NODES -------------------------------------------------------------------
export const NODES = [
  {
    id: "input", role: "io", pos: [X(inputX), 0, 0], grid: INPUT_GRID, depth: INPUT_DEPTH,
    pixelSource: "input", channelSlices: true,
    title: "Input Image", zoomable: false,
    desc: "A medical image tensor I ∈ ℝ^(C×W×H). Each cube is one (down-sampled) pixel; the 3 depth slices are the R, G, B channels. Flows into BOTH encoder branches at once.",
  },

  ...[0, 1, 2, 3].map((i) => ({
    id: `aux${i + 1}`, role: "auxiliary", pos: [X(stageX[i]), AUX_Y, 0],
    grid: STAGE_GRID[i], depth: AUX_DEPTH[i], zoomable: true, internals: "auxiliary",
    title: `Auxiliary Encoder — Stage ${i + 1}`,
    desc: `${i === 0 ? "Patch Embedding" : "Patch Merging"} + VSS Block (SS2D). Output E_f^${i + 1} ∈ ℝ^(${AUX_CH[i]} × W/${2 ** (i + 2)} × H/${2 ** (i + 2)}). Captures long-range, non-local context with linear complexity. Click to look inside.`,
  })),

  ...[0, 1, 2, 3].map((i) => ({
    id: `pri${i + 1}`, role: "primary", pos: [X(stageX[i]), PRI_Y, 0],
    grid: STAGE_GRID[i], depth: PRI_DEPTH[i], zoomable: true, internals: "primary",
    title: `Primary Encoder — Stage ${i + 1}`,
    desc: `ConvNet block from pretrained EfficientNet-B2. Output P_f^${i + 1} ∈ ℝ^(${PRI_CH[i]} × W/${2 ** (i + 2)} × H/${2 ** (i + 2)}). Captures fine-grained local texture via ImageNet-pretrained weights. Click to look inside.`,
  })),

  ...[0, 1, 2, 3].map((i) => ({
    id: `cbffm${i + 1}`, role: "fusion", pos: [X(cbffmX[i]), 0, 0],
    grid: STAGE_GRID[i], depth: PRI_DEPTH[i], zoomable: true, internals: "fusion",
    title: `CBFFM — Stage ${i + 1}`,
    desc: `F_s = DSConv(GN(A_f^${i + 1})) ⊕ DSConv(GN(P_f^${i + 1}))\nAP_f^${i + 1} = F_s ⊕ MLP(GN(F_s))\nFuses global (Mamba) and local (CNN) features — no attention, linear complexity. Click to look inside.`,
  })),

  ...[0, 1, 2].map((i) => {
    const d = 3 - i; // D3, D2, D1
    return {
      id: `dec${d}`, role: "decoder", pos: [X(decX[i]), 0, 0],
      grid: DEC_GRID[i], depth: DEC_DEPTH[i], zoomable: true, internals: "decoder",
      title: `Decoder — DFEM block (D${d})`,
      desc: (d === 3
        ? "L3 = DoubleConv3x3(concat(Up(AP_f^4), AP_f^3)); D3 = DFEM(L3)."
        : `L${d} = DoubleConv3x3(concat(Up(D${d + 1}), AP_f^${d})); D${d} = DFEM(L${d}).`) +
        " DFEM = DSConv + MLP with GroupNorm + residual adds. Click to look inside.",
    };
  }),

  {
    id: "seghead", role: "seghead", pos: [X(segX), 0, 0], grid: SEG_GRID, depth: SEG_DEPTH,
    zoomable: true, internals: "seghead",
    title: "Segmentation Head",
    desc: "Upsample → Double 3×3 Conv+ReLU → Residual Block → 1×1 Conv. Turns D1's feature map into per-pixel class scores. Click to look inside.",
  },

  {
    id: "output", role: "io", pos: [X(outputX), 0, 0], grid: OUTPUT_GRID, depth: OUTPUT_DEPTH,
    pixelSource: "mask", maskColor: PALETTE.decoder,
    title: "Predicted Mask", zoomable: false,
    desc: "Y ∈ ℝ^(1×W×H) — the final segmentation mask. Bright cubes = foreground (organ/tumor); dark = background. Trained with binary cross-entropy loss.",
  },
];

// ---- EDGES (always drawn from exit-face to entry-face) -----------------------
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

  { from: "cbffm4", to: "dec3", role: "fusion" },
  { from: "cbffm3", to: "dec3", role: "fusion", skip: true },

  { from: "dec3", to: "dec2", role: "decoder" },
  { from: "cbffm2", to: "dec2", role: "fusion", skip: true },

  { from: "dec2", to: "dec1", role: "decoder" },
  { from: "cbffm1", to: "dec1", role: "fusion", skip: true },

  { from: "dec1", to: "seghead", role: "decoder" },
  { from: "seghead", to: "output", role: "seghead" },
];

export function computeFanIn() {
  const fanIn = {};
  for (const n of NODES) fanIn[n.id] = 0;
  for (const e of EDGES) fanIn[e.to] += 1;
  return fanIn;
}

// ============================================================================
// INTERNALS — small, self-contained sub-graphs shown when a block is opened.
// Every step has a `stage` (its column / position along the local flow axis)
// and an optional `lane` (-1/0/+1, vertical offset for parallel branches).
// `grid`/`depth` here are small & purely illustrative (Level-2 detail).
// ============================================================================
export const INTERNALS = {
  auxiliary: {
    label: "Inside a VSS Block (Vision Mamba)",
    inputs: [{ id: "in", lane: 0, label: "Input" }],
    steps: [
      { id: "ln1", stage: 1, lane: 0, title: "LayerNorm", grid: 11, depth: 4, desc: "Normalizes the incoming features before branching." },
      { id: "dwconv", stage: 2, lane: -1, title: "Linear + DWConv + SiLU", grid: 11, depth: 5, desc: "A depth-wise convolution branch mixes local neighbors before the scan." },
      { id: "gate", stage: 2, lane: 1, title: "Linear + SiLU (gate)", grid: 11, depth: 4, desc: "A parallel linear branch that will gate the scan's output." },
      { id: "ss2d", stage: 3, lane: -1, title: "SS2D — Selective Scan 2D", grid: 11, depth: 7, desc: "The core Mamba operator: scans the feature map in 4 directions to build GLOBAL context in linear time — this is what gives the auxiliary branch its long-range \"vision\"." },
      { id: "mul", stage: 4, lane: 0, title: "Element-wise ×", grid: 11, depth: 5, desc: "SS2D's output is gated by the parallel linear branch." },
      { id: "proj", stage: 5, lane: 0, title: "Linear + Residual Add", grid: 11, depth: 4, desc: "Final projection, added back to this block's input (residual connection)." },
    ],
    edges: [
      ["in", "ln1"], ["ln1", "dwconv"], ["ln1", "gate"],
      ["dwconv", "ss2d"], ["ss2d", "mul"], ["gate", "mul"],
      ["mul", "proj"], ["proj", "out"],
    ],
    outputs: [{ id: "out", lane: 0, label: "Output" }],
  },

  primary: {
    label: "Inside a ConvNet Block (EfficientNet-B2, MBConv-style)",
    inputs: [{ id: "in", lane: 0, label: "Input" }],
    steps: [
      { id: "expand", stage: 1, lane: 0, title: "1×1 Conv (Expand)", grid: 11, depth: 6, desc: "Expands channel width before the spatial convolution." },
      { id: "dw", stage: 2, lane: 0, title: "Depthwise 3×3 Conv", grid: 10, depth: 6, desc: "Cheap per-channel spatial convolution — the workhorse of MBConv blocks." },
      { id: "se", stage: 3, lane: 0, title: "Squeeze-and-Excite", grid: 7, depth: 5, desc: "Globally pools each channel and re-weights it — lets the block emphasize the most useful feature channels." },
      { id: "project", stage: 4, lane: 0, title: "1×1 Conv (Project)", grid: 11, depth: 4, desc: "Projects back down to the block's output channel width, with a residual add when shapes match." },
    ],
    edges: [["in", "expand"], ["expand", "dw"], ["dw", "se"], ["se", "project"], ["project", "out"]],
    outputs: [{ id: "out", lane: 0, label: "Output" }],
  },

  fusion: {
    label: "Inside CBFFM (Cross-Branch Feature Fusion Module)",
    inputs: [{ id: "inAux", lane: 1, label: "From Auxiliary Encoder" }, { id: "inPri", lane: -1, label: "From Primary Encoder" }],
    steps: [
      { id: "gnA", stage: 1, lane: 1, title: "GroupNorm (aux)", grid: 10, depth: 4 },
      { id: "dsA", stage: 2, lane: 1, title: "DSConv (aux)", grid: 10, depth: 4 },
      { id: "gnP", stage: 1, lane: -1, title: "GroupNorm (primary)", grid: 10, depth: 4 },
      { id: "dsP", stage: 2, lane: -1, title: "DSConv (primary)", grid: 10, depth: 4 },
      { id: "add1", stage: 3, lane: 0, title: "Add → F\u209b", grid: 10, depth: 5, desc: "F\u209b = DSConv(GN(A)) ⊕ DSConv(GN(P)) — the two branches are combined for the first time here." },
      { id: "gn2", stage: 4, lane: 0, title: "GroupNorm", grid: 10, depth: 5 },
      { id: "mlp", stage: 5, lane: 0, title: "MLP", grid: 10, depth: 5, desc: "A small multilayer perceptron adaptively re-weights the fused features." },
      { id: "add2", stage: 6, lane: 0, title: "Add → AP\u209b\u1da0", grid: 10, depth: 6, desc: "AP\u209b\u1da0 = F\u209b ⊕ MLP(GN(F\u209b)) — the final fused output sent to the decoder." },
    ],
    edges: [
      ["inAux", "gnA"], ["gnA", "dsA"],
      ["inPri", "gnP"], ["gnP", "dsP"],
      ["dsA", "add1"], ["dsP", "add1"],
      ["add1", "gn2"], ["gn2", "mlp"], ["mlp", "add2"],
      ["add1", "add2"],
      ["add2", "out"],
    ],
    outputs: [{ id: "out", lane: 0, label: "To Decoder (AP\u209b\u1da0)" }],
  },

  decoder: {
    label: "Inside a DFEM Block (Decoder Feature Enhancement Module)",
    inputs: [{ id: "in", lane: 0, label: "Input (L\u209b)" }],
    steps: [
      { id: "gn1", stage: 1, lane: 0, title: "GroupNorm", grid: 11, depth: 5 },
      { id: "ds", stage: 2, lane: 0, title: "DSConv", grid: 11, depth: 5 },
      { id: "add1", stage: 3, lane: 0, title: "Add", grid: 11, depth: 5, desc: "F\u209b = L\u209b ⊕ DSConv(GN(L\u209b)) — first residual add." },
      { id: "gn2", stage: 4, lane: 0, title: "GroupNorm", grid: 11, depth: 5 },
      { id: "mlp", stage: 5, lane: 0, title: "MLP", grid: 11, depth: 5 },
      { id: "add2", stage: 6, lane: 0, title: "Add", grid: 11, depth: 6, desc: "D\u209b = F\u209b ⊕ MLP(GN(F\u209b)) — DSConv replaces self-attention here, keeping this cheap and fast." },
    ],
    edges: [
      ["in", "gn1"], ["gn1", "ds"], ["ds", "add1"], ["in", "add1"],
      ["add1", "gn2"], ["gn2", "mlp"], ["mlp", "add2"], ["add1", "add2"],
      ["add2", "out"],
    ],
    outputs: [{ id: "out", lane: 0, label: "Output (D\u209b)" }],
  },

  seghead: {
    label: "Inside the Segmentation Head",
    inputs: [{ id: "in", lane: 0, label: "Input (D\u2081)" }],
    steps: [
      { id: "up", stage: 1, lane: 0, title: "Upsampling", grid: 15, depth: 3, desc: "Restores full input resolution." },
      { id: "conv", stage: 2, lane: 0, title: "Double 3×3 Conv + ReLU", grid: 13, depth: 4 },
      { id: "res", stage: 3, lane: 0, title: "Residual Block", grid: 11, depth: 4 },
      { id: "conv1", stage: 4, lane: 0, title: "1×1 Conv", grid: 11, depth: 1, desc: "Collapses to the final 1-channel prediction map." },
    ],
    edges: [["in", "up"], ["up", "conv"], ["conv", "res"], ["res", "conv1"], ["conv1", "out"]],
    outputs: [{ id: "out", lane: 0, label: "Output (Y)" }],
  },
};
