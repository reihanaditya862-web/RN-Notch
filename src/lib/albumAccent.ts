/**
 * The neon outline, the waveform and the seek bar take their colours from
 * the cover of what is playing.
 *
 * The cover is drawn into a 24x24 canvas and its pixels are grouped by hue;
 * the hues with the most saturated, reasonably bright pixels win. That picks
 * the colours that read as "the cover's colours" rather than the average,
 * which for most covers is a muddy grey-brown. Each is then lifted so
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

/** One small canvas, reused for every cover, so sampling allocates nothing new. */
let samplerContext: CanvasRenderingContext2D | null = null;

function sampler(): CanvasRenderingContext2D | null {
  if (!samplerContext) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SAMPLE_SIZE;
    samplerContext = canvas.getContext("2d", { willReadFrequently: true });
  }
  return samplerContext;
}

/** Cover key -> its colours (1-3), or null when the cover has no colour to speak of. */
const cache = new Map<string, string[] | null>();

export function cachedPalette(key: string): string[] | null | undefined {
  return cache.get(key);
}

export async function extractPalette(key: string, imageUrl: string): Promise<string[] | null> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const image = new Image();
  image.src = imageUrl;
  await image.decode();

  const context = sampler();
  if (!context) return null;
  context.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const palette = pickPalette(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, palette);
  return palette;
}

/** A hue that holds at least this share of the strongest one joins the palette. */
const SECONDARY_SHARE = 0.07;
const MAX_COLORS = 3;

/**
 * The cover's vivid colours as #RRGGBB, strongest first (one to three), or
 * null for a grey or black image. Neighbouring hues count as one colour, so
 * the palette has real contrast rather than three shades of the same red.
 */
export function pickPalette(pixels: Uint8ClampedArray): string[] | null {
  const buckets = Array.from({ length: HUE_BUCKETS }, (_, index) => ({
    index,
    weight: 0,
    r: 0,
    g: 0,
    b: 0,
  }));

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

  const ranked = [...buckets].sort((a, b) => b.weight - a.weight);
  const best = ranked[0];
  if (best.weight === 0) return null;

  const isNeighbour = (a: number, b: number) => {
    const distance = Math.abs(a - b);
    return Math.min(distance, HUE_BUCKETS - distance) <= 1;
  };
  const chosen = [best];
  for (const bucket of ranked.slice(1)) {
    if (chosen.length >= MAX_COLORS || bucket.weight < best.weight * SECONDARY_SHARE) break;
    if (!chosen.some((picked) => isNeighbour(picked.index, bucket.index))) chosen.push(bucket);
  }
  return chosen.map((bucket) =>
    toNeon(bucket.r / bucket.weight, bucket.g / bucket.weight, bucket.b / bucket.weight),
  );
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
