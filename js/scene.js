/**
 * scene.js
 * ----------------------------------------------------------------------------
 * Turns architecture.js's data into actual THREE.js objects, at two levels:
 *
 *   buildMainScene()      — the full 18-block DCM-Net pipeline (Level 0)
 *   buildInternalsScene() — a small self-contained sub-graph for whatever
 *                           block was clicked (Level 1 "zoom in")
 *
 * Both levels reuse the same primitives: tensor.js's instanced-cube volumes
 * for nodes, and TubeGeometry curves for connections (straight for the main
 * flow, bowed through +Z for skip connections so they stay visually
 * distinct).
 * ----------------------------------------------------------------------------
 */
import { NODES, EDGES, PALETTE, INTERNALS } from "./architecture.js";
import { buildTensorVolume, PITCH } from "./tensor.js";
import { makeLabelSprite } from "./labels.js";

function faceX(node, sign) {
  const th = node.depth * PITCH;
  return node.pos[0] + sign * th / 2;
}

function curveForEdge(THREE, fromPt, toPt, skip) {
  if (!skip) {
    const mid = fromPt.clone().lerp(toPt, 0.5);
    return new THREE.CatmullRomCurve3([fromPt.clone(), mid, toPt.clone()], false, "catmullrom", 0.2);
  }
  const bow = 6.2;
  const p1 = fromPt.clone().lerp(toPt, 0.32); p1.z += bow;
  const p2 = fromPt.clone().lerp(toPt, 0.68); p2.z += bow;
  return new THREE.CatmullRomCurve3([fromPt.clone(), p1, p2, toPt.clone()], false, "catmullrom", 0.35);
}

function addTube(THREE, root, curve, colorHex, skip) {
  const tubularSegments = skip ? 48 : 12;
  const geo = new THREE.TubeGeometry(curve, tubularSegments, 0.05, 8, false);
  const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: skip ? 0.42 : 0.3, toneMapped: false });
  const mesh = new THREE.Mesh(geo, mat);
  root.add(mesh);
  return mesh;
}

function labelFor(THREE, root, text, worldPos, node, opts = {}) {
  const label = makeLabelSprite(THREE, text, { fontSize: opts.fontSize || 20 });
  label.position.set(worldPos.x, worldPos.y + (opts.dy ?? 0), worldPos.z + (opts.dz ?? 0.15));
  root.add(label);
  return label;
}

// ============================================================================
// LEVEL 0 — the full pipeline
// ============================================================================
export function buildMainScene(THREE, scene, samples, sampleIndex) {
  const root = new THREE.Group();
  scene.add(root);

  const nodeInfo = new Map();   // id -> { tv, group, node }
  const labelSprites = [];
  const raycastTargets = [];

  for (const node of NODES) {
    const pos = new THREE.Vector3(...node.pos);
    let pixels = null, channelSlices = false, channelBoost = false, maskColor = null;
    if (node.pixelSource === "input") { pixels = samples[sampleIndex].inputPixels; channelBoost = true; }
    if (node.pixelSource === "mask") { pixels = samples[sampleIndex].maskPixels; maskColor = node.maskColor; }

    const tv = buildTensorVolume(THREE, {
      grid: node.grid, depth: node.depth,
      colorHex: PALETTE[node.role] ?? 0xffffff,
      pixels, channelSlices, channelBoost, maskColorHex: maskColor,
    });
    tv.mesh.position.copy(pos);
    tv.mesh.userData.nodeId = node.id;
    tv.mesh.userData.title = node.title;
    tv.mesh.userData.desc = node.desc;
    tv.mesh.userData.role = node.role;
    tv.mesh.userData.zoomable = !!node.zoomable;
    root.add(tv.mesh);

    nodeInfo.set(node.id, { tv, node, pos });
    raycastTargets.push(tv.mesh);

    const labelOffset = tv.halfY + 0.5;
    const label = labelFor(THREE, root, node.title, pos, node, { dy: labelOffset });
    labelSprites.push(label);
  }

  const edges = [];
  for (const e of EDGES) {
    const fromInfo = nodeInfo.get(e.from), toInfo = nodeInfo.get(e.to);
    const fromPt = new THREE.Vector3(faceX(fromInfo.node, +1), fromInfo.node.pos[1], fromInfo.node.pos[2]);
    const toPt = new THREE.Vector3(faceX(toInfo.node, -1), toInfo.node.pos[1], toInfo.node.pos[2]);
    const curve = curveForEdge(THREE, fromPt, toPt, e.skip);
    const wireColor = e.skip ? PALETTE.skipWire : (PALETTE[e.role] ?? 0xffffff);
    addTube(THREE, root, curve, wireColor, e.skip);
    edges.push({ from: e.from, to: e.to, role: e.role, skip: !!e.skip, curve, length: curve.getLength(), wireColor });
  }

  const nodeMeshes = new Map();
  for (const [id, info] of nodeInfo) nodeMeshes.set(id, info.tv.mesh);

  return { root, nodeInfo, nodeMeshes, labelSprites, raycastTargets, edges };
}

