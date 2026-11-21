import { useRef, type ReactNode, type WheelEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { DASHBOARD } from "../lib/layout";
import { currentPage, dashboardPages, type DashboardPageId } from "../lib/pages";
import { useNotchStore } from "../stores/notchStore";
import { ErrorBoundary } from "./ErrorBoundary";
import { CalendarPage } from "./pages/CalendarPage";
import { F1Page } from "./pages/F1Page";
import { LyricsPage } from "./pages/LyricsPage";
import { MediaPage, type MediaControls } from "./pages/MediaPage";
import { ShelfPage } from "./pages/ShelfPage";
import { ToolsPage } from "./pages/ToolsPage";

/** Wheel travel (px) that turns the page, and the pause before the next turn. */
const WHEEL_STEP = 40;
const WHEEL_COOLDOWN_MS = 380;

/**
 * True when the wheel should scroll a list under the cursor instead of
 * turning the page: the list (marked `data-scroll`) can still move that way.
 */
function listCanScroll(target: EventTarget, root: Element, deltaY: number): boolean {
  let element = target instanceof HTMLElement ? target : null;
  while (element && element !== root) {
    if (element.dataset.scroll !== undefined) {
      const canDown = element.scrollTop + element.clientHeight < element.scrollHeight - 1;
      const canUp = element.scrollTop > 0;
      if ((deltaY > 0 && canDown) || (deltaY < 0 && canUp)) return true;
    }
    element = element.parentElement;
  }
  return false;
}

/**
 * The dashboard shown after clicking the capsule. Its pages - media, lyrics,
 * today's schedule, clipboard and shelf, tools, F1 - share one size; the mouse wheel
 * over the capsule or the dots at the bottom move between them, so the
 * capsule needs no row of tabs.
 */
export function Dashboard({
  controls,
  onCollapse,
}: {
  controls: MediaControls;
  onCollapse: () => void;
}) {
  const settings = useNotchStore((store) => store.settings);
  const chosen = useNotchStore((store) => store.dashboardPage);
  const setDashboardPage = useNotchStore((store) => store.setDashboardPage);
  const reducedMotion = useReducedMotion();

  const pages = dashboardPages(settings);
  const page = currentPage(pages, chosen);
  const index = pages.indexOf(page);

  // Slide direction: from the right when moving forward.
  const previousIndex = useRef(index);
  const direction = index >= previousIndex.current ? 1 : -1;
  previousIndex.current = index;

  const wheel = useRef({ travel: 0, last: 0 });
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (delta === 0 || listCanScroll(event.target, event.currentTarget, event.deltaY)) return;
    const now = Date.now();
    if (now - wheel.current.last < WHEEL_COOLDOWN_MS) return;
    wheel.current.travel += delta;
    if (Math.abs(wheel.current.travel) < WHEEL_STEP) return;

    const next = Math.min(pages.length - 1, Math.max(0, index + Math.sign(wheel.current.travel)));
    wheel.current = { travel: 0, last: now };
    if (next !== index) setDashboardPage(pages[next].id);
  };

  const content: Record<DashboardPageId, () => ReactNode> = {
    media: () => (
      <MediaPage widgets={settings.active_widgets} controls={controls} onCollapse={onCollapse} />
    ),
    lyrics: () => <LyricsPage controls={controls} onCollapse={onCollapse} />,
    calendar: () => <CalendarPage onCollapse={onCollapse} />,
    shelf: () => <ShelfPage onCollapse={onCollapse} />,
    tools: () => <ToolsPage onCollapse={onCollapse} />,
    f1: () => <F1Page onCollapse={onCollapse} />,
  };

  return (
    <div
      onWheel={handleWheel}
      className="flex h-full w-full flex-col"
      style={{ padding: DASHBOARD.padding, paddingBottom: DASHBOARD.padding - 4, gap: 6 }}
    >
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            key={page.id}
            custom={direction}
            className="absolute inset-0"
            initial={{ opacity: 0, x: reducedMotion ? 0 : direction * 28 }}
            animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: "easeOut" } }}
            exit={{ opacity: 0, x: reducedMotion ? 0 : direction * -28, transition: { duration: 0.14, ease: "easeIn" } }}
          >
            <ErrorBoundary label={page.label} resetKey={page.id}>
              {content[page.id]()}
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </div>

      {pages.length > 1 && (
        <nav
          aria-label="Dashboard pages"
          className="flex shrink-0 items-center justify-center gap-1.5"
          style={{ height: DASHBOARD.dots }}
        >
          {pages.map((candidate) => {
            const isCurrent = candidate.id === page.id;
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => setDashboardPage(candidate.id)}
                aria-label={candidate.label}
                aria-current={isCurrent ? "page" : undefined}
                title={`${candidate.label} (scroll to switch)`}
                className={[
                  "h-[5px] rounded-full transition-[width,background-color] duration-200",
                  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-notch-focus",
                  isCurrent ? "w-4 bg-notch-primary" : "w-[5px] bg-white/25 hover:bg-white/50",
                ].join(" ")}
              />
            );
          })}
        </nav>
      )}
    </div>
  );
}
