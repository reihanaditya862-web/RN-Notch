import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FocusEvent,
  type MouseEvent,
} from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useBatterySaver } from "../hooks/useBatterySaver";
import { useFileDrop } from "../hooks/useFileDrop";
import { useForegroundState } from "../hooks/useForegroundState";
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
  VISIBILITY_FADE_S,
} from "../lib/constants";
import { getNotchShape, isCollapsedState, type NotchShape } from "../lib/layout";
import { buildFillPath, buildStrokePath } from "../lib/notchPath";
import { useNotchStore } from "../stores/notchStore";
import {
  CONTEXT_MENU_HEIGHT,
  CONTEXT_MENU_RADIUS,
  CONTEXT_MENU_WIDTH,
  ContextMenu,
  placeContextMenu,
} from "./ContextMenu";
import { DragOverlay } from "./DragOverlay";
import { ErrorBoundary } from "./ErrorBoundary";
import { ExpandedView } from "./ExpandedView";
import { IdleView } from "./IdleView";
import { SettingsModal } from "./SettingsModal";
import { BatteryIndicator } from "./widgets/BatteryIndicator";
import { ClockDisplay } from "./widgets/ClockDisplay";
import { MediaPill } from "./widgets/MediaPill";

/** Events emitted by the Rust cursor watcher. */
const HOVER_EVENT = "notch-hover";
const OUTSIDE_CLICK_EVENT = "notch-outside-click";

/** Width of the capsule's outline, in px. The content views sit inside it. */
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
 * The top corners as one signed number, so the two display modes can morph
 * into each other: positive = ear radius (notch), negative = ordinary rounded
 * corner radius (island). See `lib/notchPath.ts`.
 */
function topCurveOf(shape: NotchShape): number {
  return shape.earRadius > 0 ? shape.earRadius : -shape.topRadius;
}

/**
 * Tells Rust which shapes are clickable: the capsule in its target shape for
 * the current state and mode (not the animated one, so the hit area never
 * lags the spring), plus the context menu while it is open. Rust answers with
 * a `notch-hover` event.
 *
 * The ears of the notch are decoration and are not reported, so they stay
 * click-through. Passing `null` for the shape makes nothing clickable.
 */
