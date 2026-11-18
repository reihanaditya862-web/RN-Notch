/**
 * Team logos come from Wikipedia, sometimes on a white or plain coloured
 * background. This turns any of them into a logo with no background at all:
 * the border's main colour is made transparent (with a soft edge), the empty
 * margin is cropped, and black or dark grey parts are lifted to white so
 * they read on the black capsule.
 */

const MAX_SIDE = 256;
/** Colours this close to the background become fully transparent... */
const KEY_NEAR = 38;
/** ...and fade back in until this far, so edges stay smooth. */
const KEY_FAR = 72;
/** Pixels darker than this... */
const DARK_LOGO = 70;
/** ...and this close to grey (channel spread) are lifted to white. */
const GREY_SPREAD = 40;

function distance(data: Uint8ClampedArray, i: number, [r, g, b]: number[]): number {
  return Math.hypot(data[i] - r, data[i + 1] - g, data[i + 2] - b);
}

/** Share of the border that must have one colour for it to count as the background. */
const BACKGROUND_SHARE = 0.35;

/**
 * The background colour: the most common colour along the image's border.
 * Logos often touch the border (a word running edge to edge), so the border
 * need not be one colour throughout, only mostly.
 */
function borderColor(data: Uint8ClampedArray, width: number, height: number): number[] | null {
  // The border of the opaque part: an image may carry a thin transparent
  // margin around a solid background, which would otherwise hide it.
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < 200) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) return null;
  const samples: number[] = [];
  for (let x = left; x <= right; x += 1) samples.push(top * width + x, bottom * width + x);
  for (let y = top + 1; y < bottom; y += 1) samples.push(y * width + left, y * width + right);

  let transparent = 0;
  const groups = new Map<number, { count: number; sum: number[] }>();
  for (const pixel of samples) {
    const i = pixel * 4;
    if (data[i + 3] < 200) {
      transparent += 1;
      continue;
    }
    // Colours within 16 levels per channel fall into one group.
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const group = groups.get(key) ?? { count: 0, sum: [0, 0, 0] };
    group.count += 1;
    group.sum[0] += data[i];
    group.sum[1] += data[i + 1];
    group.sum[2] += data[i + 2];
    groups.set(key, group);
  }
  // Already transparent around the edges: nothing to remove.
  if (transparent > samples.length * 0.3) return null;

  let best: { count: number; sum: number[] } | null = null;
  for (const group of groups.values()) if (!best || group.count > best.count) best = group;
  if (!best) return null;
  const mean = best.sum.map((value) => value / best.count);
  // A colour on the edge of two groups is split between them; count every
  // border pixel close to the main colour instead.
  const close = samples.filter((pixel) => {
    const i = pixel * 4;
    return data[i + 3] >= 200 && distance(data, i, mean) < KEY_NEAR;
  }).length;
  return close >= samples.length * BACKGROUND_SHARE ? mean : null;
}

export async function transparentLogo(source: string): Promise<string> {
  const image = new Image();
  image.src = source;
  await image.decode();

  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return source;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  const data = pixels.data;

  const background = borderColor(data, width, height);
  if (background) {
    for (let i = 0; i < data.length; i += 4) {
      const gap = distance(data, i, background);
      if (gap <= KEY_NEAR) data[i + 3] = 0;
      else if (gap < KEY_FAR) data[i + 3] = Math.round((data[i + 3] * (gap - KEY_NEAR)) / (KEY_FAR - KEY_NEAR));
    }
  }

  // Crop to what is left. Black and dark grey parts (lettering, outlines)
  // would vanish on the black capsule, so they turn white; colours stay.
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 24) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      const lightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lightness < DARK_LOGO && max - min < GREY_SPREAD) {
        data[i] = data[i + 1] = data[i + 2] = 255;
      }
    }
  }
  if (right < 0) return source;

  context.putImageData(pixels, 0, 0);
  const cropped = document.createElement("canvas");
  cropped.width = right - left + 1;
  cropped.height = bottom - top + 1;
  cropped
    .getContext("2d")
    ?.drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
  return cropped.toDataURL("image/png");
}
