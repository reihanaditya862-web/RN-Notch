import { AUTO_SCALE, SCALE_OPTIONS } from "./constants";
import type { ScaleOption } from "./types";

/** True for a value that is one of the offered sizes. */
export function isScaleOption(value: unknown): value is ScaleOption {
  return SCALE_OPTIONS.some((option) => option.value === value);
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
