/**
 * SVG outlines of the capsule.
 *
 * The capsule is drawn as one path rather than a CSS box, because the notch
 * shape cannot be expressed with `border-radius`: its top corners curve
 * *outwards* into the screen edge (the "ears"). One path gives one seamless
 * fill and one continuous border for both display modes.
 *
 * Coordinates: x = 0 is the capsule's left edge, y = 0 its top edge. Ears
 * extend to negative x and beyond `width`.
 *
 * `topCurve` is a single signed number so the two modes can morph into each
 * other without a jump:
 *   > 0  ears of that radius (notch mode)
 *   = 0  square top corners
 *   < 0  ordinary rounded top corners of that radius (island mode)
 */

/** Keeps path strings short and stable; 1/100px is far below what is visible. */
function n(value: number): number {
  return Math.round(value * 100) / 100;
}

interface Radii {
  /** Ear radius (0 when the top is convex or square). */
  ear: number;
  /** Convex top radius (0 when there are ears). */
  top: number;
  bottom: number;
}

/** Splits `topCurve` and shrinks radii that would not fit the box. */
function fitRadii(width: number, height: number, topCurve: number, bottomRadius: number): Radii {
  const halfWidth = Math.max(0, width / 2);
  const top = Math.min(Math.max(0, -topCurve), halfWidth, Math.max(0, height));
  const bottom = Math.min(Math.max(0, bottomRadius), halfWidth, Math.max(0, height - top));
  const ear = Math.min(Math.max(0, topCurve), Math.max(0, height - bottom));
  return { ear, top, bottom };
}

/** Closed outline for the capsule's fill. */
export function buildFillPath(
  width: number,
  height: number,
  topCurve: number,
  bottomRadius: number,
): string {
  const { ear, top, bottom } = fitRadii(width, height, topCurve, bottomRadius);
  const [w, h, e, r, b] = [n(width), n(height), n(ear), n(top), n(bottom)];

  if (topCurve >= 0) {
    // From the left ear's tip, down the left side, along the bottom, up the
    // right side and out to the right ear's tip; the top edge closes it.
    return [
      `M${n(-ear)} 0`,
      `A${e} ${e} 0 0 1 0 ${e}`,
      `V${n(height - bottom)}`,
      `A${b} ${b} 0 0 0 ${b} ${h}`,
      `H${n(width - bottom)}`,
      `A${b} ${b} 0 0 0 ${w} ${n(height - bottom)}`,
      `V${e}`,
      `A${e} ${e} 0 0 1 ${n(width + ear)} 0`,
      "Z",
    ].join("");
  }

  return [
    `M${r} 0`,
    `H${n(width - top)}`,
    `A${r} ${r} 0 0 1 ${w} ${r}`,
    `V${n(height - bottom)}`,
    `A${b} ${b} 0 0 1 ${n(width - bottom)} ${h}`,
    `H${b}`,
    `A${b} ${b} 0 0 1 0 ${n(height - bottom)}`,
    `V${r}`,
    `A${r} ${r} 0 0 1 ${r} 0`,
    "Z",
  ].join("");
}

/**
 * Outline for a 1px border, drawn half a pixel inside the fill so the line
 * lands on whole pixels and stays crisp.
 *
 * With ears the path is left open along the top: there the capsule meets the
 * screen edge, and a line would separate it from the bezel it should merge with.
 */
export function buildStrokePath(
  width: number,
  height: number,
  topCurve: number,
  bottomRadius: number,
  inset = 0.5,
): string {
  const { ear, top, bottom } = fitRadii(width, height, topCurve, bottomRadius);
  const i = inset;
  const innerBottom = n(Math.max(0, bottom - i));

  if (topCurve >= 0) {
    // The ear is concave, so "inside the fill" means a slightly larger arc.
    const outerEar = n(ear + i);
    return [
      `M${n(-ear)} ${n(-i)}`,
      `A${outerEar} ${outerEar} 0 0 1 ${n(i)} ${n(ear)}`,
      `V${n(height - bottom)}`,
      `A${innerBottom} ${innerBottom} 0 0 0 ${n(bottom)} ${n(height - i)}`,
      `H${n(width - bottom)}`,
      `A${innerBottom} ${innerBottom} 0 0 0 ${n(width - i)} ${n(height - bottom)}`,
      `V${n(ear)}`,
      `A${outerEar} ${outerEar} 0 0 1 ${n(width + ear)} ${n(-i)}`,
    ].join("");
  }

  const innerTop = n(Math.max(0, top - i));
  return [
    `M${n(top)} ${n(i)}`,
    `H${n(width - top)}`,
    `A${innerTop} ${innerTop} 0 0 1 ${n(width - i)} ${n(top)}`,
    `V${n(height - bottom)}`,
    `A${innerBottom} ${innerBottom} 0 0 1 ${n(width - bottom)} ${n(height - i)}`,
    `H${n(bottom)}`,
    `A${innerBottom} ${innerBottom} 0 0 1 ${n(i)} ${n(height - bottom)}`,
    `V${n(top)}`,
    `A${innerTop} ${innerTop} 0 0 1 ${n(top)} ${n(i)}`,
    "Z",
  ].join("");
}
