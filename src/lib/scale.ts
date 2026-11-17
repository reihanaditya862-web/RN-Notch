import { AUTO_SCALE, RETIRED_SCALES, SCALE_OPTIONS } from "./constants";
import type { ScaleOption } from "./types";

/** True for a value that is one of the offered sizes. */
export function isScaleOption(value: unknown): value is ScaleOption {
  return SCALE_OPTIONS.some((option) => option.value === value);
}

/**
 * Turns whatever was stored into an offered size: current values pass
 * through, the two retired ones are mapped (125% -> 130%, 175% -> 150%), and
 * anything else becomes `fallback`. Safe to apply any number of times.
 */
export function normalizeScale(value: unknown, fallback: ScaleOption): ScaleOption {
  if (isScaleOption(value)) return value;
  if (typeof value === "string" && value in RETIRED_SCALES) return RETIRED_SCALES[value];
  return fallback;
}

/**
 * Turns the user's size choice into a factor (1 = 100%).
 *
 * "auto" follows the screen: the capsule keeps the same share of the desktop
 * on a wider or narrower monitor, within sensible limits. `screenWidth` is
 * the desktop width in CSS pixels (`window.screen.width`).
 */
export function resolveScale(option: ScaleOption, screenWidth: number): number {
  if (option !== "auto") return Number(option) / 100;

  const raw = screenWidth / AUTO_SCALE.referenceWidth;
  if (!Number.isFinite(raw) || raw <= 0) return 1;

  const clamped = Math.min(AUTO_SCALE.max, Math.max(AUTO_SCALE.min, raw));
  // Steps of 5% keep text on whole-ish pixels.
  return Math.round(clamped * 20) / 20;
}
