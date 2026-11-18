/** Colours are handled as "#RRGGBB" text, the same form settings.json stores. */

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Saturation and lightness used when a colour is picked by hue alone. */
const PICKER_SATURATION = 0.85;
const PICKER_LIGHTNESS = 0.6;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

/** Returns the colour in upper case, or `fallback` when it is not "#RRGGBB". */
export function normalizeHex(value: unknown, fallback: string): string {
  return isHexColor(value) ? value.toUpperCase() : fallback;
}

/**
 * Reads what the user is typing as a colour: the leading "#" is optional.
 * Returns null until it is a complete six-digit value.
 */
export function parseTypedHex(text: string): string | null {
  const candidate = `#${text.trim().replace(/^#/, "")}`;
  return isHexColor(candidate) ? candidate.toUpperCase() : null;
}

function toHex(channel: number): string {
  return Math.round(Math.min(1, Math.max(0, channel)) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

/** A vivid colour of the given hue (0-360). */
export function hexFromHue(hue: number): string {
  const h = (((hue % 360) + 360) % 360) / 60;
  const chroma = (1 - Math.abs(2 * PICKER_LIGHTNESS - 1)) * PICKER_SATURATION;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const m = PICKER_LIGHTNESS - chroma / 2;

  const [r, g, b] =
    h < 1 ? [chroma, x, 0]
    : h < 2 ? [x, chroma, 0]
    : h < 3 ? [0, chroma, x]
    : h < 4 ? [0, x, chroma]
    : h < 5 ? [x, 0, chroma]
    : [chroma, 0, x];

  return `#${toHex(r + m)}${toHex(g + m)}${toHex(b + m)}`;
}

/** Hue (0-360) of a colour; 0 for greys, which have none. */
export function hueFromHex(hex: string): number {
  if (!isHexColor(hex)) return 0;

  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;

  const sector =
    max === r ? ((g - b) / delta) % 6
    : max === g ? (b - r) / delta + 2
    : (r - g) / delta + 4;
  return Math.round((sector * 60 + 360) % 360);
}

/**
 * The colour a copied text stands for, as "#RRGGBB": "#3a7", "#33AA77",
 * "rgb(51, 170, 119)" or "rgba(51,170,119,0.5)". Null for anything else.
 */
export function colorFromText(text: string): string | null {
  const value = text.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  if (isHexColor(value)) return value.toUpperCase();

  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i.exec(
    value,
  );
  if (!rgb) return null;
  const channels = rgb.slice(1, 4).map(Number);
  if (channels.some((channel) => channel > 255)) return null;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
