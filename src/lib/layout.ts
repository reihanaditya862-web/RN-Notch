import {
  AI_DRAWER_HEIGHT,
  ISLAND_TOP_OFFSET,
  LIP_HEIGHT_PX,
  NOTCH_BOTTOM_RADIUS,
  NOTCH_EAR_RADIUS,
  NOTCH_SIZES,
} from "./constants";
import type { AppSettings, NotchState } from "./types";

/** Final geometry of the capsule, in px, relative to the window. */
export interface NotchShape {
  width: number;
  height: number;
  /** Distance from the top edge of the screen. */
  top: number;
  /** Radius of the two top corners (convex, rounding inwards). */
  topRadius: number;
  /** Radius of the two bottom corners. */
  bottomRadius: number;
  /**
   * Radius of the two ears: concave curves that flare outwards from the top
   * corners into the screen edge. Zero in island mode.
   */
  earRadius: number;
}

/**
 * Layout of the dashboard (the `expanded` state). Its pages share one fixed
 * size; the page content sits above a row of page dots.
 */
export const DASHBOARD = {
  padding: 12,
  gap: 8,
  media: 72,
  /** The page dots at the bottom. */
  dots: 10,
} as const;

/** True for the two collapsed states, the ones that sit on screen all day. */
export function isCollapsedState(state: NotchState): boolean {
  return state === "idle" || state === "idleMedia";
}

interface ShapeOptions {
  /**
   * An app window is under the capsule and the user is not on it: draw the
   * collapsed capsule as the retracted lip.
   */
  isRetracted?: boolean;
  /** The size factor in effect (1 = 100%); keeps the lip a fixed real height. */
  uiScale?: number;
  /** The AI drawer below the media controls is open (hover state). */
  isDrawerOpen?: boolean;
  /** Size of the pop-up shown in the `alert` state. */
  alertSize?: { width: number; height: number };
  /** Height of the dashboard for the page on show (see `dashboardHeight`). */
  dashboardHeight?: number;
  /** Extra width of the collapsed capsule for a live activity beside the clock. */
  activityWidth?: number;
}

/**
 * The capsule's geometry for a state and the user's settings. This is the one
 * place its width, height and position are decided.
 *
 * - Island: floats `ISLAND_TOP_OFFSET` below the top edge. The collapsed
 *   capsule and the pop-ups are full pills (radius = half their height);
 *   larger states keep their own radius, because a full pill would cut into
 *   their content.
 * - Notch: touches the top edge. Instead of square top corners it has ears
 *   that flare out into the edge, so it seems to grow out of the bezel; only
 *   the bottom corners are rounded inwards.
 * - Retracted (`isRetracted`, both modes): the collapsed capsule keeps its
 *   width and horizontal position, its top edge goes to the top of the
 *   screen and its bottom edge rises until only a lip of `LIP_HEIGHT_PX`
 *   real pixels is left. The states the user opens are not affected.
 */
export function getNotchShape(
  state: NotchState,
  settings: AppSettings,
  {
    isRetracted = false,
    uiScale = 1,
    isDrawerOpen = false,
    alertSize,
    dashboardHeight,
    activityWidth = 0,
  }: ShapeOptions = {},
): NotchShape {
  const base = NOTCH_SIZES[state];
  const isCollapsed = isCollapsedState(state);

  if (isRetracted && isCollapsed) {
    // Sizes here are in capsule units, which are drawn `uiScale` times
    // larger; dividing keeps the lip the same on screen at every size.
    const lip = LIP_HEIGHT_PX / uiScale;
    return {
      width: base.width,
      height: lip,
      top: 0,
      topRadius: 0,
      bottomRadius: lip / 2,
      earRadius: 0,
    };
  }

  const isAlert = state === "alert";
  const width = isAlert && alertSize ? alertSize.width : base.width + (isCollapsed ? activityWidth : 0);
  const height =
    isAlert && alertSize
      ? alertSize.height
      : state === "hover" && isDrawerOpen
        ? base.height + AI_DRAWER_HEIGHT
        : state === "expanded" && dashboardHeight
          ? dashboardHeight
          : base.height;

  if (settings.display_mode === "notch") {
    // A low capsule cannot carry the full radii: the ear and the bottom
    // corner share one side and may not add up to more than its height.
    const bottomRadius = Math.min(NOTCH_BOTTOM_RADIUS, height / 2 + 2);
    return {
      width,
      height,
      top: 0,
      topRadius: 0,
      bottomRadius,
      earRadius: Math.min(NOTCH_EAR_RADIUS, height - bottomRadius),
    };
  }

  const radius = isCollapsed || isAlert ? Math.min(height / 2, 30) : base.radius;
  return {
    width,
    height,
    top: ISLAND_TOP_OFFSET,
    topRadius: radius,
    bottomRadius: radius,
    earRadius: 0,
  };
}
