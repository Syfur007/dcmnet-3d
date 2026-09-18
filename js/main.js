/**
 * main.js — entry point.
 * Sets up the THREE.js renderer/scene/camera, builds the DCM-Net graph,
 * starts the flow animation, and wires up every UI control.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildScene } from "./scene.js";
import { FlowSimulator } from "./flow.js";
import { createInputImageTexture, createMaskTexture } from "./texture.js";
import { setLabelsVisible } from "./labels.js";

// ---------------------------------------------------------------- helpers --
const $ = (id) => document.getElementById(id);

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

// ------------------------------------------------------------------- init --
function init() {
  const container = $("canvas-container");

  // ---- renderer -------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  // ---- scene / fog / starfield -----------------------------------------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b12);
  scene.fog = new THREE.FogExp2(0x070b12, 0.014);

  scene.add(makeStarfield(THREE));

  // ---- camera + controls -------------------------------------------------
  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 300);
  const DEFAULT_CAM_POS = new THREE.Vector3(3, 6.5, 29);
  const DEFAULT_TARGET = new THREE.Vector3(1.5, 0, 0);
  camera.position.copy(DEFAULT_CAM_POS);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(DEFAULT_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 8;
  controls.maxDistance = 62;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.9;
  controls.update();

  // ---- lights --------------------------------------------------------
  scene.add(new THREE.AmbientLight(0x8fa6c9, 0.55));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
  keyLight.position.set(10, 18, 14);
  scene.add(keyLight);
  const coolFill = new THREE.PointLight(0x4fd3ff, 220, 60);
  coolFill.position.set(-14, 8, 10);
  scene.add(coolFill);
  const warmFill = new THREE.PointLight(0xff9d4d, 220, 60);
  warmFill.position.set(-14, -8, 10);
  scene.add(warmFill);
  const rimLight = new THREE.PointLight(0x63e6a0, 180, 60);
  rimLight.position.set(16, 0, 14);
  scene.add(rimLight);

  // ---- build the DCM-Net graph -----------------------------------------
  const inputTexture = createInputImageTexture(THREE);
  const maskTexture = createMaskTexture(THREE);
  const { nodeMeshes, labelSprites, raycastTargets, edges } = buildScene(
    THREE, scene, { inputTexture, maskTexture }
  );

  // ---- node "fire" pulse visual (scale + emissive flash) ----------------
  const pulseState = new Map(); // nodeId -> { start, duration }
  const clock = new THREE.Clock();

  function onNodeFire(nodeId) {
    pulseState.set(nodeId, { start: clock.getElapsedTime(), duration: 0.55 });
  }

  function applyPulseVisuals() {
    const now = clock.getElapsedTime();
    for (const [id, p] of pulseState) {
      const elapsed = now - p.start;
      if (elapsed >= p.duration) {
        pulseState.delete(id);
        const obj = nodeMeshes.get(id);
        const target = obj?.userData?.pulseTarget;
        if (target) target.scale.setScalar(1);
        if (target?.material && "emissiveIntensity" in target.material) {
          target.material.emissiveIntensity = 0.32;
        }
        continue;
      }
      const factor = Math.sin((elapsed / p.duration) * Math.PI); // 0 -> 1 -> 0
      const obj = nodeMeshes.get(id);
      const target = obj?.userData?.pulseTarget;
      if (target) target.scale.setScalar(1 + 0.4 * factor);
      if (target?.material && "emissiveIntensity" in target.material) {
        target.material.emissiveIntensity = 0.32 + 1.1 * factor;
      }
    }
  }

  // ---- flow simulation ---------------------------------------------------
  const flow = new FlowSimulator(THREE, scene, { edges, nodeMeshes, onNodeFire });
  flow.start();

  // ---- interaction: click a node for info --------------------------------
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  let selectedId = null;

  function setSelected(id) {
    if (selectedId && nodeMeshes.has(selectedId)) {
      const prev = nodeMeshes.get(selectedId).userData.pulseTarget;
      if (prev?.material && "emissiveIntensity" in prev.material) prev.material.emissiveIntensity = 0.32;
    }
    selectedId = id;
    if (id && nodeMeshes.has(id)) {
      const obj = nodeMeshes.get(id);
      const t = obj.userData.pulseTarget;
      if (t?.material && "emissiveIntensity" in t.material) t.material.emissiveIntensity = 0.9;
      showInfo(obj.userData.title, obj.userData.desc);
    } else {
      hideInfo();
    }
  }

  function pointerToNodeId(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObjects(raycastTargets, true);
    return hits.length ? hits[0].object.userData.nodeId : null;
  }

  let downX = 0, downY = 0;
  renderer.domElement.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    // ignore drags (orbit gestures) — only treat as a "click" if the pointer barely moved
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
    const id = pointerToNodeId(e.clientX, e.clientY);
    setSelected(id);
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    const id = pointerToNodeId(e.clientX, e.clientY);
    renderer.domElement.style.cursor = id ? "pointer" : "grab";
  });

  // ---- info panel DOM ----------------------------------------------------
  const infoPanel = $("info-panel");
  const infoTitle = $("info-title");
  const infoDesc = $("info-desc");
  function showInfo(title, desc) {
    infoTitle.textContent = title;
    infoDesc.textContent = desc;
    infoPanel.classList.remove("hidden");
  }
  function hideInfo() { infoPanel.classList.add("hidden"); }
  $("info-close").addEventListener("click", () => setSelected(null));

  // ---- resize --------------------------------------------------------
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- camera reset tween -------------------------------------------------
  let camTween = null;
  function resetView() {
    camTween = {
      t: 0, duration: 0.8,
      fromPos: camera.position.clone(), toPos: DEFAULT_CAM_POS.clone(),
      fromTarget: controls.target.clone(), toTarget: DEFAULT_TARGET.clone(),
    };
  }
  function easeInOutCubic(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

  // ============================================================ UI wiring ==
  let playing = true;
  const playPauseBtn = $("play-pause-btn");
  playPauseBtn.addEventListener("click", () => {
    playing = !playing;
    flow.setPaused(!playing);
    playPauseBtn.innerHTML = playing ? "⏸ <span>Pause</span>" : "▶ <span>Play</span>";
    playPauseBtn.classList.toggle("active", !playing);
  });

  $("speed-slider").addEventListener("input", (e) => flow.setSpeed(parseFloat(e.target.value)));

  let labelsOn = true;
  const labelsBtn = $("labels-btn");
  labelsBtn.addEventListener("click", () => {
    labelsOn = !labelsOn;
    setLabelsVisible(labelSprites, labelsOn);
    labelsBtn.innerHTML = `🏷 <span>Labels: ${labelsOn ? "On" : "Off"}</span>`;
    labelsBtn.classList.toggle("active", labelsOn);
  });

  const rotateBtn = $("rotate-btn");
  rotateBtn.addEventListener("click", () => {
    controls.autoRotate = !controls.autoRotate;
    rotateBtn.innerHTML = `↻ <span>Auto-Rotate: ${controls.autoRotate ? "On" : "Off"}</span>`;
    rotateBtn.classList.toggle("active", controls.autoRotate);
  });

  $("reset-view-btn").addEventListener("click", resetView);

  const fsBtn = $("fullscreen-btn");
  fsBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });
  document.addEventListener("fullscreenchange", () => {
    const isFs = !!document.fullscreenElement;
    fsBtn.innerHTML = `⛶ <span>${isFs ? "Exit Fullscreen" : "Fullscreen"}</span>`;
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

    flow.update(dt);
    applyPulseVisuals();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  // first frame is ready synchronously (everything here is procedural —
  // no textures/models to wait on), so we can dismiss the loading splash now.
  requestAnimationFrame(() => {
    $("loading").classList.add("hidden");
  });
  tick();
}

function makeStarfield(THREE) {
  const COUNT = 900;
  const positions = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const r = 60 + Math.random() * 140;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0x9fb0bd, size: 0.55, transparent: true, opacity: 0.55 });
  return new THREE.Points(geo, mat);
}

try {
  init();
} catch (err) {
  showFatalError(err);
}
