# DCM-Net — Interactive 3D Architecture Visualization

An interactive, animated **3D diagram** of **DCM-Net**, the dual-encoder
CNN–Mamba network with cross-branch fusion proposed in:

> Atabansi, C.C., Wang, S., Li, H., Nie, J., Xiang, L., Zhang, C., Liu, H.,
> Zhou, X., & Li, D. (2025). *DCM-Net: dual-encoder CNN-Mamba network with
> cross-branch fusion for robust medical image segmentation.*
> **BMC Medical Imaging**, 25:395. https://doi.org/10.1186/s12880-025-01942-4

Built with plain **[Three.js](https://threejs.org/)**, no build step, no
framework — just static files you can open in a browser or publish on
**GitHub Pages**. It's designed to run full-screen on a classroom/lab
projector or an interactive smart board.

![status](https://img.shields.io/badge/build-static%20site-63e6a0)
![three.js](https://img.shields.io/badge/three.js-0.186.0-4fd3ff)

---

## What it shows

* The **input image** floating on the left, flowing into **two parallel
  encoders**:
  * **Auxiliary Encoder** (cyan) — Visual State-Space (Mamba/VSS) blocks,
    4 stages, capturing *global* context.
  * **Primary Encoder** (orange) — a pretrained EfficientNet-B2 CNN,
    4 stages, capturing *local* detail.
* Four **CBFFM** fusion nodes (gold) — one per stage — where both branches
  are combined, exactly per the paper's equations (`F_s`, `AP_f^s`).
* A **3-stage decoder** (green, DFEM blocks) that upsamples and fuses in the
  skip connections from each CBFFM stage — the bowed violet tubes.
* A **segmentation head** (pink) producing the final **predicted mask** on
  the right.
* Small glowing spheres continuously animate along the connections, and each
  block gently "pulses" the instant its inputs arrive — a literal, physically
  faithful simulation of the network's actual data-dependency graph (a CBFFM
  node only fires once *both* its encoder inputs have arrived; a decoder
  block only fires once *both* the upsample path *and* its skip connection
  have arrived).
* Click/tap any block for a plain-language description and the relevant
  formula from the paper.

The input photo and predicted mask are **original, procedurally generated
placeholder graphics** (drawn at runtime with the HTML canvas API) — not the
paper's own copyrighted figures — so this repository is safe to publish
publicly. Swap in your own images any time (see below).

---

## File structure

```
.
├── index.html          # page shell, UI overlay markup, CDN import map
├── style.css           # dark "smart-board" theme for the overlay UI
├── js/
│   ├── architecture.js # DATA ONLY: every node/edge of DCM-Net (edit here!)
│   ├── scene.js        # turns architecture.js into THREE.js meshes/tubes
│   ├── flow.js         # the data-flow / "pulse" animation engine
│   ├── labels.js       # floating text-sprite labels
│   ├── texture.js      # procedural input-image + mask canvas textures
│   └── main.js         # renderer, camera, controls, UI wiring, render loop
├── .nojekyll            # tells GitHub Pages to serve files as-is
├── LICENSE
└── README.md
```

No `package.json`, no bundler — `index.html` loads Three.js straight from a
CDN via an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap),
pinned to a specific version so it never silently breaks:

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/"
  }
}
</script>
```

---

## Run it locally

Because the page uses ES modules, most browsers block `import` over the
`file://` protocol — serve it with any static file server:

```bash
# Option A — Python (already on most systems)
python3 -m http.server 8000

# Option B — Node
npx serve .
```

Then open `http://localhost:8000`.

---

## Deploy on GitHub Pages

1. Create a new GitHub repository (or use an existing one) and push these
   files to the **root** of the default branch (usually `main`):
   ```bash
   git init
   git add .
   git commit -m "DCM-Net interactive 3D visualization"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. On GitHub, go to your repo → **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Under **Branch**, choose `main` and folder `/ (root)`, then **Save**.
5. Wait ~1 minute, then open the URL GitHub gives you (usually
   `https://<your-username>.github.io/<your-repo>/`).

That's it — no CI, no build step required.

---

## Using this on a smart board / projector

* Press the **⛶ Fullscreen** button (bottom bar) for a distraction-free view.
* One-finger drag rotates, pinch (or scroll) zooms, two-finger drag pans —
  all standard `OrbitControls` gestures, touch and mouse both work.
* Tap any block to pop up a short explanation — handy for walking an
  audience through the architecture live.
* Use **Speed** to slow the animation down while explaining a specific stage,
  or **Pause** to freeze it entirely.
* **Reset View** smoothly returns the camera to the default framing if
  someone (or a curious student) spins it out of view.

---

## Customizing

* **Change the architecture layout / labels / descriptions** → edit
  `js/architecture.js` only. Positions, channel counts, colors, titles and
  descriptions all live in that one file as plain data.
* **Use your own input image / mask** instead of the generated placeholder →
  in `js/scene.js`, swap the `CanvasTexture`s from `texture.js` for
  `new THREE.TextureLoader().load('assets/your-image.jpg')`, and add your
  image file under `assets/`.
* **Change colors** → edit the `PALETTE` object at the top of
  `js/architecture.js` and the matching CSS variables in `style.css`.

---

## Credits & license

* **DCM-Net architecture & findings**: © the paper's authors (Atabansi et
  al., 2025), published open-access under
  [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
  This project is an independent, original educational visualization of the
  publicly described network structure — it does not reproduce any of the
  paper's figures, text, or data.
* **Code in this repository**: MIT-licensed — see [`LICENSE`](./LICENSE).
  Feel free to fork, adapt, and reuse for your own coursework.
* Built by **Syfur Rahman** (Roll 21CSE032, Session 2020–21), BSc CSE,
  University of Barishal — for a Machine Learning course paper review.
