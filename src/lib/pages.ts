import { NOTCH_SIZES } from "./constants";
import type { AppSettings } from "./types";

export type DashboardPageId = "media" | "lyrics" | "calendar" | "shelf" | "tools" | "f1";

export interface DashboardPage {
  id: DashboardPageId;
  label: string;
}

/**
 * The dashboard's pages, in order, for the modules that are switched on. The
 * mouse wheel over the capsule, or the dots at its bottom, move between them.
 */
export function dashboardPages(settings: AppSettings): DashboardPage[] {
  const { active_widgets: widgets, features } = settings;
  const pages: DashboardPage[] = [];
  if (widgets.media || widgets.system) pages.push({ id: "media", label: "Media" });
  if (widgets.media && features.lyrics) pages.push({ id: "lyrics", label: "Lyrics" });
  pages.push({ id: "calendar", label: "Today" });
  if (features.clipboard_history || widgets.file_shelf || widgets.scratchpad) {
    pages.push({ id: "shelf", label: "Clipboard & shelf" });
  }
  pages.push({ id: "tools", label: "Tools" });
  if (features.f1_hub) pages.push({ id: "f1", label: "F1 Race Hub" });
  return pages;
}

/** The page to show: the chosen one if it still exists, else the first. */
export function currentPage(pages: DashboardPage[], chosen: string): DashboardPage {
  return pages.find((page) => page.id === chosen) ?? pages[0];
}

/**
 * Height of the dashboard for a page. The media page is shorter, so the
 * capsule does not carry empty space below the system monitor; the others
 * use the full size. Changing pages animates between the two.
 */
export function dashboardHeight(page: DashboardPageId, settings: AppSettings): number {
  if (page !== "media") return NOTCH_SIZES.expanded.height;
  const { media, system } = settings.active_widgets;
  // Border, padding, the page dots and the rows of the page (see MediaPage).
  const chrome = 2 + 12 + 8 + 6 + 10;
  const mediaRows = media ? 72 + 6 + 30 : 20;
  const systemRows = system ? 6 + 1 + 6 + 74 : 0;
  return chrome + mediaRows + systemRows + 2;
}
