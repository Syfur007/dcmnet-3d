/**
 * samples.js
 * ----------------------------------------------------------------------------
 * Generates several SWAPPABLE sample "input image + predicted mask" pairs.
 * Everything is drawn procedurally on an offscreen canvas (original generative
 * art — not real medical photographs, so this is safe to publish publicly),
 * then box-downsampled into a small pixel grid that becomes the color of
 * each cube in the input/output tensor volumes (see tensor.js).
 *
 * Each sample is themed after one of the paper's four imaging modalities,
 * purely for visual variety — they are clearly labelled as synthetic.
 * ----------------------------------------------------------------------------
 */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blobPoints(rand, cx, cy, r, n = 22, jitter = 0.3) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 - jitter / 2 + rand() * jitter);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pts;
}

function blobPath(ctx, pts) {
  ctx.beginPath();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    if (i === 0) ctx.moveTo(p1[0], p1[1]);
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2[0], p2[1]);
  }
  ctx.closePath();
}

const CANVAS = 176;

function newCanvas() {
  const c = document.createElement("canvas");
  c.width = c.height = CANVAS;
  return { canvas: c, ctx: c.getContext("2d") };
}

/** Averages CANVAS×CANVAS pixel data down into a grid×grid Float32Array (RGB 0..1). */
function downsample(ctx, grid) {
  const img = ctx.getImageData(0, 0, CANVAS, CANVAS).data;
  const out = new Float32Array(grid * grid * 3);
  const block = CANVAS / grid;
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      let rs = 0, gs = 0, bs = 0, n = 0;
      const y0 = Math.floor(r * block), y1 = Math.floor((r + 1) * block);
      const x0 = Math.floor(c * block), x1 = Math.floor((c + 1) * block);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * CANVAS + x) * 4;
          rs += img[idx]; gs += img[idx + 1]; bs += img[idx + 2]; n++;
        }
      }
      const o = (r * grid + c) * 3;
      out[o] = rs / n / 255; out[o + 1] = gs / n / 255; out[o + 2] = bs / n / 255;
    }
  }
  return out;
}

function speckle(ctx, rand, n, colorFn) {
  for (let i = 0; i < n; i++) {
    const x = rand() * CANVAS, y = rand() * CANVAS;
    ctx.fillStyle = colorFn(rand);
    ctx.beginPath();
    ctx.arc(x, y, rand() * 1.8 + 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- one builder per "modality" -------------------------------------------
function buildSkinLesion(seed) {
  const rand = mulberry32(seed);
  const { ctx } = newCanvas();
  const cx = CANVAS / 2 + (rand() - 0.5) * 12, cy = CANVAS / 2 + (rand() - 0.5) * 12;
  const pts = blobPoints(rand, cx, cy, CANVAS * 0.27, 24, 0.34);

  const bg = ctx.createRadialGradient(cx, cy, 10, cx, cy, CANVAS * 0.75);
  bg.addColorStop(0, "#e8c9ad"); bg.addColorStop(0.55, "#dcb593"); bg.addColorStop(1, "#c99a76");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, CANVAS, CANVAS);
  speckle(ctx, rand, 260, (r) => `rgba(120,80,50,${0.02 + r() * 0.03})`);

  ctx.save(); blobPath(ctx, pts); ctx.clip();
  const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, CANVAS * 0.3);
  g.addColorStop(0, "#4a2c1c"); g.addColorStop(0.5, "#6b3c22"); g.addColorStop(1, "#8a5230");
  ctx.fillStyle = g; ctx.fillRect(0, 0, CANVAS, CANVAS);
  speckle(ctx, rand, 60, (r) => `rgba(20,10,5,${0.06 + r() * 0.12})`);
  ctx.restore();

  return { ctx, pts, cx, cy };
}

function buildPolyp(seed) {
  const rand = mulberry32(seed);
  const { ctx } = newCanvas();
  const cx = CANVAS * 0.45 + (rand() - 0.5) * 14, cy = CANVAS * 0.55 + (rand() - 0.5) * 14;
  const pts = blobPoints(rand, cx, cy, CANVAS * 0.22, 20, 0.26);

  const bg = ctx.createRadialGradient(CANVAS * 0.5, CANVAS * 0.5, 10, CANVAS * 0.5, CANVAS * 0.5, CANVAS * 0.8);
  bg.addColorStop(0, "#e8827c"); bg.addColorStop(0.6, "#c94f4f"); bg.addColorStop(1, "#7a2626");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, CANVAS, CANVAS);
  speckle(ctx, rand, 200, (r) => `rgba(255,255,255,${0.02 + r() * 0.04})`);

  ctx.save(); blobPath(ctx, pts); ctx.clip();
  const g = ctx.createRadialGradient(cx - 12, cy - 12, 4, cx, cy, CANVAS * 0.24);
  g.addColorStop(0, "#f2b6ab"); g.addColorStop(0.6, "#e08e82"); g.addColorStop(1, "#c76a5e");
  ctx.fillStyle = g; ctx.fillRect(0, 0, CANVAS, CANVAS);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,235,225,0.35)"; ctx.lineWidth = 3; blobPath(ctx, pts); ctx.stroke();

  return { ctx, pts, cx, cy };
}