function reportHitRegions(
  shape: NotchShape | null,
  menu: MenuPosition | null,
  watchOutsideClicks: boolean,
): void {
  if (!isTauri()) return;

  const regions = [];
  if (shape) {
    regions.push({
      x: (window.innerWidth - shape.width) / 2,
      y: shape.top,
      width: shape.width,
      height: shape.height,
      topRadius: shape.topRadius,
      bottomRadius: shape.bottomRadius,
    });
  }
  if (shape && menu) {
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
 * - `idle`      - nothing playing: clock + battery.
 * - `idleMedia` - music playing, cursor away: adds waveform and song title.
 * - `hover`     - cursor resting on the capsule: media player.
 * - `expanded`  - capsule clicked: dashboard of the active widgets.
 * - `settings`  - settings panel.
 * - `dragOver`  - a file is being dragged over the capsule.
 *
 * Shape (see `getNotchShape`): "island" floats below the top edge as a pill;
 * "notch" touches the edge and flares into it with two ears. While a
 * maximized app is in front, the collapsed capsule turns compact (lower, and
 * closer to the edge) to stay out of the app's tab strip. While a fullscreen
 * app is in front, the capsule fades out and stops polling.
 *
 * The outline is one SVG path (fill, hairline border, gradient line), because
 * ears cannot be drawn with `border-radius`. Width, height, position and
 * corner curves are motion values; the path is recomputed from them on every
 * frame, so shape changes and mode switches share one spring.
 *
 * The capsule only grows while the user is engaged with it - the cursor is on
 * it, a mouse button pressed on it is still held, or a text field in it has
 * focus - and shrinks back by itself afterwards, dashboard included. The
 * settings panel is the exception: it stays until it is closed.
 *
 * Click-through and hover have a single authority: the cursor watcher in
 * Rust. The exact clickable shapes are reported to it (`set_hit_regions`);
 * it makes the window clickable only while the cursor is on one of them and
 * emits `notch-hover`. Everything else always stays click-through.
 */
export function NotchContainer() {
  const reducedMotion = useReducedMotion();
  const gradientId = useId();

  const [cursorOver, setCursorOver] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [hasTextFocus, setHasTextFocus] = useState(false);
  const [menu, setMenu] = useState<MenuPosition | null>(null);

  const state = useNotchStore((store) => store.state);
  const settings = useNotchStore((store) => store.settings);
  const isUserVisible = useNotchStore((store) => store.isVisible);
  const isSettingsOpen = useNotchStore((store) => store.isSettingsOpen);
  const isFullscreenApp = useNotchStore((store) => store.foreground.is_fullscreen);
  const isMaximizedApp = useNotchStore((store) => store.foreground.is_maximized);

  const widgets = settings.active_widgets;
  const isOpen = state === "hover" || state === "expanded";
  const isRaised = !isCollapsedState(state);
  /** Off screen: hidden from the tray, or stepping aside for a fullscreen app. */
  const isHidden = !isUserVisible || isFullscreenApp;
  /** The collapsed capsule is in its low shape because a maximized app is in front. */
  const isCompact = isMaximizedApp && !isRaised;

  const shape = useMemo(
    () => getNotchShape(state, settings, isMaximizedApp),
    [state, settings, isMaximizedApp],
  );

  const { isActive: isHoverOpen, enter, leave, open } = useHoverDelay({
    enterDelay: HOVER_ENTER_DELAY_MS,
    leaveDelay: HOVER_LEAVE_DELAY_MS,
  });

  useSettingsSync();
  useForegroundState();
  const { isBatterySaver, scalePoll } = useBatterySaver();

  // Nothing is polled while the capsule is off screen, and no media while its
  // widget is off. Battery saver stretches whatever interval remains.
  const mediaPollIntervalMs =
    scalePoll(isOpen ? MEDIA_POLL_HOVER_MS : MEDIA_POLL_IDLE_MS) ?? MEDIA_POLL_IDLE_MS;
  const { media, playPause, next, previous } = useMediaSession(
    !isHidden && widgets.media ? mediaPollIntervalMs : null,
  );
  useSystemInfo(
    isHidden
      ? null
      : scalePoll(state === "expanded" ? SYSTEM_POLL_EXPANDED_MS : SYSTEM_POLL_IDLE_MS),
  );

  // A drop shows the dashboard, so the user sees the file land on the shelf.
  useFileDrop(
    useCallback(() => {
      useNotchStore.getState().setExpanded(true);
      open();
    }, [open]),
  );

  // --- Feed the store's state machine -------------------------------------

  const isEngaged = !isHidden && (cursorOver || isPressing || hasTextFocus);
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

  // Going off screen closes whatever was open, so the capsule comes back idle.
  useEffect(() => {
    if (!isHidden) return;
    setMenu(null);
    setCursorOver(false);
    const store = useNotchStore.getState();
    store.closeSettings();
    store.setExpanded(false);
    store.setDragOver(false);
  }, [isHidden]);

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
          reportHitRegions(
            getNotchShape(store.state, store.settings, store.foreground.is_maximized),
            null,
            store.isSettingsOpen,
          );
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

  // Keep Rust's copy of the clickable shapes current. Nothing is clickable
  // while the capsule is off screen.
  const watchOutsideClicks = !isHidden && (menu !== null || isSettingsOpen);
  useEffect(() => {
    const report = () => reportHitRegions(isHidden ? null : shape, menu, watchOutsideClicks);

    report();
    window.addEventListener("resize", report);
    return () => window.removeEventListener("resize", report);
  }, [shape, menu, watchOutsideClicks, isHidden]);

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

  // --- Geometry: motion values and the outline computed from them ---------------

  const width = useMotionValue(shape.width);
  const height = useMotionValue(shape.height);
  const top = useMotionValue(shape.top);
  const topCurve = useMotionValue(topCurveOf(shape));
  const bottomRadius = useMotionValue(shape.bottomRadius);

  // Battery saver and reduced motion both trade the springs for a short tween.
  const spring =
    state === "idle"
      ? SPRING_COLLAPSE
      : state === "expanded" || state === "settings"
        ? SPRING_EXPANDED
        : SPRING_EXPAND;
  const transition = reducedMotion || isBatterySaver ? TWEEN_REDUCED : spring;

  const targetCurve = topCurveOf(shape);
  useEffect(() => {
    const controls = [
      animate(width, shape.width, transition),
      animate(height, shape.height, transition),
      animate(top, shape.top, transition),
      animate(topCurve, targetCurve, transition),
      animate(bottomRadius, shape.bottomRadius, transition),
    ];
    return () => controls.forEach((control) => control.stop());
  }, [
    width,
    height,
    top,
    topCurve,
    bottomRadius,
    shape.width,
    shape.height,
    shape.top,
    shape.bottomRadius,
    targetCurve,
    transition,
  ]);

  const outline = [width, height, topCurve, bottomRadius];
  const fillPath = useTransform(outline, ([w, h, curve, bottom]: number[]) =>
    buildFillPath(w, h, curve, bottom),
  );
  const strokePath = useTransform(outline, ([w, h, curve, bottom]: number[]) =>
    buildStrokePath(w, h, curve, bottom),
  );
  // The content is clipped by an ordinary box that follows the same corners.
  // Ears lie outside the capsule, so for clipping they count as square.
  const clipTopRadius = useTransform(topCurve, (curve) => Math.max(0, -curve));

  // --- Rendering ----------------------------------------------------------------

  /** The gradient line shows while the capsule is doing or about to do something. */
  const isActive = cursorOver || isRaised || (isMediaPlaying && !settings.dnd_enabled);

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
        isCompact={isCompact}
      />
    );

  return (
    <>
      <motion.div
        role="group"
        aria-label={APP_NAME}
        aria-hidden={isHidden}
        data-state={state}
        data-mode={settings.display_mode}
        data-compact={isCompact}
        initial={false}
        animate={{ opacity: isHidden ? 0 : 1 }}
        transition={{ duration: VISIBILITY_FADE_S, ease: "easeOut" }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onPointerDown={() => setIsPressing(true)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        style={{ width, height, top }}
        className={[
          "absolute left-1/2 -translate-x-1/2",
          isHidden ? "pointer-events-none" : "",
        ].join(" ")}
      >
        {/*
          The capsule's outline. The SVG box itself is 1x1 and lets its
          content overflow, so the path can use the capsule's own coordinates
          (ears reach to negative x). It never takes pointer events.
        */}
        <svg
          width="1"
          height="1"
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 overflow-visible"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--notch-gradient-from)" />
              <stop offset="1" stopColor="var(--notch-gradient-to)" />
            </linearGradient>
          </defs>

          <motion.path
            d={fillPath}
            fill={`rgb(9 9 11 / ${settings.opacity})`}
            style={{ transition: "fill 200ms ease" }}
          />
          {/* Soft glow behind the gradient line; removed under battery saver. */}
          <motion.path
            d={strokePath}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="3"
            opacity={isActive ? 0.5 : 0}
            className="notch-outline notch-outline-glow"
          />
          <motion.path
            d={strokePath}
            fill="none"
            stroke={cursorOver ? "var(--notch-border-hover)" : "var(--notch-border)"}
            strokeWidth={BORDER_WIDTH}
            className="notch-outline"
          />
          <motion.path
            d={strokePath}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={BORDER_WIDTH}
            opacity={isActive ? 0.9 : 0}
            className="notch-outline"
          />
        </svg>

        {/* Clips the content to the capsule and carries the drop shadow. */}
        <motion.div
          style={{
            borderTopLeftRadius: clipTopRadius,
            borderTopRightRadius: clipTopRadius,
            borderBottomLeftRadius: bottomRadius,
            borderBottomRightRadius: bottomRadius,
            boxShadow: isRaised && !isBatterySaver ? SHADOW_RAISED : SHADOW_NONE,
          }}
          className="absolute inset-0 overflow-hidden transition-shadow duration-200"
        >
          {/*
            Each view has the fixed size of its own state and is centered in
            the capsule, so its layout never reflows while the capsule is
            resizing. The outgoing view fades out as the incoming one fades in.
          */}
          <AnimatePresence initial={false}>
            <motion.div
              key={state}
              className="absolute left-1/2 -translate-x-1/2"
              style={{
                top: BORDER_WIDTH,
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
              {/* A view that fails is replaced by a note; changing state retries it. */}
              <ErrorBoundary label={APP_NAME} resetKey={state}>
                {content}
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {menu && !isHidden && (
          <ErrorBoundary key="context-menu" label="Menu" fallback={null}>
            <ContextMenu
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
          </ErrorBoundary>
        )}
      </AnimatePresence>
    </>
  );
}
