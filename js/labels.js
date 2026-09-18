/**
 * labels.js
 * ----------------------------------------------------------------------------
 * Floating text labels built as THREE.Sprite objects. Sprites always face the
 * camera automatically, so this needs no extra renderer or per-frame billboard
 * math — the simplest robust option for a no-build, static-hosted project.
 * ----------------------------------------------------------------------------
 */

export function makeLabelSprite(THREE, text, opts = {}) {
  const fontSize = opts.fontSize || 42;
  const color = opts.color || "#e8eef2";
  const pad = 14;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = `600 ${fontSize}px "Segoe UI", Arial, sans-serif`;
  const metrics = ctx.measureText(text);
  const w = Math.ceil(metrics.width) + pad * 2;
  const h = fontSize + pad * 2;

  canvas.width = w;
  canvas.height = h;
  // re-set font after resize (canvas resize clears context state)
  ctx.font = `600 ${fontSize}px "Segoe UI", Arial, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  // soft pill background for legibility over the 3D scene
  const r = h / 2;
  ctx.fillStyle = "rgba(8, 14, 22, 0.72)";
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.arcTo(w, 0, w, r, r);
  ctx.lineTo(w, h - r);
  ctx.arcTo(w, h, w - r, h, r);
  ctx.lineTo(r, h);
  ctx.arcTo(0, h, 0, h - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false,
  });
  const sprite = new THREE.Sprite(mat);
  const scale = (opts.scale || 1) * 0.012;
  sprite.scale.set(w * scale, h * scale, 1);
  sprite.renderOrder = 999;
  return sprite;
}

export function setLabelsVisible(sprites, visible) {
  for (const s of sprites) s.visible = visible;
}
