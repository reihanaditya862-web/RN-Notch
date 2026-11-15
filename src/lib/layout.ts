import {
  COMPACT_HEIGHT,
  ISLAND_TOP_OFFSET,
  ISLAND_TOP_OFFSET_COMPACT,
  NOTCH_BOTTOM_RADIUS,
  NOTCH_EAR_RADIUS,
  NOTCH_SIZES,
} from "./constants";
import type { ActiveWidgets, AppSettings, NotchState } from "./types";

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

/** Heights of the dashboard's parts, in px. `ExpandedView` lays out to these. */
export const DASHBOARD = {
  padding: 12,
  gap: 8,
  media: 72,
  /** Clock + collapse row, shown instead of the media player when it is off. */
  header: 20,
  rule: 1,
  system: 70,
  fileShelf: 50,
  scratchpad: 28,
  /** Message shown when every widget is switched off. */
  empty: 32,
} as const;

/** Border of the capsule; the content sits inside it. */
const BORDER = 1;

/** Height of the dashboard for a set of active widgets. */
export function getDashboardHeight(widgets: ActiveWidgets): number {
  const rows: number[] = widgets.media ? [DASHBOARD.media, DASHBOARD.rule] : [DASHBOARD.header];
  if (widgets.system) rows.push(DASHBOARD.system);
  if (widgets.file_shelf) rows.push(DASHBOARD.fileShelf);
  if (widgets.scratchpad) rows.push(DASHBOARD.scratchpad);

  const hasBody = widgets.system || widgets.file_shelf || widgets.scratchpad;
  if (!widgets.media && !hasBody) rows.push(DASHBOARD.empty);

  const content = rows.reduce((sum, row) => sum + row, 0) + DASHBOARD.gap * (rows.length - 1);
  // +1 leaves a pixel of slack so a sub-pixel rounding never squeezes a row.
  return content + (DASHBOARD.padding + BORDER) * 2 + 1;
}

/** True for the two collapsed states, the ones that sit on screen all day. */
export function isCollapsedState(state: NotchState): boolean {
  return state === "idle" || state === "idleMedia";
}

/**
 * The capsule's geometry for a state, the user's settings, and whether a
 * maximized app is in front.
 *
 * - Island: floats `ISLAND_TOP_OFFSET` below the top edge. The collapsed
 *   capsule is a full pill (radius = half its height, what `rounded-full`
 *   resolves to); larger states keep their own radius, because a full pill
 *   would cut into their content.
 * - Notch: touches the top edge. Instead of square top corners it has ears
 *   that flare out into the edge, so it seems to grow out of the bezel; only
 *   the bottom corners are rounded inwards.
 * - Compact (`isCompact`): the collapsed capsule gets lower and, in island
 *   mode, moves closer to the edge, to stay clear of a maximized browser's
 *   tab strip. The states the user opens on purpose are not affected.
 */
export function getNotchShape(
  state: NotchState,
  settings: AppSettings,
  isCompact = false,
): NotchShape {
  const base = NOTCH_SIZES[state];
  const isCollapsed = isCollapsedState(state);
  const useCompact = isCompact && isCollapsed;

  let height = base.height;
  if (state === "expanded") height = getDashboardHeight(settings.active_widgets);
  else if (useCompact) height = COMPACT_HEIGHT;

  if (settings.display_mode === "notch") {
    // A low capsule cannot carry the full radii: the ear and the bottom
    // corner share one side and may not add up to more than its height.
    const bottomRadius = Math.min(NOTCH_BOTTOM_RADIUS, height / 2 + 2);
    return {
      width: base.width,
      height,
      top: 0,
      topRadius: 0,
      bottomRadius,
      earRadius: Math.min(NOTCH_EAR_RADIUS, height - bottomRadius),
    };
  }

  const radius = isCollapsed ? height / 2 : base.radius;
  return {
    width: base.width,
    height,
    top: useCompact ? ISLAND_TOP_OFFSET_COMPACT : ISLAND_TOP_OFFSET,
    topRadius: radius,
    bottomRadius: radius,
    earRadius: 0,
  };
}
