/**
 * scene.js
 * ----------------------------------------------------------------------------
 * Turns the plain-data graph in architecture.js into actual THREE.js objects:
 * node meshes (boxes / octahedra / image planes), floating labels, and the
 * static "wire" tubes that trace every connection (skip connections bow out
 * in +Z so they stay visually distinct from the main pipeline).
 * ----------------------------------------------------------------------------
 */
import { NODES, EDGES, PALETTE } from "./architecture.js";
import { makeLabelSprite } from "./labels.js";

function materialFor(THREE, role, colorHex) {
  const color = new THREE.Color(colorHex);
  if (role === "io") {
    return new THREE.MeshBasicMaterial({ color: 0x0c1420 });
  }
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.32,
    metalness: 0.35,
    roughness: 0.35,
  });
}

function buildNodeMesh(THREE, node, textures) {
  const color = PALETTE[node.role] ?? 0xffffff;

  if (node.type === "image") {
    const group = new THREE.Group();

    // frame backing
    const frameGeo = new THREE.PlaneGeometry(node.size * 1.12, node.size * 1.12);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x0c1420, emissive: 0x0c1420, emissiveIntensity: 0.32, metalness: 0.6, roughness: 0.3,
    });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    group.add(frame);

    const tex = node.id === "input" ? textures.inputTexture : textures.maskTexture;
    const picGeo = new THREE.PlaneGeometry(node.size, node.size);
    const picMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const pic = new THREE.Mesh(picGeo, picMat);
    pic.position.z = 0.06;
    group.add(pic);

    // thin glowing edge ring to make it pop out of the dark background
    const ringGeo = new THREE.RingGeometry(node.size * 0.56, node.size * 0.6, 4);
    const ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.io, transparent: true, opacity: 0.5 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.z = Math.PI / 4;
    ring.position.z = -0.05;
    group.add(ring);

    group.userData.pulseTarget = frame; // what the pulse animation scales
    return group;
  }

  if (node.type === "fusion") {
    const geo = new THREE.OctahedronGeometry(node.size * 0.95, 0);
    const mesh = new THREE.Mesh(geo, materialFor(THREE, node.role, color));
    mesh.userData.pulseTarget = mesh;
    return mesh;
  }

  if (node.type === "seghead") {
    const geo = new THREE.CylinderGeometry(node.size * 0.75, node.size * 0.75, node.depth, 6);
    const mesh = new THREE.Mesh(geo, materialFor(THREE, node.role, color));
    mesh.rotation.y = Math.PI / 6;
    mesh.userData.pulseTarget = mesh;
    return mesh;
  }

  // default: "box" — encoder / decoder stage
  const geo = new THREE.BoxGeometry(node.size, node.size, node.depth || 0.6);
  const mesh = new THREE.Mesh(geo, materialFor(THREE, node.role, color));
  mesh.userData.pulseTarget = mesh;
  return mesh;
}

function curveForEdge(THREE, fromPos, toPos, skip) {
  if (!skip) {
    const mid = fromPos.clone().lerp(toPos, 0.5);
    return new THREE.CatmullRomCurve3([fromPos.clone(), mid, toPos.clone()], false, "catmullrom", 0.2);
  }
  const bow = 5.2;
  const p1 = fromPos.clone().lerp(toPos, 0.32);
  p1.z += bow;
  const p2 = fromPos.clone().lerp(toPos, 0.68);
  p2.z += bow;
  return new THREE.CatmullRomCurve3([fromPos.clone(), p1, p2, toPos.clone()], false, "catmullrom", 0.35);
}

/**
 * Builds every node + edge and adds it all to `scene`.
 * Returns handles main.js needs for interaction + animation.
 */
export function buildScene(THREE, scene, textures) {
  const nodeMeshes = new Map();   // id -> the object used for raycasting / pulsing
  const nodePositions = new Map(); // id -> THREE.Vector3 (world position)
  const labelSprites = [];
  const raycastTargets = [];

  const root = new THREE.Group();
  scene.add(root);

  for (const node of NODES) {
    const pos = new THREE.Vector3(...node.pos);
    nodePositions.set(node.id, pos);

    const obj = buildNodeMesh(THREE, node, textures);
    obj.position.copy(pos);
    obj.userData.id = node.id;
    obj.userData.title = node.title;
    obj.userData.desc = node.desc;
    obj.userData.role = node.role;
    obj.userData.baseColor = PALETTE[node.role] ?? 0xffffff;
    // stamp every descendant too, so raycasting (which hits leaf meshes,
    // e.g. inside the "image" Group) can always resolve back to this node.
    obj.traverse((child) => {
      child.userData.nodeId = node.id;
      child.userData.title = node.title;
      child.userData.desc = node.desc;
      child.userData.role = node.role;
    });
    root.add(obj);
    nodeMeshes.set(node.id, obj);
    raycastTargets.push(obj);

    // floating label above the node
    const labelOffset = (node.size || 1.2) * 0.72 + 0.55;
    const label = makeLabelSprite(THREE, node.title, { fontSize: 40 });
    label.position.set(pos.x, pos.y + labelOffset, pos.z + 0.2);
    root.add(label);
    labelSprites.push(label);
  }

  const edges = [];
  for (const e of EDGES) {
    const fromPos = nodePositions.get(e.from);
    const toPos = nodePositions.get(e.to);
    const curve = curveForEdge(THREE, fromPos, toPos, e.skip);
    const length = curve.getLength();

    const tubularSegments = e.skip ? 48 : 12;
    const tubeGeo = new THREE.TubeGeometry(curve, tubularSegments, 0.045, 8, false);
    const wireColor = e.skip ? PALETTE.skipWire : (PALETTE[e.role] ?? 0xffffff);
    const tubeMat = new THREE.MeshBasicMaterial({
      color: wireColor, transparent: true, opacity: e.skip ? 0.38 : 0.28,
    });
    const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
    root.add(tubeMesh);

    edges.push({
      from: e.from, to: e.to, role: e.role, skip: !!e.skip,
      curve, length, wireColor,
    });
  }

  return { root, nodeMeshes, nodePositions, labelSprites, raycastTargets, edges };
}
