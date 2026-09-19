/**
 * main.js — entry point.
 * Renderer/camera/controls, the Level-0 ↔ Level-1 drill-down state machine,
 * the sample-image picker, node click → info panel → "explore inside", and
 * the pulse + scan-plane "data flowing through this block" visual effects.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildMainScene, buildInternalsScene, applySampleToMainScene } from "./scene.js";
import { FlowSimulator } from "./flow.js";
import { generateSamples } from "./samples.js";
import { setLabelsVisible } from "./labels.js";
import { NODES, PALETTE } from "./architecture.js";
import { makeScanPlane } from "./tensor.js";

const $ = (id) => document.getElementById(id);
const NODE_BY_ID = new Map(NODES.map((n) => [n.id, n]));
const INTERNALS_WORLD_OFFSET = new THREE.Vector3(0, 260, 0); // parks Level-1 far from Level-0
const PULSE_DURATION = 0.55;

function showFatalError(err) {
  console.error(err);
  const loading = $("loading");
  if (loading) {
    loading.querySelector(".spinner")?.remove();
    const p = loading.querySelector("p");
    if (p) {
      p.innerHTML =
        "Something went wrong loading the 3D scene.<br/>" +
        "This demo needs internet access (it loads three.js from a CDN) and a WebGL-capable browser.<br/>" +
        `<span style="opacity:.6;font-size:12px">${(err && err.message) || err}</span>`;
    }
    loading.classList.remove("hidden");
  }
}
window.addEventListener("error", (e) => showFatalError(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => showFatalError(e.reason));

function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
    }
  });
  group.parent?.remove(group);
}

function makeThumbnailCanvas(sample, px = 52) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d");
  const grid = Math.sqrt(sample.inputPixels.length / 3);
  const cell = px / grid;
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      const i = (r * grid + c) * 3;
      const R = Math.round(sample.inputPixels[i] * 255);
      const G = Math.round(sample.inputPixels[i + 1] * 255);
      const B = Math.round(sample.inputPixels[i + 2] * 255);
      ctx.fillStyle = `rgb(${R},${G},${B})`;
      ctx.fillRect(c * cell, r * cell, cell + 0.6, cell + 0.6);
    }
  }
  return canvas;
}

function init() {
  const container = $("canvas-container");

  // ---- renderer -------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b12);
  scene.fog = new THREE.FogExp2(0x070b12, 0.012);
  scene.add(makeStarfield(THREE));

  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 900);
  const MAIN_CAM_POS = new THREE.Vector3(3, 7, 30);
  const MAIN_TARGET = new THREE.Vector3(0, 0, 0);
  camera.position.copy(MAIN_CAM_POS);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(MAIN_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3;
  controls.maxDistance = 90;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.9;
  controls.update();

  scene.add(new THREE.AmbientLight(0x8fa6c9, 0.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
  keyLight.position.set(10, 20, 16);
  scene.add(keyLight);
  const coolFill = new THREE.PointLight(0x4fd3ff, 260, 70);
  coolFill.position.set(-14, 9, 12);
  scene.add(coolFill);
  const warmFill = new THREE.PointLight(0xff9d4d, 260, 70);
  warmFill.position.set(-14, -9, 12);
  scene.add(warmFill);
  const rimLight = new THREE.PointLight(0x63e6a0, 220, 70);
  rimLight.position.set(16, 0, 16);
  scene.add(rimLight);
  const zoomLight = new THREE.PointLight(0xffffff, 200, 60);
  zoomLight.position.copy(INTERNALS_WORLD_OFFSET).add(new THREE.Vector3(0, 4, 10));
  scene.add(zoomLight);

  // ---- data + Level-0 scene ----------------------------------------------
  const GRID_RES = 24;
  const samples = generateSamples(GRID_RES);
  let sampleIndex = 0;
  const main = buildMainScene(THREE, scene, samples, sampleIndex);
  const mainFlow = new FlowSimulator(THREE, main.root, { edges: main.edges, nodeMeshes: main.nodeMeshes, onNodeFire });
  mainFlow.start();

  // ---- shared state: which level is currently being viewed ---------------
  let level = "main";
  let activeNodeInfo = main.nodeInfo;
  let activeRaycastTargets = main.raycastTargets;
  let activeFlow = mainFlow;
  let internalsData = null;
  let internalsFlow = null;
  let preZoomCam = null;

  const pulseState = new Map();  // nodeId -> { start, duration }
  const activeScans = [];        // { plane, start, duration, halfX, thickness, basePos }
  const clock = new THREE.Clock();

  function onNodeFire(nodeId) {
    pulseState.set(nodeId, { start: clock.getElapsedTime(), duration: PULSE_DURATION });

    const info = activeNodeInfo.get(nodeId);
    if (!info) return;
    const tv = info.tv;
    const role = tv.mesh.userData.role;
    const colorHex = PALETTE[role] ?? 0xffffff;

    const plane = makeScanPlane(THREE, tv, colorHex);
    plane.visible = true;
    const parentGroup = tv.mesh.parent;
    parentGroup.add(plane);
    plane.position.copy(tv.mesh.position);
    plane.position.x = tv.mesh.position.x - tv.halfX;
    activeScans.push({ plane, start: clock.getElapsedTime(), duration: PULSE_DURATION, halfX: tv.halfX, thickness: tv.thickness, baseY: tv.mesh.position.y, baseZ: tv.mesh.position.z, baseX: tv.mesh.position.x });
  }

  function applyFX() {
    const now = clock.getElapsedTime();
    for (const [id, p] of pulseState) {
      const elapsed = now - p.start;
      const info = activeNodeInfo.get(id);
      const mesh = info?.tv?.mesh;
      if (elapsed >= p.duration) {
        pulseState.delete(id);
        if (mesh) { mesh.scale.setScalar(1); mesh.material.emissiveIntensity = (mesh === selectedMesh) ? 0.85 : 0.28; }
        continue;
      }
      const factor = Math.sin((elapsed / p.duration) * Math.PI);
      if (mesh) {
        mesh.scale.setScalar(1 + 0.35 * factor);
        mesh.material.emissiveIntensity = 0.28 + 1.15 * factor;
      }
    }

    for (let i = activeScans.length - 1; i >= 0; i--) {
      const s = activeScans[i];
      const t = (now - s.start) / s.duration;
      if (t >= 1) {
        disposeGroup(s.plane);
        activeScans.splice(i, 1);
        continue;
      }
      s.plane.position.x = s.baseX - s.halfX + t * s.thickness;
      s.plane.material.opacity = 0.7 * (1 - Math.abs(2 * t - 1));
    }
  }

  // ---- interaction: raycast + info panel ----------------------------------
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  const infoPanel = $("info-panel"), infoTitle = $("info-title"), infoDesc = $("info-desc"), infoZoomBtn = $("info-zoom-btn");
  let selectedMesh = null;
  let selectedMainNodeId = null;

  function clearSelection() {
    if (selectedMesh?.material && "emissiveIntensity" in selectedMesh.material) {
      selectedMesh.material.emissiveIntensity = 0.28;
    }
    selectedMesh = null; selectedMainNodeId = null;
    infoPanel.classList.add("hidden");
  }

  function selectMesh(mesh) {
    clearSelection();
    if (!mesh) return;
    selectedMesh = mesh;
    if (mesh.material && "emissiveIntensity" in mesh.material) mesh.material.emissiveIntensity = 0.85;
    infoTitle.textContent = mesh.userData.title || "";
    infoDesc.textContent = mesh.userData.desc || "";
    const canZoom = level === "main" && mesh.userData.zoomable;
    infoZoomBtn.classList.toggle("hidden", !canZoom);
    if (canZoom) selectedMainNodeId = mesh.userData.nodeId;
    infoPanel.classList.remove("hidden");
  }

  function pointerToMesh(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObjects(activeRaycastTargets, false);
    return hits.length ? hits[0].object : null;
  }

  let downX = 0, downY = 0;
  renderer.domElement.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // was a drag, not a tap
    selectMesh(pointerToMesh(e.clientX, e.clientY));
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    renderer.domElement.style.cursor = pointerToMesh(e.clientX, e.clientY) ? "pointer" : "grab";
  });
  $("info-close").addEventListener("click", clearSelection);

  // ---- camera tween helper -------------------------------------------------
  let camTween = null;
  function flyTo(pos, target, duration = 1.0) {
    camTween = { t: 0, duration, fromPos: camera.position.clone(), toPos: pos.clone(), fromTarget: controls.target.clone(), toTarget: target.clone() };
  }
  function easeInOutCubic(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

  // ---- Level-0 <-> Level-1 drill-down ---------------------------------------
  const backBtn = $("back-btn");
  const samplesPanel = $("samples-panel");
  const crumbTitle = $("crumb-title"), crumbSub = $("crumb-sub");
  const DEFAULT_CRUMB_TITLE = crumbTitle.innerHTML, DEFAULT_CRUMB_SUB = crumbSub.innerHTML;

  function enterNode(nodeId) {
    const node = NODE_BY_ID.get(nodeId);
    if (!node || !node.zoomable) return;

    preZoomCam = { pos: camera.position.clone(), target: controls.target.clone() };
    mainFlow.setPaused(true);
    clearSelection();

    internalsData = buildInternalsScene(THREE, node.internals, node.title);
    internalsData.root.position.copy(INTERNALS_WORLD_OFFSET);
    scene.add(internalsData.root);
    internalsFlow = new FlowSimulator(THREE, internalsData.root, { edges: internalsData.edges, nodeMeshes: internalsData.nodeMeshes, onNodeFire });
    internalsFlow.setPaused(!playing);
    internalsFlow.setSpeed(currentSpeed);
    internalsFlow.start();

    level = "internals";
    activeNodeInfo = internalsData.nodeInfo;
    activeRaycastTargets = internalsData.raycastTargets;
    activeFlow = internalsFlow;

    crumbTitle.innerHTML = `${node.title} <span class="dim">— ${internalsData.label}</span>`;
    crumbSub.textContent = "Click any part for details, or press Back to return to the full architecture.";
    backBtn.classList.remove("hidden");
    samplesPanel.classList.add("hidden");

    const span = internalsData.bounds.maxX - internalsData.bounds.minX;
    const dist = span * 0.85 + 6;
    const centerWorld = new THREE.Vector3(internalsData.bounds.centerX, 0, 0).add(INTERNALS_WORLD_OFFSET);
    flyTo(centerWorld.clone().add(new THREE.Vector3(1.5, 3.2, dist)), centerWorld, 1.1);
  }

  function exitToMain() {
    if (level !== "internals") return;
    mainFlow.setPaused(!playing);
    if (internalsData) disposeGroup(internalsData.root);
    internalsData = null; internalsFlow = null;

    level = "main";
    activeNodeInfo = main.nodeInfo;
    activeRaycastTargets = main.raycastTargets;
    activeFlow = mainFlow;

    crumbTitle.innerHTML = DEFAULT_CRUMB_TITLE;
    crumbSub.innerHTML = DEFAULT_CRUMB_SUB;
    backBtn.classList.add("hidden");
    samplesPanel.classList.remove("hidden");
    clearSelection();

    if (preZoomCam) flyTo(preZoomCam.pos, preZoomCam.target, 1.0);
  }

  backBtn.addEventListener("click", exitToMain);
  infoZoomBtn.addEventListener("click", () => { if (selectedMainNodeId) enterNode(selectedMainNodeId); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (level === "internals") exitToMain(); else clearSelection(); } });

  // ---- sample picker ---------------------------------------------------
  const samplesList = $("samples-list");
  samples.forEach((s, i) => {
    const btn = document.createElement("button");
    btn.className = "sample-thumb" + (i === 0 ? " active" : "");
    btn.title = `${s.label} (${s.sub}) — synthetic sample`;
    btn.appendChild(makeThumbnailCanvas(s));
    const nameTag = document.createElement("span");
    nameTag.className = "sample-name";
    nameTag.textContent = s.label;
    btn.appendChild(nameTag);
    btn.addEventListener("click", () => {
      if (sampleIndex === i) return;
      sampleIndex = i;
      applySampleToMainScene(THREE, main, samples, sampleIndex);
      [...samplesList.children].forEach((c, ci) => c.classList.toggle("active", ci === i));
    });
    samplesList.appendChild(btn);
  });

  // ---- resize --------------------------------------------------------
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ============================================================ UI wiring ==
  let playing = true;
  let currentSpeed = 1;
  const playPauseBtn = $("play-pause-btn");
  playPauseBtn.addEventListener("click", () => {
    playing = !playing;
    mainFlow.setPaused(!playing);
    if (internalsFlow) internalsFlow.setPaused(!playing);
    playPauseBtn.innerHTML = playing ? "⏸ <span>Pause</span>" : "▶ <span>Play</span>";
    playPauseBtn.classList.toggle("active", !playing);
  });

  $("speed-slider").addEventListener("input", (e) => {
    currentSpeed = parseFloat(e.target.value);
    mainFlow.setSpeed(currentSpeed);
    if (internalsFlow) internalsFlow.setSpeed(currentSpeed);
  });

  let labelsOn = true;
  const labelsBtn = $("labels-btn");
  labelsBtn.addEventListener("click", () => {
    labelsOn = !labelsOn;
    setLabelsVisible(main.labelSprites, labelsOn);
    if (internalsData) setLabelsVisible(internalsData.labelSprites, labelsOn);
    labelsBtn.innerHTML = `🏷 <span>Labels: ${labelsOn ? "On" : "Off"}</span>`;
    labelsBtn.classList.toggle("active", labelsOn);
  });

  const rotateBtn = $("rotate-btn");
  rotateBtn.addEventListener("click", () => {
    controls.autoRotate = !controls.autoRotate;
    rotateBtn.innerHTML = `↻ <span>Auto-Rotate: ${controls.autoRotate ? "On" : "Off"}</span>`;
    rotateBtn.classList.toggle("active", controls.autoRotate);
  });

  $("reset-view-btn").addEventListener("click", () => {
    if (level === "internals") exitToMain();
    else flyTo(MAIN_CAM_POS, MAIN_TARGET, 0.8);
  });

  const fsBtn = $("fullscreen-btn");
  fsBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });
  document.addEventListener("fullscreenchange", () => {
    fsBtn.innerHTML = `⛶ <span>${document.fullscreenElement ? "Exit Fullscreen" : "Fullscreen"}</span>`;
  });

  const helpOverlay = $("help-overlay");
  $("help-btn").addEventListener("click", () => helpOverlay.classList.remove("hidden"));
  $("help-close").addEventListener("click", () => helpOverlay.classList.add("hidden"));
  helpOverlay.addEventListener("click", (e) => { if (e.target === helpOverlay) helpOverlay.classList.add("hidden"); });

  let legendCollapsed = false;
  const legendBody = $("legend-body");
  $("legend-toggle").addEventListener("click", () => {
    legendCollapsed = !legendCollapsed;
    legendBody.classList.toggle("hidden", legendCollapsed);
  });

  // ============================================================ render loop
  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05);

    if (camTween) {
      camTween.t += dt / camTween.duration;
      const k = easeInOutCubic(Math.min(1, camTween.t));
      camera.position.lerpVectors(camTween.fromPos, camTween.toPos, k);
      controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, k);
      if (camTween.t >= 1) camTween = null;
    }

    activeFlow.update(dt);
    applyFX();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(() => $("loading").classList.add("hidden"));
  tick();
}

function makeStarfield(THREE) {
  const COUNT = 1000;
  const positions = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const r = 70 + Math.random() * 220;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0x9fb0bd, size: 0.55, transparent: true, opacity: 0.5 });
  return new THREE.Points(geo, mat);
}

try {
  init();
} catch (err) {
  showFatalError(err);
}
