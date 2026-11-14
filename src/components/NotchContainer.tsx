import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FocusEvent,
  type MouseEvent,
} from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useFileDrop } from "../hooks/useFileDrop";
import { useHoverDelay } from "../hooks/useHoverDelay";
import { useMediaSession } from "../hooks/useMediaSession";
import { useSystemInfo } from "../hooks/useSystemInfo";
import {
  HOVER_ENTER_DELAY_MS,
  HOVER_LEAVE_DELAY_MS,
  MEDIA_POLL_HOVER_MS,
  MEDIA_POLL_IDLE_MS,
  NOTCH_SIZES,
  NOTCH_TOP_OFFSET,
  SHADOW_NONE,
  SHADOW_RAISED,
  SPRING_COLLAPSE,
  SPRING_EXPAND,
  SPRING_EXPANDED,
  SYSTEM_POLL_EXPANDED_MS,
  SYSTEM_POLL_IDLE_MS,
  TWEEN_REDUCED,
} from "../lib/constants";
import { useNotchStore } from "../stores/notchStore";
import { DragOverlay } from "./DragOverlay";
import { ExpandedView } from "./ExpandedView";
import { IdleView } from "./IdleView";
import { BatteryIndicator } from "./widgets/BatteryIndicator";
import { ClockDisplay } from "./widgets/ClockDisplay";
import { MediaPill } from "./widgets/MediaPill";

/** Event emitted by the Rust cursor watcher: `true` = cursor is on the capsule. */
const HOVER_EVENT = "notch-hover";

/** Width of the capsule border, in px. The content views sit inside it. */
const BORDER_WIDTH = 1;

/** Elements that handle their own clicks; clicking them must not toggle the dashboard. */
const INTERACTIVE_SELECTOR = "button, input, textarea, select, a, label";

/** Fields the user types into; while one has focus the capsule stays open. */
const TEXT_FIELD_SELECTOR = "input:not([type='range']), textarea";

/** How often expired shelf files are cleaned up, in ms. */
const SHELF_PRUNE_INTERVAL_MS = 60_000;

/** Toggles click-through on the Tauri window. `ignore = true` lets clicks pass through. */
async function setClickthrough(ignore: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("set_clickthrough", { ignore });
  } catch (error) {
    console.warn("[NotchContainer] set_clickthrough failed:", error);
  }
}

/**
 * The floating capsule and the controller of its state machine.
 *
 * States (see `NOTCH_SIZES`):
 * - `idle`      180x28  - nothing playing: clock + battery.
 * - `idleMedia` 280x28  - music playing, cursor away: adds the song title.
 * - `hover`     360x100 - cursor resting on the capsule: media player.
 * - `expanded`  420x280 - capsule clicked: dashboard.
 * - `dragOver`  340x100 - a file is being dragged over the capsule.
 *
 * The capsule only grows while the user is engaged with it - the cursor is on
 * it, a mouse button pressed on it is still held, or a text field in it has
 * focus - and shrinks back by itself afterwards, dashboard included.
 *
 * Click-through works in two layers:
 * 1. `onMouseEnter` / `onMouseLeave` call `set_clickthrough(false / true)`.
 * 2. A window that ignores cursor events never receives `mouseenter`, so the
 *    capsule's exact shape is reported to Rust (`set_hit_region`). A cursor
 *    watcher there switches click-through off only while the cursor is on the
 *    capsule and emits `notch-hover`.
 */