/** Swap the input/output tensor volumes to a different sample, in place. */
export function applySampleToMainScene(THREE, mainScene, samples, sampleIndex) {
  for (const id of ["input", "output"]) {
    const info = mainScene.nodeInfo.get(id);
    const node = info.node;
    const old = info.tv.mesh;
    const pixels = id === "input" ? samples[sampleIndex].inputPixels : samples[sampleIndex].maskPixels;
    const tv = buildTensorVolume(THREE, {
      grid: node.grid, depth: node.depth,
      colorHex: PALETTE[node.role] ?? 0xffffff,
      pixels,
      channelSlices: false,
      channelBoost: id === "input",
      maskColorHex: id === "output" ? node.maskColor : null,
    });
    tv.mesh.position.copy(info.pos);
    tv.mesh.userData.nodeId = id;
    tv.mesh.userData.title = node.title;
    tv.mesh.userData.desc = node.desc;
    tv.mesh.userData.role = node.role;
    tv.mesh.userData.zoomable = false;

    mainScene.root.remove(old);
    old.geometry.dispose();
    old.material.dispose();
    mainScene.root.add(tv.mesh);

    info.tv = tv;
    mainScene.nodeMeshes.set(id, tv.mesh);
    const idx = mainScene.raycastTargets.indexOf(old);
    if (idx !== -1) mainScene.raycastTargets[idx] = tv.mesh;
  }
}

// ============================================================================
// LEVEL 1 — "look inside" a block
// ============================================================================
const COL_SPACING = 2.15;
const LANE_SPACING = 1.9;

