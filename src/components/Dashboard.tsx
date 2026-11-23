import { useRef, type PointerEvent, type ReactNode, type WheelEvent } from "react";
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

/**
 * Travel (px) that turns the page - wheel, two-finger swipe or a drag across
 * the panel - and the pause before the next turn, so one gesture never turns
 * two pages.
 */
const WHEEL_STEP = 45;
const WHEEL_COOLDOWN_MS = 280;

/** A drag starting on any of these is the control's own, never a page swipe. */
const SWIPE_IGNORE =
  "button, a, input, textarea, select, label, [role=slider], [role=spinbutton], [role=radio], [role=switch], [draggable=true]";

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
  /** Turns one page forward (1) or back (-1), once per cooldown. */
  const turn = (step: number) => {
    const now = Date.now();
    if (now - wheel.current.last < WHEEL_COOLDOWN_MS) return;
    wheel.current = { travel: 0, last: now };
    const next = Math.min(pages.length - 1, Math.max(0, index + step));
    if (next !== index) setDashboardPage(pages[next].id);
  };

  // The wheel, a two-finger swipe on a precision touchpad (horizontal travel
  // wins when it is the larger) and Shift + wheel all turn pages.
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const isSideways = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const delta = isSideways ? event.deltaX || event.deltaY : event.deltaY;
    if (delta === 0 || (!isSideways && listCanScroll(event.target, event.currentTarget, event.deltaY))) return;
    if (Date.now() - wheel.current.last < WHEEL_COOLDOWN_MS) return;
    wheel.current.travel += delta;
    if (Math.abs(wheel.current.travel) >= WHEEL_STEP) turn(Math.sign(wheel.current.travel));
  };

  // A drag across an empty part of the panel swipes pages like a touchpad.
  const swipe = useRef<{ id: number; x: number; y: number; done: boolean } | null>(null);
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest(SWIPE_IGNORE)) return;
    swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY, done: false };
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = swipe.current;
    if (!gesture || gesture.done || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.abs(dx) < WHEEL_STEP || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    gesture.done = true;
    // Dragging leftward brings in the next page, as on a touchpad.
    turn(dx < 0 ? 1 : -1);
  };
  const endSwipe = () => {
    swipe.current = null;
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
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endSwipe}
      onPointerCancel={endSwipe}
      className="flex h-full w-full flex-col"
      style={{ padding: DASHBOARD.padding, paddingBottom: DASHBOARD.padding - 4, gap: 6 }}
    >
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            key={page.id}
            custom={direction}
            className="absolute inset-0"
            initial={{ opacity: 0, x: reducedMotion ? 0 : direction * 36 }}
            animate={{
              opacity: 1,
              x: 0,
              // The page arrives from the side it was swiped from, on a spring.
              transition: {
                x: reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36, mass: 0.8 },
                opacity: { duration: 0.18, ease: "easeOut" },
              },
            }}
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
