# DCM-Net — Interactive 3D Architecture Visualization

A **TensorSpace.js-style**, animated **3D diagram** of **DCM-Net**, the
dual-encoder CNN–Mamba network with cross-branch fusion proposed in:

> Atabansi, C.C., Wang, S., Li, H., Nie, J., Xiang, L., Zhang, C., Liu, H.,
> Zhou, X., & Li, D. (2025). *DCM-Net: dual-encoder CNN-Mamba network with
> cross-branch fusion for robust medical image segmentation.*
> **BMC Medical Imaging**, 25:395. https://doi.org/10.1186/s12880-025-01942-4

Built with plain **[Three.js](https://threejs.org/)**, no build step, no
framework — just static files you can open in a browser or publish on
**GitHub Pages**. Designed to run full-screen on a classroom/lab projector
or an interactive smart board.

![status](https://img.shields.io/badge/build-static%20site-63e6a0)
![three.js](https://img.shields.io/badge/three.js-0.186.0-4fd3ff)

---

## What it shows

Every block — the input image, every encoder stage, every fusion module,
every decoder block, the output mask — is drawn as a **3D grid of small
cubes**, TensorSpace-style:

* **Position** in the grid = a pixel / spatial location.
* **Depth** (stacked along the flow direction) = channel count.
* The input image's 3 depth-slices are literally its **R, G, B channels**;
  the output's single slice is the predicted mask (bright = foreground).
* Every block's flat face points **down the pipeline** ("network-facing"),
  not at the camera — data visibly flows face-to-face from one block into
  the next.

On top of that:

* **Two parallel encoders**: Auxiliary (cyan, Mamba/VSS, *global* context)
  and Primary (orange, EfficientNet-B2 CNN, *local* detail).
* **Four CBFFM fusion blocks** (gold) — one per stage — plus a **3-stage
  decoder** (green, DFEM) with the paper's real skip connections (violet,
  bowed so they read clearly).
* A **Segmentation Head** (pink) producing the final mask.
* Small glowing **sweeps travel through each block's depth** the instant
  its real inputs have arrived — a CBFFM block only lights up once *both*
  its encoder inputs land; a decoder block only lights up once *both* the
  upsample path *and* its skip connection land. It's a literal simulation
  of the network's actual data-dependency graph, not a decorative loop.
* **Click any block → a description pops up.** For every encoder stage,
  every CBFFM module, every decoder block, and the segmentation head, an
  **"🔍 Explore Inside"** button appears — click it to fly the camera into
  a self-contained breakdown of that block's real internal computation
  (CBFFM and DFEM are modeled exactly from the paper's own equations; the
  VSS block and the EfficientNet-B2 block are faithful, representative
  breakdowns). Press **"← Back"** to fly back out.
* A **sample picker** (bottom-right) swaps the input image / mask for bundled
  skin-lesion and polyp image/mask pairs from `assets/`.

---

## File structure

```
.
├── index.html          # page shell, UI overlay markup, CDN import map
├── style.css           # dark "smart-board" theme for the overlay UI
├── js/
│   ├── architecture.js # DATA ONLY: every block + connection + the
│   │                    "look inside" sub-graphs (edit here!)
│   ├── tensor.js        # the instanced-cube "tensor volume" renderer
│   ├── scene.js         # turns architecture.js into THREE.js objects,
│   │                    at both the full-pipeline and "zoomed in" levels
│   ├── flow.js          # the data-flow / "pulse" animation engine
│   ├── labels.js        # floating text-sprite labels
│   ├── samples.js       # bundled sample image+mask loader
│   └── main.js          # renderer, camera, controls, drill-down state
│                         machine, sample picker, render loop
├── .nojekyll
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

No CI, no build step required.

---

## Customizing

* **Change the architecture layout / sizes / descriptions / internals** →
  edit `js/architecture.js` only — positions are computed automatically
  from each block's `grid`/`depth`, so resizing one block re-flows
  everything downstream of it.
* **Add/replace sample images** → add an image/mask pair under `assets/` and
  register their paths in `js/samples.js`.
* **Change colors** → edit `PALETTE` in `js/architecture.js` and the
  matching CSS variables in `style.css`.
* **Tune the cube density** → `PITCH` (cube spacing) lives in `js/tensor.js`;
  each block's `grid`/`depth` live in `js/architecture.js`.

---

## Credits & license

* **DCM-Net architecture & findings**: © the paper's authors (Atabansi et
  al., 2025), published open-access under
  [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
  This project is an independent, original educational visualization of the
  publicly described network structure — it does not reproduce any of the
  paper's figures, text, or data. The sample images are bundled assets for
  the interactive demo.
* **Code in this repository**: MIT-licensed — see [`LICENSE`](./LICENSE).
  Feel free to fork, adapt, and reuse for your own coursework.
* Built by **Syfur Rahman** (Roll 21CSE032, Session 2020–21), BSc CSE,
  University of Barishal — for a Machine Learning course paper review.
