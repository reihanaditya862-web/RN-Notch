import { ISLAND_TOP_OFFSET, NOTCH_BOTTOM_RADIUS, NOTCH_SIZES } from "./constants";
import type { ActiveWidgets, AppSettings, NotchState } from "./types";

/** Final geometry of the capsule, in px, relative to the window. */
export interface NotchShape {
  width: number;
  height: number;
  /** Distance from the top edge of the screen. */
  top: number;
  /** Radius of the two top corners. */
  topRadius: number;
  /** Radius of the two bottom corners. */
  bottomRadius: number;
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

/**
 * The capsule's geometry for a state and the user's settings.
 *
 * - Island: floats `ISLAND_TOP_OFFSET` below the top edge. The collapsed
 *   capsule is a full pill (radius = half its height, what `rounded-full`
 *   resolves to); larger states keep their own radius, because a full pill
 *   would cut into their content.
 * - Notch: touches the top edge, square on top so it merges with the bezel,
 *   with only the bottom corners rounded.
 */
export function getNotchShape(state: NotchState, settings: AppSettings): NotchShape {
  const base = NOTCH_SIZES[state];
  const height = state === "expanded" ? getDashboardHeight(settings.active_widgets) : base.height;

  if (settings.display_mode === "notch") {
    return {
      width: base.width,
      height,
      top: 0,
      topRadius: 0,
      bottomRadius: NOTCH_BOTTOM_RADIUS,
    };
  }

  const isCollapsed = state === "idle" || state === "idleMedia";
  const radius = isCollapsed ? height / 2 : base.radius;
  return {
    width: base.width,
    height,
    top: ISLAND_TOP_OFFSET,
    topRadius: radius,
    bottomRadius: radius,
  };
}
