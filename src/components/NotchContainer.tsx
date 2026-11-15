import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FocusEvent,
  type MouseEvent,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useFileDrop } from "../hooks/useFileDrop";
import { useHoverDelay } from "../hooks/useHoverDelay";
import { useMediaSession } from "../hooks/useMediaSession";
import { saveSettingsNow, useSettingsSync } from "../hooks/useSettingsSync";
import { useSystemInfo } from "../hooks/useSystemInfo";
import {
  APP_NAME,
  HOVER_ENTER_DELAY_MS,
  HOVER_LEAVE_DELAY_MS,
  MEDIA_POLL_HOVER_MS,
  MEDIA_POLL_IDLE_MS,
  SHADOW_NONE,
  SHADOW_RAISED,
  SPRING_COLLAPSE,
  SPRING_EXPAND,
  SPRING_EXPANDED,
  SYSTEM_POLL_EXPANDED_MS,
  SYSTEM_POLL_IDLE_MS,
  TWEEN_REDUCED,
} from "../lib/constants";
import { getNotchShape, type NotchShape } from "../lib/layout";
import { useNotchStore } from "../stores/notchStore";
import {
  CONTEXT_MENU_HEIGHT,
  CONTEXT_MENU_RADIUS,
  CONTEXT_MENU_WIDTH,
  ContextMenu,
  placeContextMenu,
} from "./ContextMenu";
import { DragOverlay } from "./DragOverlay";
import { ExpandedView } from "./ExpandedView";
import { IdleView } from "./IdleView";
import { SettingsModal } from "./SettingsModal";
import { BatteryIndicator } from "./widgets/BatteryIndicator";
import { ClockDisplay } from "./widgets/ClockDisplay";
import { MediaPill } from "./widgets/MediaPill";

/** Events emitted by the Rust cursor watcher. */
const HOVER_EVENT = "notch-hover";
const OUTSIDE_CLICK_EVENT = "notch-outside-click";

/** Width of the capsule border, in px. The content views sit inside it. */
const BORDER_WIDTH = 1;

/** Elements that handle their own clicks; clicking them must not open the dashboard. */
const INTERACTIVE_SELECTOR = "button, input, textarea, select, a, label";

/** Fields the user types into; while one has focus the capsule stays open. */
const TEXT_FIELD_SELECTOR = "input:not([type='range']), textarea";

/** How often expired shelf files are cleaned up, in ms. */
const SHELF_PRUNE_INTERVAL_MS = 60_000;

/** Top-left corner of the open context menu, inside the window. */
interface MenuPosition {
  x: number;
  y: number;
}

/**
 * Tells Rust which shapes are clickable: the capsule in its target shape for
 * the current state and mode (not the animated one, so the hit area never
 * lags the spring), plus the context menu while it is open. Rust answers with
 * a `notch-hover` event.
 */
function reportHitRegions(
  shape: NotchShape,
  menu: MenuPosition | null,
  watchOutsideClicks: boolean,
): void {
  if (!isTauri()) return;

  const regions = [
    {
      x: (window.innerWidth - shape.width) / 2,
      y: shape.top,
      width: shape.width,
      height: shape.height,
      topRadius: shape.topRadius,
      bottomRadius: shape.bottomRadius,
    },
  ];
  if (menu) {
    regions.push({
      x: menu.x,
      y: menu.y,
      width: CONTEXT_MENU_WIDTH,
      height: CONTEXT_MENU_HEIGHT,
      topRadius: CONTEXT_MENU_RADIUS,
      bottomRadius: CONTEXT_MENU_RADIUS,
    });
  }

  invoke("set_hit_regions", { regions, watchOutsideClicks }).catch((error: unknown) => {
    console.warn("[NotchContainer] set_hit_regions failed:", error);
  });
}

/**
 * The floating capsule and the controller of its state machine.
 *
 * States (see `NOTCH_SIZES`):
 * - `idle`      180x28  - nothing playing: clock + battery.
 * - `idleMedia` 280x28  - music playing, cursor away: adds the song title.
 * - `hover`     360x100 - cursor resting on the capsule: media player.
 * - `expanded`  420 wide - capsule clicked: dashboard of the active widgets.
 * - `settings`  420x276 - settings panel.
 * - `dragOver`  340x100 - a file is being dragged over the capsule.
 *
 * Display modes (see `getNotchShape`): "island" floats 8px below the top edge
 * as a pill; "notch" touches the edge, flat on top, rounded below. Switching
 * animates position and corner radii with the same spring as a state change.
 *
 * The capsule only grows while the user is engaged with it - the cursor is on
 * it, a mouse button pressed on it is still held, or a text field in it has
 * focus - and shrinks back by itself afterwards, dashboard included. The
 * settings panel is the exception: it stays until it is closed.
 *
 * Click-through and hover have a single authority: the cursor watcher in
 * Rust. A window that ignores cursor events never receives `mouseenter`, so
 * the webview cannot decide this by itself. Instead the exact shapes are
 * reported to Rust (`set_hit_regions`); the watcher makes the window
 * clickable only while the cursor is on one of them and emits `notch-hover`.
 * Everything else always stays click-through.
 */
