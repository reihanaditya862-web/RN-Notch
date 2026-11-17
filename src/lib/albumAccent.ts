/**
 * The neon outline takes its colour from the cover of what is playing.
 *
 * The cover is drawn into a 24x24 canvas and its pixels are grouped by hue;
 * the hue with the most saturated, reasonably bright pixels wins. That picks
 * the colour that reads as "the cover's colour" rather than the average,
 * which for most covers is a muddy grey-brown. The result is then lifted so
 * a thin line of it still glows on the black capsule.
 */

const SAMPLE_SIZE = 24;
const HUE_BUCKETS = 12;
/** Pixels below this saturation count as grey and never pick the colour. */
const MIN_SATURATION = 0.25;
/** Pixels darker than this (HSV value) are shadows, not colour. */
const MIN_VALUE = 0.18;
const MIN_LIGHTNESS = 0.55;
const MAX_LIGHTNESS = 0.72;
const MIN_OUTPUT_SATURATION = 0.6;
const CACHE_LIMIT = 32;

/** Cover key -> colour, or null when the cover has no colour to speak of. */
const cache = new Map<string, string | null>();

export function cachedAccent(key: string): string | null | undefined {
  return cache.get(key);
}

export async function extractAccent(key: string, imageUrl: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const image = new Image();
  image.src = imageUrl;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const color = pickAccent(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, color);
  return color;
}

/** Dominant vivid colour of RGBA pixels as #RRGGBB, or null for grey/black images. */
export function pickAccent(pixels: Uint8ClampedArray): string | null {
  const buckets = Array.from({ length: HUE_BUCKETS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const value = max / 255;
    const saturation = max === 0 ? 0 : (max - min) / max;
    if (value < MIN_VALUE || saturation < MIN_SATURATION) continue;

    const bucket = buckets[Math.floor((hueOf(r, g, b, max, min) / 360) * HUE_BUCKETS) % HUE_BUCKETS];
    const weight = saturation * saturation * value;
    bucket.weight += weight;
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
  }

  const best = buckets.reduce((a, b) => (b.weight > a.weight ? b : a));
  if (best.weight === 0) return null;
  return toNeon(best.r / best.weight, best.g / best.weight, best.b / best.weight);
}

function hueOf(r: number, g: number, b: number, max: number, min: number): number {
  const delta = max - min;
  if (delta === 0) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
}

/** Keeps the hue, lifts saturation and lightness into the range that glows on black. */
function toNeon(r: number, g: number, b: number): string {
  const [hue, saturation, lightness] = rgbToHsl(r / 255, g / 255, b / 255);
  return hslToHex(
    hue,
    Math.max(saturation, MIN_OUTPUT_SATURATION),
    Math.min(Math.max(lightness, MIN_LIGHTNESS), MAX_LIGHTNESS),
  );
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  return [hueOf(r, g, b, max, min), Math.min(1, saturation), lightness];
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const [r, g, b] =
    hue < 60 ? [chroma, x, 0]
    : hue < 120 ? [x, chroma, 0]
    : hue < 180 ? [0, chroma, x]
    : hue < 240 ? [0, x, chroma]
    : hue < 300 ? [x, 0, chroma]
    : [chroma, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}