function buildThyroidUS(seed) {
  const rand = mulberry32(seed);
  const { ctx } = newCanvas();
  const cx = CANVAS / 2 + (rand() - 0.5) * 10, cy = CANVAS / 2 + (rand() - 0.5) * 10;
  const pts = blobPoints(rand, cx, cy, CANVAS * 0.24, 22, 0.22);

  ctx.fillStyle = "#0c0c0e"; ctx.fillRect(0, 0, CANVAS, CANVAS);
  // ultrasound-style speckle field
  for (let y = 0; y < CANVAS; y += 2) {
    const shade = 30 + 18 * Math.sin(y * 0.15);
    ctx.fillStyle = `rgba(${shade},${shade},${shade + 4},0.5)`;
    ctx.fillRect(0, y, CANVAS, 2);
  }
  speckle(ctx, rand, 1400, (r) => { const v = 40 + r() * 90; return `rgba(${v},${v},${v},${0.15 + r() * 0.25})`; });

  ctx.save(); blobPath(ctx, pts); ctx.clip();
  const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, CANVAS * 0.26);
  g.addColorStop(0, "#5a5a5e"); g.addColorStop(1, "#2c2c30");
  ctx.fillStyle = g; ctx.fillRect(0, 0, CANVAS, CANVAS);
  speckle(ctx, rand, 500, (r) => { const v = 60 + r() * 120; return `rgba(${v},${v},${v},${0.2 + r() * 0.3})`; });
  ctx.restore();
  ctx.strokeStyle = "rgba(230,230,235,0.55)"; ctx.lineWidth = 2; blobPath(ctx, pts); ctx.stroke();

  return { ctx, pts, cx, cy };
}

function buildPancreasCT(seed) {
  const rand = mulberry32(seed);
  const { ctx } = newCanvas();
  const cx = CANVAS * 0.48 + (rand() - 0.5) * 10, cy = CANVAS * 0.42 + (rand() - 0.5) * 10;
  // elongated illustrative blob (curved organ shape simplified as a stretched blob)
  const pts = blobPoints(rand, cx, cy, CANVAS * 0.2, 22, 0.3).map(([x, y]) => [cx + (x - cx) * 1.5, cy + (y - cy) * 0.65]);

  ctx.fillStyle = "#15151a"; ctx.fillRect(0, 0, CANVAS, CANVAS);
  // body outline (soft round abdomen)
  const body = ctx.createRadialGradient(CANVAS * 0.5, CANVAS * 0.5, 10, CANVAS * 0.5, CANVAS * 0.5, CANVAS * 0.62);
  body.addColorStop(0, "#3a3a40"); body.addColorStop(1, "#101014");
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.ellipse(CANVAS * 0.5, CANVAS * 0.5, CANVAS * 0.46, CANVAS * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  // a couple of "organs" (kidneys) for CT flavor
  ctx.fillStyle = "#4a4a52";
  ctx.beginPath(); ctx.ellipse(CANVAS * 0.28, CANVAS * 0.62, 14, 20, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(CANVAS * 0.72, CANVAS * 0.62, 14, 20, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#e8e8ea";
  ctx.beginPath(); ctx.arc(CANVAS * 0.5, CANVAS * 0.78, 10, 0, Math.PI * 2); ctx.fill(); // spine

  ctx.save(); blobPath(ctx, pts); ctx.clip();
  const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, CANVAS * 0.3);
  g.addColorStop(0, "#8f8f78"); g.addColorStop(1, "#5c5c4c");
  ctx.fillStyle = g; ctx.fillRect(0, 0, CANVAS, CANVAS);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 2; blobPath(ctx, pts); ctx.stroke();

  return { ctx, pts, cx, cy };
}

function maskFromBlob(pts, cx, cy, maskColor = "#63e6a0") {
  const { ctx } = newCanvas();
  ctx.fillStyle = "#05070a"; ctx.fillRect(0, 0, CANVAS, CANVAS);
  blobPath(ctx, pts);
  ctx.fillStyle = maskColor; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = "#eafff4"; ctx.stroke();
  return ctx;
}

const BUILDERS = [
  { id: "skin", label: "Skin Lesion", sub: "Dermoscopy-style", build: buildSkinLesion, seed: 1001 },
  { id: "polyp", label: "Polyp", sub: "Endoscopy-style", build: buildPolyp, seed: 2002 },
  { id: "thyroid", label: "Thyroid Nodule", sub: "Ultrasound-style", build: buildThyroidUS, seed: 3003 },
  { id: "pancreas", label: "Pancreas", sub: "CT-style", build: buildPancreasCT, seed: 4004 },
];

/**
 * Returns an array of ready-to-use samples:
 *   { id, label, sub, inputPixels: Float32Array(grid*grid*3), maskPixels: Float32Array(grid*grid*3) }
 */
export function generateSamples(grid) {
  return BUILDERS.map((b) => {
    const { ctx, pts, cx, cy } = b.build(b.seed);
    const inputPixels = downsample(ctx, grid);
    const maskCtx = maskFromBlob(pts, cx, cy);
    const maskPixels = downsample(maskCtx, grid);
    return { id: b.id, label: b.label, sub: b.sub, inputPixels, maskPixels };
  });
}
