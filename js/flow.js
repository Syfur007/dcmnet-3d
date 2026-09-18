/**
 * flow.js
 * ----------------------------------------------------------------------------
 * Animates small glowing spheres ("data pulses") travelling along the edge
 * tubes built in scene.js. A node only "fires" (flashes + forwards pulses to
 * its outgoing edges) once ALL of its required incoming pulses have arrived —
 * this correctly models fan-in points such as CBFFM (needs both encoder
 * branches) and each DFEM decoder block (needs both the upsample path AND
 * the matching skip connection), exactly as described in the paper's
 * equations. A node with no outgoing edges (the output mask) ends the wave;
 * after a short pause the whole simulation restarts from the input image.
 * ----------------------------------------------------------------------------
 */

export class FlowSimulator {
  constructor(THREE, scene, { edges, nodeMeshes, onNodeFire, restartDelay = 1.6 }) {
    this.THREE = THREE;
    this.scene = scene;
    this.edges = edges;
    this.nodeMeshes = nodeMeshes;
    this.onNodeFire = onNodeFire || (() => {});
    this.restartDelay = restartDelay;

    this.speedMultiplier = 1;
    this.paused = false;
    this.simTime = 0;

    this.outgoingByNode = new Map();
    this.fanInRequired = new Map();
    edges.forEach((e, idx) => {
      if (!this.outgoingByNode.has(e.from)) this.outgoingByNode.set(e.from, []);
      this.outgoingByNode.get(e.from).push(idx);
      this.fanInRequired.set(e.to, (this.fanInRequired.get(e.to) || 0) + 1);
    });

    this.baseSpeed = 4.2; // world units / second at 1x speed

    this._particlePool = [];
    this._active = []; // { edgeIndex, t0, duration, mesh }
    this._arrived = new Map();
    this._fired = new Set();
    this._pendingRestartAt = null;

    this._buildParticleGeometry();
    this._findSourceNodes();
  }

  _buildParticleGeometry() {
    this._sphereGeo = new this.THREE.SphereGeometry(0.16, 10, 10);
  }

  _findSourceNodes() {
    // A "source" has no incoming edges at all (fan-in requirement 0) —
    // in this graph that is just the input image.
    const allTargets = new Set(this.edges.map((e) => e.to));
    const allNodes = new Set(this.nodeMeshes.keys());
    this._sources = [...allNodes].filter((id) => !allTargets.has(id));
  }

  _getParticleMesh(colorHex) {
    let mesh = this._particlePool.find((m) => !m.visible);
    if (!mesh) {
      const mat = new this.THREE.MeshBasicMaterial({ color: colorHex, toneMapped: false });
      mesh = new this.THREE.Mesh(this._sphereGeo, mat);
      mesh.renderOrder = 500;
      this.scene.add(mesh);
      this._particlePool.push(mesh);
    } else {
      mesh.material.color.set(colorHex);
    }
    mesh.visible = true;
    return mesh;
  }

  start() {
    this.reset();
  }

  reset() {
    for (const p of this._active) p.mesh.visible = false;
    this._active = [];
    this._arrived.clear();
    this._fired.clear();
    this._pendingRestartAt = null;
    for (const id of this._sources) this._fireNode(id, true);
  }

  setSpeed(multiplier) {
    this.speedMultiplier = Math.max(0.15, multiplier);
  }

  setPaused(paused) {
    this.paused = paused;
  }

  _fireNode(nodeId, isSource = false) {
    if (this._fired.has(nodeId)) return;
    this._fired.add(nodeId);
    if (!isSource) this.onNodeFire(nodeId);

    const outIdx = this.outgoingByNode.get(nodeId) || [];
    if (outIdx.length === 0) {
      // terminal node (the output mask) -> pause, then restart the whole wave
      this._pendingRestartAt = this.simTime + this.restartDelay;
      return;
    }
    for (const idx of outIdx) this._spawnPulse(idx);
  }

  _spawnPulse(edgeIndex) {
    const edge = this.edges[edgeIndex];
    const speed = this.baseSpeed * this.speedMultiplier;
    const duration = Math.max(0.35, edge.length / speed);
    const mesh = this._getParticleMesh(edge.wireColor);
    const p0 = edge.curve.getPointAt(0);
    mesh.position.copy(p0);
    this._active.push({ edgeIndex, t0: this.simTime, duration, mesh });
  }

  update(dt) {
    if (this.paused) return;
    this.simTime += dt;

    for (let i = this._active.length - 1; i >= 0; i--) {
      const p = this._active[i];
      const edge = this.edges[p.edgeIndex];
      const t = (this.simTime - p.t0) / p.duration;

      if (t >= 1) {
        p.mesh.visible = false;
        this._active.splice(i, 1);

        const arrivedSoFar = (this._arrived.get(edge.to) || 0) + 1;
        this._arrived.set(edge.to, arrivedSoFar);
        const required = this.fanInRequired.get(edge.to) || 1;
        if (arrivedSoFar >= required) this._fireNode(edge.to);
      } else {
        const pt = edge.curve.getPointAt(Math.min(1, Math.max(0, t)));
        p.mesh.position.copy(pt);
        const s = 0.85 + 0.3 * Math.sin(t * Math.PI); // gentle pulse-size breathing
        p.mesh.scale.setScalar(s);
      }
    }

    if (this._pendingRestartAt !== null && this.simTime >= this._pendingRestartAt) {
      this.reset();
    }
  }
}
