/**
 * Loads sample image/mask pairs and downsamples them into tensor pixels.
 */

const CANVAS = 176;

function newCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = CANVAS;
  return { canvas, ctx: canvas.getContext("2d") };
}

/** Averages CANVASxCANVAS pixel data down into a gridxgrid Float32Array. */
function downsample(ctx, grid) {
  const image = ctx.getImageData(0, 0, CANVAS, CANVAS).data;
  const pixels = new Float32Array(grid * grid * 3);
  const block = CANVAS / grid;
  for (let row = 0; row < grid; row++) {
    for (let column = 0; column < grid; column++) {
      let red = 0, green = 0, blue = 0, count = 0;
      const y0 = Math.floor(row * block), y1 = Math.floor((row + 1) * block);
      const x0 = Math.floor(column * block), x1 = Math.floor((column + 1) * block);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const index = (y * CANVAS + x) * 4;
          red += image[index];
          green += image[index + 1];
          blue += image[index + 2];
          count++;
        }
      }
      const output = (row * grid + column) * 3;
      pixels[output] = red / count / 255;
      pixels[output + 1] = green / count / 255;
      pixels[output + 2] = blue / count / 255;
    }
  }
  return pixels;
}

const SAMPLES = [
  { id: "skin", label: "Skin Lesion", sub: "Dermoscopy", input: "assets/lesion.jpg", mask: "assets/lesion_mask.png" },
  { id: "polyp", label: "Polyp", sub: "Endoscopy", input: "assets/polyp.png", mask: "assets/polyp_mask.png" },
];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load sample asset: ${src}`));
    image.src = src;
  });
}

function imagePixels(image, grid) {
  const { ctx } = newCanvas();
  ctx.drawImage(image, 0, 0, CANVAS, CANVAS);
  return downsample(ctx, grid);
}

/**
 * Returns ready-to-use samples:
 *   { id, label, sub, inputPixels, maskPixels }
 */
export async function generateSamples(grid) {
  return Promise.all(SAMPLES.map(async (sample) => {
    const [input, mask] = await Promise.all([loadImage(sample.input), loadImage(sample.mask)]);
    return {
      id: sample.id,
      label: sample.label,
      sub: sample.sub,
      inputPixels: imagePixels(input, grid),
      maskPixels: imagePixels(mask, grid),
    };
  }));
}