export function NotchContainer() {
  const reducedMotion = useReducedMotion();

  const [cursorOver, setCursorOver] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [hasTextFocus, setHasTextFocus] = useState(false);

  const state = useNotchStore((store) => store.state);
  const size = NOTCH_SIZES[state];
  const isOpen = state === "hover" || state === "expanded";

  const { isActive: isHoverOpen, enter, leave, open } = useHoverDelay({
    enterDelay: HOVER_ENTER_DELAY_MS,
    leaveDelay: HOVER_LEAVE_DELAY_MS,
  });

  const mediaPollIntervalMs = isOpen ? MEDIA_POLL_HOVER_MS : MEDIA_POLL_IDLE_MS;
  const { media, playPause, next, previous } = useMediaSession(mediaPollIntervalMs);
  useSystemInfo(state === "expanded" ? SYSTEM_POLL_EXPANDED_MS : SYSTEM_POLL_IDLE_MS);

  // A drop shows the dashboard, so the user sees the file land on the shelf.
  useFileDrop(
    useCallback(() => {
      useNotchStore.getState().setExpanded(true);
      open();
    }, [open]),
  );

  // --- Feed the store's state machine -------------------------------------

  const isEngaged = cursorOver || isPressing || hasTextFocus;
  useEffect(() => {
    if (isEngaged) enter();
    else leave();
  }, [isEngaged, enter, leave]);

  useEffect(() => {
    useNotchStore.getState().setHoverOpen(isHoverOpen);
  }, [isHoverOpen]);

  const isMediaPlaying = media?.is_playing ?? false;
  useEffect(() => {
    useNotchStore.getState().setMediaPlaying(isMediaPlaying);
  }, [isMediaPlaying]);

  // --- Cursor ---------------------------------------------------------------

  const handleMouseEnter = useCallback(() => {
    setCursorOver(true);
    void setClickthrough(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setCursorOver(false);
    void setClickthrough(true);
  }, []);

  // Follow hover changes detected by the Rust cursor watcher.
  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<boolean>(HOVER_EVENT, (event) => {
      setCursorOver(event.payload);
      // Safety net: a drag that left the capsule can no longer be over it.
      if (!event.payload) useNotchStore.getState().setDragOver(false);
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error: unknown) => {
        console.warn("[NotchContainer] could not listen for hover events:", error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Tell Rust the capsule's shape. The target shape of the current state is
  // reported, not the animated one, so the hit area never lags the spring.
  useEffect(() => {
    if (!isTauri()) return;

    const reportRegion = () => {
      const { width, height, radius } = NOTCH_SIZES[state];
      invoke("set_hit_region", {
        region: {
          x: (window.innerWidth - width) / 2,
          y: NOTCH_TOP_OFFSET,
          width,
          height,
          radius,
        },
      }).catch((error: unknown) => {
        console.warn("[NotchContainer] set_hit_region failed:", error);
      });
    };

    reportRegion();
    window.addEventListener("resize", reportRegion);
    return () => window.removeEventListener("resize", reportRegion);
  }, [state]);

  // --- Engagement: held mouse button and text focus -------------------------

  // Keeps the capsule open while a drag that started on it (the volume
  // slider, for example) overshoots its edge.
  useEffect(() => {
    if (!isPressing) return;

    const release = () => setIsPressing(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [isPressing]);

  const handleFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (event.target.matches(TEXT_FIELD_SELECTOR)) setHasTextFocus(true);
  }, []);

  const handleBlur = useCallback(() => setHasTextFocus(false), []);

  // --- Dashboard --------------------------------------------------------------

  const collapse = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    useNotchStore.getState().setExpanded(false);
  }, []);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if ((event.target as Element).closest(INTERACTIVE_SELECTOR)) return;

      const store = useNotchStore.getState();
      if (store.isExpanded) {
        collapse();
      } else {
        store.setExpanded(true);
        open(); // a click does not wait for the hover delay
      }
    },
    [collapse, open],
  );

  useEffect(() => {
    if (state !== "expanded") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") collapse();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state, collapse]);

  // Files leave the shelf by themselves after a while.
  useEffect(() => {
    const prune = () => useNotchStore.getState().pruneExpiredShelfFiles();
    const timer = window.setInterval(prune, SHELF_PRUNE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  // --- Rendering ----------------------------------------------------------------

  const variants = useMemo<Variants>(() => {
    const pick = (spring: typeof SPRING_EXPAND) => (reducedMotion ? TWEEN_REDUCED : spring);
    const shape = (key: keyof typeof NOTCH_SIZES) => ({
      width: NOTCH_SIZES[key].width,
      height: NOTCH_SIZES[key].height,
      borderRadius: NOTCH_SIZES[key].radius,
    });

    return {
      idle: { ...shape("idle"), boxShadow: SHADOW_NONE, transition: pick(SPRING_COLLAPSE) },
      idleMedia: { ...shape("idleMedia"), boxShadow: SHADOW_NONE, transition: pick(SPRING_EXPAND) },
      hover: { ...shape("hover"), boxShadow: SHADOW_RAISED, transition: pick(SPRING_EXPAND) },
      expanded: {
        ...shape("expanded"),
        boxShadow: SHADOW_RAISED,
        transition: pick(SPRING_EXPANDED),
      },
      dragOver: { ...shape("dragOver"), boxShadow: SHADOW_RAISED, transition: pick(SPRING_EXPAND) },
    };
  }, [reducedMotion]);

  const content =
    state === "expanded" ? (
      <ExpandedView
        media={media}
        mediaPollIntervalMs={mediaPollIntervalMs}
        onPlayPause={playPause}
        onNext={next}
        onPrevious={previous}
        onCollapse={collapse}
      />
    ) : state === "dragOver" ? (
      <DragOverlay />
    ) : state === "hover" ? (
      <MediaPill
        media={media}
        pollIntervalMs={mediaPollIntervalMs}
        onPlayPause={playPause}
        onNext={next}
        onPrevious={previous}
        trailing={
          <>
            <ClockDisplay showSeconds={false} />
            <BatteryIndicator />
          </>
        }
      />
    ) : (
      <IdleView media={state === "idleMedia" ? media : null} />
    );

  return (
    <motion.div
      role="group"
      aria-label="Dynamic Island"
      data-state={state}
      variants={variants}
      initial={false}
      animate={state}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onPointerDown={() => setIsPressing(true)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onClick={handleClick}
      style={{ top: NOTCH_TOP_OFFSET }}
      className={[
        "absolute left-1/2 -translate-x-1/2 overflow-hidden border bg-[#09090B]/95",
        "transition-colors duration-200",
        cursorOver ? "border-notch-border-hover" : "border-notch-border",
      ].join(" ")}
    >
      {/*
        Each view has the fixed size of its own state and is centered in the
        capsule, so its layout never reflows while the capsule is resizing.
        The outgoing view fades out as the incoming one fades in.
      */}
      <AnimatePresence initial={false}>
        <motion.div
          key={state}
          className="absolute top-0 left-1/2 -translate-x-1/2"
          style={{
            width: size.width - BORDER_WIDTH * 2,
            height: size.height - BORDER_WIDTH * 2,
          }}
          initial={{ opacity: 0, y: reducedMotion ? 0 : 4 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.18, delay: 0.08, ease: "easeOut" },
          }}
          exit={{
            opacity: 0,
            scale: reducedMotion ? 1 : 0.97,
            transition: { duration: 0.1, ease: "easeIn" },
          }}
        >
          {content}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