export function NotchContainer() {
  const reducedMotion = useReducedMotion();

  const [cursorOver, setCursorOver] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [hasTextFocus, setHasTextFocus] = useState(false);
  const [menu, setMenu] = useState<MenuPosition | null>(null);

  const state = useNotchStore((store) => store.state);
  const settings = useNotchStore((store) => store.settings);
  const isVisible = useNotchStore((store) => store.isVisible);
  const isSettingsOpen = useNotchStore((store) => store.isSettingsOpen);

  const widgets = settings.active_widgets;
  const isNotchMode = settings.display_mode === "notch";
  const shape = useMemo(() => getNotchShape(state, settings), [state, settings]);
  const isOpen = state === "hover" || state === "expanded";

  const { isActive: isHoverOpen, enter, leave, open } = useHoverDelay({
    enterDelay: HOVER_ENTER_DELAY_MS,
    leaveDelay: HOVER_LEAVE_DELAY_MS,
  });

  useSettingsSync();

  // Nothing is polled while the capsule is hidden, and no media while its widget is off.
  const mediaPollIntervalMs = isOpen ? MEDIA_POLL_HOVER_MS : MEDIA_POLL_IDLE_MS;
  const { media, playPause, next, previous } = useMediaSession(
    isVisible && widgets.media ? mediaPollIntervalMs : null,
  );
  useSystemInfo(
    !isVisible ? null : state === "expanded" ? SYSTEM_POLL_EXPANDED_MS : SYSTEM_POLL_IDLE_MS,
  );

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
    // The menu belongs to a hover session; it goes when the cursor has left.
    if (!isHoverOpen) setMenu(null);
  }, [isHoverOpen]);

  const isMediaPlaying = media?.is_playing ?? false;
  useEffect(() => {
    useNotchStore.getState().setMediaPlaying(isMediaPlaying);
  }, [isMediaPlaying]);

  // --- Cursor ---------------------------------------------------------------

  // DOM hover is only used where there is no Rust watcher (a plain browser).
  // Inside Tauri it would be a second, slightly different opinion.
  const handleMouseEnter = useCallback(() => {
    if (!isTauri()) setCursorOver(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!isTauri()) setCursorOver(false);
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  // Follow the Rust cursor watcher.
  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    const cleanups: Array<() => void> = [];
    const keep = (stop: () => void) => {
      if (disposed) stop();
      else cleanups.push(stop);
    };
    const warn = (error: unknown) => {
      console.warn("[NotchContainer] could not listen for cursor events:", error);
    };

    listen<boolean>(HOVER_EVENT, (event) => {
      setCursorOver(event.payload);
      // Safety net: a drag that left the capsule can no longer be over it.
      if (!event.payload) useNotchStore.getState().setDragOver(false);
    })
      .then((stop) => {
        keep(stop);
        // Now that we are listening, ask for the current hover state: the
        // cursor may already have been on the capsule before this point.
        if (!disposed) {
          const store = useNotchStore.getState();
          reportHitRegions(getNotchShape(store.state, store.settings), null, store.isSettingsOpen);
        }
      })
      .catch(warn);

    // A click that lands outside the capsule and the menu goes to another
    // app; Rust tells us, so the menu and the settings panel can close.
    listen(OUTSIDE_CLICK_EVENT, () => {
      setMenu(null);
      useNotchStore.getState().closeSettings();
    })
      .then(keep)
      .catch(warn);

    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  // Keep Rust's copy of the clickable shapes current.
  const watchOutsideClicks = menu !== null || isSettingsOpen;
  useEffect(() => {
    const report = () => reportHitRegions(shape, menu, watchOutsideClicks);

    report();
    window.addEventListener("resize", report);
    return () => window.removeEventListener("resize", report);
  }, [shape, menu, watchOutsideClicks]);

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

  // --- Dashboard, settings, context menu --------------------------------------

  const collapse = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    useNotchStore.getState().setExpanded(false);
  }, []);

  const closeSettings = useCallback(() => useNotchStore.getState().closeSettings(), []);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if ((event.target as Element).closest(INTERACTIVE_SELECTOR)) return;

      // Opening only. Inside the dashboard a click on the background does
      // nothing, so a near miss on the slider or a file never closes it; it
      // closes with the chevron, Esc, or simply by moving the cursor away.
      const store = useNotchStore.getState();
      if (!store.isExpanded && !store.isSettingsOpen) {
        store.setExpanded(true);
        open(); // a click does not wait for the hover delay
      }
    },
    [open],
  );

  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    // Text fields keep the system menu: that is where Paste lives.
    if ((event.target as Element).closest(TEXT_FIELD_SELECTOR)) return;

    event.preventDefault();
    setMenu(placeContextMenu(event.clientX, event.clientY, window.innerWidth, window.innerHeight));
  }, []);

  const handleQuit = useCallback(() => {
    // Write a setting changed a moment ago before the process goes away.
    void saveSettingsNow().finally(() => {
      if (!isTauri()) return;
      invoke("quit_app").catch((error: unknown) => {
        console.warn("[NotchContainer] quit_app failed:", error);
      });
    });
  }, []);

  // Esc closes the settings panel or the dashboard. (The context menu handles
  // its own Esc and stops it from reaching this listener.)
  useEffect(() => {
    if (state !== "expanded" && state !== "settings") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (useNotchStore.getState().isSettingsOpen) closeSettings();
      else collapse();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state, collapse, closeSettings]);

  // Files leave the shelf by themselves after a while.
  useEffect(() => {
    const prune = () => useNotchStore.getState().pruneExpiredShelfFiles();
    const timer = window.setInterval(prune, SHELF_PRUNE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  // --- Rendering ----------------------------------------------------------------

  const spring =
    state === "idle"
      ? SPRING_COLLAPSE
      : state === "expanded" || state === "settings"
        ? SPRING_EXPANDED
        : SPRING_EXPAND;
  const isRaised = state !== "idle" && state !== "idleMedia";

  const nowPlaying = media ? (media.artist ? `${media.artist} - ${media.title}` : media.title) : null;

  const content =
    state === "settings" ? (
      <SettingsModal onClose={closeSettings} />
    ) : state === "expanded" ? (
      <ExpandedView
        widgets={widgets}
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
      <IdleView
        media={state === "idleMedia" ? media : null}
        isDndEnabled={settings.dnd_enabled}
      />
    );

  return (
    <>
      <motion.div
        role="group"
        aria-label={APP_NAME}
        data-state={state}
        data-mode={settings.display_mode}
        initial={false}
        animate={{
          width: shape.width,
          height: shape.height,
          top: shape.top,
          borderTopLeftRadius: shape.topRadius,
          borderTopRightRadius: shape.topRadius,
          borderBottomLeftRadius: shape.bottomRadius,
          borderBottomRightRadius: shape.bottomRadius,
          boxShadow: isRaised ? SHADOW_RAISED : SHADOW_NONE,
        }}
        transition={reducedMotion ? TWEEN_REDUCED : spring}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onPointerDown={() => setIsPressing(true)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        style={{ backgroundColor: `rgb(9 9 11 / ${settings.opacity})` }}
        className={[
          "absolute left-1/2 -translate-x-1/2 overflow-hidden border",
          "transition-[border-color,background-color] duration-200",
          cursorOver ? "border-notch-border-hover" : "border-notch-border",
          // Flush with the screen edge: no line where the capsule meets the bezel.
          isNotchMode ? "border-t-transparent" : "",
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
              width: shape.width - BORDER_WIDTH * 2,
              height: shape.height - BORDER_WIDTH * 2,
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

      <AnimatePresence>
        {menu && (
          <ContextMenu
            key="context-menu"
            x={menu.x}
            y={menu.y}
            displayMode={settings.display_mode}
            isDndEnabled={settings.dnd_enabled}
            nowPlaying={nowPlaying}
            onSwitchMode={useNotchStore.getState().toggleDisplayMode}
            onToggleDnd={useNotchStore.getState().toggleDnd}
            onOpenSettings={useNotchStore.getState().openSettings}
            onQuit={handleQuit}
            onClose={closeMenu}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />
        )}
      </AnimatePresence>
    </>
  );
}
