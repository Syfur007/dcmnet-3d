/**
 * tensor.js
 * ----------------------------------------------------------------------------
 * The core visual primitive, styled after TensorSpace.js: every tensor
 * (an input image, a feature map, a mask) is drawn as a 3D grid of small
 * cubes — spatial position (row, col) side by side, channel count as DEPTH.
 *
 * Convention used everywhere in this project:
 *   local +X = channel/depth axis (the direction data FLOWS through the net)
 *   local +Y = spatial "row" axis (image height)
 *   local +Z = spatial "col" axis (image width)
 * So every tensor volume's flat face points straight down the pipeline —
 * "network-facing", not camera-facing.
 *
 * For performance, one tensor volume = one THREE.InstancedMesh (a grid of
 * grid×grid×depth cubes can be thousands of cubes; InstancedMesh renders
 * all of them in a single draw call).
 * ----------------------------------------------------------------------------
 */

export const PITCH = 0.16; // world units between adjacent cube centers
const GAP_FACTOR = 0.24;   // fraction of pitch left empty between cubes (visual gap)

/**
 * Builds one instanced cube-grid.
 * @param {object} opts
 *   grid, depth      - integer grid dimensions (grid×grid spatial, `depth` deep)
 *   colorHex         - base/role color
 *   pixels           - OPTIONAL Float32Array(grid*grid*3), RGB 0..1, sampled
 *                       from a real image (used for input/output tensors).
 *   channelSlices    - OPTIONAL: if true and depth===pixels-implied channels,
 *                       colors each depth-slice as ONE color channel only
 *                       (slice 0 = red intensity, 1 = green, 2 = blue) — a
 *                       genuinely accurate "this is the R/G/B channel" view.
 *   channelBoost      - OPTIONAL: subtly emphasizes the matching RGB channel
 *                       on each input depth slice while retaining full color.
 *   maskColorHex     - OPTIONAL: retained for tensor API compatibility; mask
 *                       pixels are rendered as grayscale black-to-white.
 */
export function buildTensorVolume(THREE, opts) {
  const {
    grid, depth, colorHex = 0xffffff,
    pixels = null, channelSlices = false, channelBoost = false, maskColorHex = null,
  } = opts;

  const cubeSize = PITCH * (1 - GAP_FACTOR);
  const geo = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
  const count = Math.max(1, grid * grid * depth);

  const mat = pixels
    ? new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
    : new THREE.MeshStandardMaterial({
      color: 0xffffff, // per-instance color drives the actual look
      emissive: new THREE.Color(colorHex),
      emissiveIntensity: 0.28,
      metalness: 0.25,
      roughness: 0.55,
    });

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const width = grid * PITCH;   // Z extent
  const height = grid * PITCH;  // Y extent
  const thickness = depth * PITCH; // X extent
  const halfX = thickness / 2, halfY = height / 2, halfZ = width / 2;

  const dummy = new THREE.Object3D();
  const baseColor = new THREE.Color(colorHex);
  const instanceBaseColor = new Float32Array(count * 3); // stored for restoring after any FX
  const instanceDepthIndex = new Uint16Array(count);

  let i = 0;
  for (let d = 0; d < depth; d++) {
    const x = -halfX + PITCH * (d + 0.5);
    for (let r = 0; r < grid; r++) {
      const y = halfY - PITCH * (r + 0.5);
      for (let c = 0; c < grid; c++) {
        const z = -halfZ + PITCH * (c + 0.5);
        dummy.position.set(x, y, z);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        let col;
        if (pixels) {
          const pi = (r * grid + c) * 3;
          if (channelBoost && depth >= 3) {
            const red = pixels[pi], green = pixels[pi + 1], blue = pixels[pi + 2];
            const boost = (value, amount) => Math.min(1, value * amount);
            col = d === 0 ? new THREE.Color(boost(red, 1.18), boost(green, 0.88), boost(blue, 0.88))
                : d === 1 ? new THREE.Color(boost(red, 0.88), boost(green, 1.18), boost(blue, 0.88))
                : new THREE.Color(boost(red, 0.88), boost(green, 0.88), boost(blue, 1.18));
          } else if (channelSlices && depth >= 3) {
            // slice d shows ONLY that RGB channel's intensity
            const v = pixels[pi + Math.min(d, 2)];
            col = d === 0 ? new THREE.Color(v, v * 0.18, v * 0.18)
                : d === 1 ? new THREE.Color(v * 0.18, v, v * 0.18)
                : new THREE.Color(v * 0.18, v * 0.18, v);
          } else if (maskColorHex !== null) {
            const v = pixels[pi]; // mask stored as repeated single value in R
            col = new THREE.Color(0x05070a).lerp(new THREE.Color(0xffffff), v);
          } else {
            col = new THREE.Color(pixels[pi], pixels[pi + 1], pixels[pi + 2]);
          }
        } else {
          const jitter = 0.82 + Math.random() * 0.36;
          col = baseColor.clone().multiplyScalar(jitter);
        }
        mesh.setColorAt(i, col);
        instanceBaseColor[i * 3] = col.r;
        instanceBaseColor[i * 3 + 1] = col.g;
        instanceBaseColor[i * 3 + 2] = col.b;
        instanceDepthIndex[i] = d;
        i++;
      }
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return {
    mesh, grid, depth, width, height, thickness,
    halfX, halfY, halfZ,
    instanceBaseColor, instanceDepthIndex, count,
  };
}

/** Restores every instance to its originally-assigned color (undoes any FX tint). */
export function restoreBaseColors(THREE, tv) {
  const { mesh, instanceBaseColor, count } = tv;
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    c.setRGB(instanceBaseColor[i * 3], instanceBaseColor[i * 3 + 1], instanceBaseColor[i * 3 + 2]);
    mesh.setColorAt(i, c);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/**
 * A thin, glowing, additive-blended "scan plane" used to visualize a sweep
 * of activity travelling through a tensor volume's depth (X) axis.
 */
export function makeScanPlane(THREE, tv, colorHex) {
  const geo = new THREE.PlaneGeometry(tv.width * 1.08, tv.height * 1.08);
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex, transparent: true, opacity: 0.65,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  });
  const plane = new THREE.Mesh(geo, mat);
  plane.rotation.y = Math.PI / 2; // face along local X
  plane.visible = false;
  return plane;
}