export function buildInternalsScene(THREE, role, contextTitle) {
  const tpl = INTERNALS[role];
  const root = new THREE.Group();

  const nodeInfo = new Map();
  const labelSprites = [];
  const raycastTargets = [];
  const stageOf = new Map(); // localId -> integer stage index (for robust skip-edge detection)

  const maxStage = Math.max(...tpl.steps.map((s) => s.stage));

  // input marker(s)
  for (const inp of tpl.inputs) {
    const pos = new THREE.Vector3(-COL_SPACING * 0.75, inp.lane * LANE_SPACING, 0);
    const tv = buildTensorVolume(THREE, { grid: 5, depth: 2, colorHex: PALETTE.neutral });
    tv.mesh.position.copy(pos);
    tv.mesh.userData.nodeId = `io:${inp.id}`;
    tv.mesh.userData.title = inp.label || "Input";
    tv.mesh.userData.desc = "Data entering this block.";
    tv.mesh.userData.role = "neutral";
    tv.mesh.userData.zoomable = false;
    root.add(tv.mesh);
    nodeInfo.set(inp.id, { tv, pos, depth: 2 });
    stageOf.set(inp.id, 0);
    raycastTargets.push(tv.mesh);
    labelSprites.push(labelFor(THREE, root, inp.label || "Input", pos, null, { dy: tv.halfY + 0.45 }));
  }

  // internal steps
  for (const step of tpl.steps) {
    const pos = new THREE.Vector3(step.stage * COL_SPACING, step.lane * LANE_SPACING, 0);
    const tv = buildTensorVolume(THREE, { grid: step.grid, depth: step.depth, colorHex: PALETTE[role] ?? 0xffffff });
    tv.mesh.position.copy(pos);
    tv.mesh.userData.nodeId = `step:${step.id}`;
    tv.mesh.userData.title = step.title;
    tv.mesh.userData.desc = step.desc || `Part of ${tpl.label}.`;
    tv.mesh.userData.role = role;
    tv.mesh.userData.zoomable = false;
    root.add(tv.mesh);
    nodeInfo.set(step.id, { tv, pos, depth: step.depth });
    stageOf.set(step.id, step.stage);
    raycastTargets.push(tv.mesh);
    labelSprites.push(labelFor(THREE, root, step.title, pos, null, { dy: tv.halfY + 0.45 }));
  }

  // output marker(s)
  for (const outp of tpl.outputs) {
    const pos = new THREE.Vector3((maxStage + 0.75) * COL_SPACING, outp.lane * LANE_SPACING, 0);
    const tv = buildTensorVolume(THREE, { grid: 5, depth: 2, colorHex: PALETTE.neutral });
    tv.mesh.position.copy(pos);
    tv.mesh.userData.nodeId = `io:${outp.id}`;
    tv.mesh.userData.title = outp.label || "Output";
    tv.mesh.userData.desc = "Data leaving this block.";
    tv.mesh.userData.role = "neutral";
    tv.mesh.userData.zoomable = false;
    root.add(tv.mesh);
    nodeInfo.set(outp.id, { tv, pos, depth: 2 });
    stageOf.set(outp.id, maxStage + 1);
    raycastTargets.push(tv.mesh);
    labelSprites.push(labelFor(THREE, root, outp.label || "Output", pos, null, { dy: tv.halfY + 0.45 }));
  }

  const edges = [];
  for (const [fromId, toId] of tpl.edges) {
    const a = nodeInfo.get(fromId), b = nodeInfo.get(toId);
    const fromPt = new THREE.Vector3(a.pos.x + (a.depth * PITCH) / 2, a.pos.y, a.pos.z);
    const toPt = new THREE.Vector3(b.pos.x - (b.depth * PITCH) / 2, b.pos.y, b.pos.z);
    // a hop that skips over intermediate columns on the SAME row reads as a
    // residual/skip connection — bow it so it doesn't visually cut through
    // whatever sits in between. Adjacent-column hops stay straight.
    const sameRow = Math.abs(a.pos.y - b.pos.y) < 1e-6;
    const spanCols = Math.abs(stageOf.get(toId) - stageOf.get(fromId));
    const skip = sameRow && spanCols > 1;
    const curve = curveForEdge(THREE, fromPt, toPt, skip);
    addTube(THREE, root, curve, PALETTE[role] ?? 0xffffff, skip);
    edges.push({ from: fromId, to: toId, role, skip, curve, length: curve.getLength(), wireColor: PALETTE[role] ?? 0xffffff });
  }

  const nodeMeshes = new Map();
  for (const [id, info] of nodeInfo) nodeMeshes.set(id, info.tv.mesh);

  // frame the whole thing so main.js can point the camera at it
  const allX = [...nodeInfo.values()].map((i) => i.pos.x);
  const bounds = {
    minX: Math.min(...allX), maxX: Math.max(...allX),
    centerX: (Math.min(...allX) + Math.max(...allX)) / 2,
  };

  return { root, nodeInfo, nodeMeshes, labelSprites, raycastTargets, edges, bounds, label: tpl.label, contextTitle };
}
