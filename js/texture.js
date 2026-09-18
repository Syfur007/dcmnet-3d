/**
 * texture.js
 * ----------------------------------------------------------------------------
 * Procedurally draws two small canvases:
 *   1) a synthetic "medical-photo-like" input image (mottled lesion on skin-
 *      like background), and
 *   2) the matching binary mask (what a segmentation model should predict).
 * Both are derived from the SAME random blob outline so the mask genuinely
 * traces the "lesion" in the image — this keeps the demo self-explanatory
 * without using any real (copyrighted) medical photographs.
 *
 * Everything here is original generative art drawn with the 2D canvas API.
 * ----------------------------------------------------------------------------
 */

// A tiny seeded PRNG (mulberry32) so the shape is identical on every reload —
// a deliberate, "designed" look rather than a different random blob each time.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBlobPoints(rand, cx, cy, baseR, points = 24, jitter = 0.28) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const r = baseR * (1 - jitter / 2 + rand() * jitter);
    pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  return pts;
}

function smoothBlobPath(ctx, pts) {
  ctx.beginPath();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    if (i === 0) ctx.moveTo(p1[0], p1[1]);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
  }
  ctx.closePath();
}

const SEED = 20260918; // fixed seed -> stable shape across reloads
const SIZE = 512;

function sharedBlob() {
  const rand = mulberry32(SEED);
  const cx = SIZE / 2 + (rand() - 0.5) * 30;
  const cy = SIZE / 2 + (rand() - 0.5) * 30;
  const baseR = SIZE * 0.26;
  const pts = buildBlobPoints(rand, cx, cy, baseR, 26, 0.32);
  return { pts, cx, cy, rand };
}

export function createInputImageTexture(THREE) {
  const { pts, cx, cy, rand } = sharedBlob();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");

  // Skin-like mottled background
  const bg = ctx.createRadialGradient(cx, cy, 20, cx, cy, SIZE * 0.75);
  bg.addColorStop(0, "#e8c9ad");
  bg.addColorStop(0.55, "#dcb593");
  bg.addColorStop(1, "#c99a76");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // subtle skin speckle noise
  for (let i = 0; i < 900; i++) {
    const x = rand() * SIZE, y = rand() * SIZE;
    ctx.fillStyle = `rgba(120,80,50,${0.02 + rand() * 0.03})`;
    ctx.beginPath();
    ctx.arc(x, y, rand() * 1.6 + 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // the "lesion" blob — mottled brown tones
  ctx.save();
  smoothBlobPath(ctx, pts);
  ctx.clip();
  const lesion = ctx.createRadialGradient(cx, cy, 5, cx, cy, SIZE * 0.3);
  lesion.addColorStop(0, "#4a2c1c");
  lesion.addColorStop(0.5, "#6b3c22");
  lesion.addColorStop(1, "#8a5230");
  ctx.fillStyle = lesion;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 140; i++) {
    const x = cx + (rand() - 0.5) * SIZE * 0.5;
    const y = cy + (rand() - 0.5) * SIZE * 0.5;
    ctx.fillStyle = `rgba(20,10,5,${0.06 + rand() * 0.12})`;
    ctx.beginPath();
    ctx.arc(x, y, rand() * 10 + 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // faint vignette frame
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 10;
  ctx.strokeRect(0, 0, SIZE, SIZE);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createMaskTexture(THREE) {
  const { pts } = sharedBlob();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#05070a";
  ctx.fillRect(0, 0, SIZE, SIZE);

  smoothBlobPath(ctx, pts);
  ctx.fillStyle = "#63e6a0";
  ctx.fill();

  ctx.lineWidth = 5;
  ctx.strokeStyle = "#eafff4";
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 10;
  ctx.strokeRect(0, 0, SIZE, SIZE);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
