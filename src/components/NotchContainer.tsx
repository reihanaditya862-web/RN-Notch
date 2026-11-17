import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
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
  type MotionValue,
  type Transition,
} from "framer-motion";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAlbumAccent } from "../hooks/useAlbumAccent";
import { useBatterySaver } from "../hooks/useBatterySaver";
import { useFileDrop } from "../hooks/useFileDrop";
import { useForegroundState } from "../hooks/useForegroundState";
import { useHoverDelay } from "../hooks/useHoverDelay";
import { useMediaSession } from "../hooks/useMediaSession";
import { saveSettingsNow, useSettingsSync } from "../hooks/useSettingsSync";
import { useSystemInfo } from "../hooks/useSystemInfo";
import {
  APP_NAME,
  ENTRANCE_OFFSET_Y,
  ENTRANCE_SCALE_KEYFRAMES,
  HOVER_ENTER_DELAY_LIP_MS,
  HOVER_ENTER_DELAY_MS,
  HOVER_LEAVE_DELAY_MS,
  MEDIA_POLL_HOVER_MS,
  MEDIA_POLL_IDLE_MS,
  NEON_IDLE_COLOR,
  NOTCH_SIZES,
  SHADOW_NONE,
  SHADOW_RAISED,
  SPRING_COLLAPSE,
  SPRING_ENTRANCE,
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
 * Animates a motion value to a target - unless it already rests there.
 *
 * All five geometry values are re-targeted together whenever the shape
 * changes. Starting a spring on a value whose target did not change still
 * nudges it by a fraction of a pixel; skipping those keeps, for example, the
 * width perfectly still while only the height retracts.
 */
function animateTo(value: MotionValue<number>, target: number, transition: Transition) {
  if (!value.isAnimating() && value.get() === target) return null;
  return animate(value, target, transition);
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
 *
 * Shapes are given in the capsule's own (unscaled) units; `scale` converts
 * them to the window pixels Rust works in.
 *
 * - `isPassive`: the capsule reports hover but lets clicks through to the app
 *   underneath. Used for the retracted lip, so the browser tab below it stays
 *   clickable and hovering never takes focus.
 * - `bridgeWidth`: adds a strip from the top of the screen down to the
 *   capsule, as wide as the lip. In island mode the open pop-up floats a few
 *   pixels below the edge where the lip was; the strip joins the two into one
 *   hover area, so the cursor that opened the pop-up from the lip is still
 *   "on it".
 */
function reportHitRegions(
  shape: NotchShape | null,
  menu: MenuPosition | null,
  options: {
    scale: number;
    isPassive: boolean;
    bridgeWidth: number | null;
    watchOutsideClicks: boolean;
  },
): void {
  if (!isTauri()) return;

  const { scale, isPassive, bridgeWidth, watchOutsideClicks } = options;
  const regions = [];
  if (shape) {
    regions.push({
      x: (window.innerWidth - shape.width * scale) / 2,
      y: shape.top * scale,
      width: shape.width * scale,
      height: shape.height * scale,
      topRadius: shape.topRadius * scale,
      bottomRadius: shape.bottomRadius * scale,
      passive: isPassive,
    });
  }
  if (shape && bridgeWidth !== null && shape.top > 0) {
    regions.push({
      x: (window.innerWidth - bridgeWidth * scale) / 2,
      y: 0,
      width: bridgeWidth * scale,
      // Reaches past the capsule's rounded top corners, so there is no gap.
      height: (shape.top + shape.topRadius) * scale,
      topRadius: 0,
      bottomRadius: 0,
      passive: false,
    });
  }
  if (shape && menu) {
    regions.push({
      x: menu.x * scale,
      y: menu.y * scale,
      width: CONTEXT_MENU_WIDTH * scale,
      height: CONTEXT_MENU_HEIGHT * scale,
      topRadius: CONTEXT_MENU_RADIUS * scale,
      bottomRadius: CONTEXT_MENU_RADIUS * scale,
      passive: false,
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
 * "notch" touches the edge and flares into it with two ears.
 *
 * Window awareness (from the Rust window detector):
 * - An app window under the capsule (a maximized browser): the collapsed
 *   capsule retracts into the top edge. Its width and horizontal position
 *   stay put, its bottom edge rises until only a ~5px lip is left. The lip
 *   lets clicks through to the tabs below it. Resting the cursor on it drops
 *   the capsule back down as a pop-up, without a click and without taking
 *   focus; lip and pop-up are one connected hover area.
 * - A fullscreen app: the capsule and its hover trigger disappear entirely
 *   and polling stops. When that app goes away the capsule returns in
 *   whatever shape the window then in front calls for.
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
  const glowStartId = useId();
  const glowEndId = useId();

  const [cursorOver, setCursorOver] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [hasTextFocus, setHasTextFocus] = useState(false);
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  /** The Rust hover listener is registered; hit regions are re-sent then. */
  const [isListening, setIsListening] = useState(false);
  /** Counts pop-ins; a new value replays the landing glow. */
  const [landingCount, setLandingCount] = useState(0);

  const state = useNotchStore((store) => store.state);
  const settings = useNotchStore((store) => store.settings);
  const uiScale = useNotchStore((store) => store.uiScale);
  const isReady = useNotchStore((store) => store.isReady);
  const isUserVisible = useNotchStore((store) => store.isVisible);
  const isSettingsOpen = useNotchStore((store) => store.isSettingsOpen);
  const isFullscreenApp = useNotchStore((store) => store.foreground.is_fullscreen);
  const isMaximizedApp = useNotchStore((store) => store.foreground.is_window_maximized);

  const widgets = settings.active_widgets;
  const isNotchMode = settings.display_mode === "notch";
  const isOpen = state === "hover" || state === "expanded";
  const isRaised = !isCollapsedState(state);
  /**
   * Off screen: hidden from the tray, stepping aside for a fullscreen app, or
   * still waiting for the saved settings at startup.
   */
  const isHidden = !isReady || !isUserVisible || isFullscreenApp;

  // Over a maximized app the cursor has to rest a moment before it counts,
  // so a pass on the way to a browser tab does not open the capsule.
  const { isActive: isHoverOpen, enter, leave, open, reset } = useHoverDelay({
    enterDelay: isMaximizedApp ? HOVER_ENTER_DELAY_LIP_MS : HOVER_ENTER_DELAY_MS,
    leaveDelay: HOVER_LEAVE_DELAY_MS,
  });

  // Retracted: an app window is under the capsule and the user is not on it.
  // Resting the cursor on the lip (isHoverOpen) drops the capsule back down,
  // also in states where hovering opens nothing more (Do Not Disturb).
  const wantsRetract = isMaximizedApp && !isHoverOpen;
  /** The capsule is currently drawn as the lip. */
  const isRetracted = wantsRetract && !isRaised;

  // Width, height and position come from this one place.
  const shape = useMemo(
    () => getNotchShape(state, settings, { isRetracted: wantsRetract, uiScale }),
    [state, settings, wantsRetract, uiScale],
  );

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
  // The neon outline follows the cover while the track plays; white otherwise.
  // The waveform keeps the cover's colour while paused too (--notch-accent).
  const coverAccent = useAlbumAccent(media);
  const neonColor = (media?.is_playing ? coverAccent : null) ?? NEON_IDLE_COLOR;
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

  // Width of the lip that belongs to the current content, for the hover
  // bridge: the collapsed capsule as it would be drawn right now.
  const showsMediaWhenIdle = widgets.media && !settings.dnd_enabled && isMediaPlaying;
  const lipWidth = NOTCH_SIZES[showsMediaWhenIdle ? "idleMedia" : "idle"].width;

  // Going off screen (a fullscreen app takes over, Hide from the tray) wins
  // over everything: whatever was open closes, the hover ends at once and its
  // pending timers are cancelled. The capsule later comes back collapsed, in
  // the shape the window then in front calls for.
  useEffect(() => {
    if (!isHidden) return;
    setMenu(null);
    setCursorOver(false);
    setIsPressing(false);
    setHasTextFocus(false);
    reset();
    const store = useNotchStore.getState();
    store.closeSettings();
    store.setExpanded(false);
    store.setDragOver(false);
  }, [isHidden, reset]);

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
        // Now that we are listening, the hit regions are sent again (see the
        // effect below): Rust answers with the current hover state, which
        // matters when the cursor was already on the capsule.
        if (!disposed) setIsListening(true);
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
    const report = () =>
      reportHitRegions(isHidden ? null : shape, menu, {
        scale: uiScale,
        // The lip is hover-only: clicks reach the tab underneath.
        isPassive: isRetracted,
        // Once open over a maximized app, keep the lip's strip part of the
        // hover area (it matters in island mode, where the capsule floats).
        bridgeWidth: isMaximizedApp && !isRetracted ? lipWidth : null,
        watchOutsideClicks,
      });

    report();
    window.addEventListener("resize", report);
    return () => window.removeEventListener("resize", report);
  }, [
    shape,
    menu,
    watchOutsideClicks,
    isHidden,
    uiScale,
    isRetracted,
    isMaximizedApp,
    lipWidth,
    isListening,
  ]);

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
    // Mouse coordinates are window pixels; the menu is laid out inside the
    // zoomed root, so everything is converted to its unscaled units.
    const scale = useNotchStore.getState().uiScale;
    setMenu(
      placeContextMenu(
        event.clientX / scale,
        event.clientY / scale,
        window.innerWidth / scale,
        window.innerHeight / scale,
      ),
    );
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
      animateTo(width, shape.width, transition),
      animateTo(height, shape.height, transition),
      animateTo(top, shape.top, transition),
      animateTo(topCurve, targetCurve, transition),
      animateTo(bottomRadius, shape.bottomRadius, transition),
    ];
    return () => controls.forEach((control) => control?.stop());
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

  // --- Pop-in when the capsule returns ------------------------------------------
  //
  // The capsule was off screen (a fullscreen game or video, or hidden from
  // the tray) and is shown again. Declared after the geometry effect above
  // on purpose: both may start in the same commit, and the one that runs
  // last decides the animation.
  const entranceY = useMotionValue(0);
  const entranceScale = useMotionValue(1);
  const wasHidden = useRef(isHidden);

  useEffect(() => {
    const isReturning = wasHidden.current && !isHidden;
    wasHidden.current = isHidden;
    if (!isReturning) return;

    // Whatever happened while the capsule was invisible (settings loading at
    // startup, a mode switch from the tray) must not be seen as a morph now:
    // width and position start at their final values.
    width.jump(shape.width);
    top.jump(shape.top);

    // Battery saver and reduced motion keep the plain fade. So does a return
    // into the retracted lip: there is nothing to bounce.
    if (reducedMotion || isBatterySaver || isRetracted) {
      height.jump(shape.height);
      topCurve.jump(targetCurve);
      bottomRadius.jump(shape.bottomRadius);
      return;
    }

    setLandingCount((count) => count + 1);

    if (isNotchMode) {
      // Grow out of the screen edge: no height, no ears, no corners at first,
      // then everything springs to its shape and overshoots a little, like a
      // drop forming on the bezel.
      height.jump(0);
      topCurve.jump(0);
      bottomRadius.jump(0);
      animate(height, shape.height, SPRING_ENTRANCE);
      animate(topCurve, targetCurve, SPRING_ENTRANCE);
      animate(bottomRadius, shape.bottomRadius, SPRING_ENTRANCE);
      return;
    }

    // Island: drop in from above with a bounce, swelling past full size once.
    height.jump(shape.height);
    topCurve.jump(targetCurve);
    bottomRadius.jump(shape.bottomRadius);
    entranceY.jump(ENTRANCE_OFFSET_Y);
    entranceScale.jump(ENTRANCE_SCALE_KEYFRAMES[0]);
    animate(entranceY, 0, SPRING_ENTRANCE);
    animate(entranceScale, ENTRANCE_SCALE_KEYFRAMES, {
      duration: 0.5,
      times: [0, 0.55, 1],
      ease: "easeOut",
    });
    // Deliberately keyed on visibility alone: only becoming visible starts
    // the pop-in, and the shape it lands in is the one current at that moment.
  }, [isHidden]);

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
      <IdleView media={state === "idleMedia" ? media : null} isDndEnabled={settings.dnd_enabled} />
    );

  return (
    <>
      <motion.div
        role="group"
        aria-label={APP_NAME}
        aria-hidden={isHidden}
        data-state={state}
        data-mode={settings.display_mode}
        data-retracted={isRetracted}
        initial={false}
        animate={{ opacity: isHidden ? 0 : 1 }}
        // Leaving is a calm fade; returning is quick, the pop-in does the rest.
        transition={{ duration: isHidden ? VISIBILITY_FADE_S : 0.12, ease: "easeOut" }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onPointerDown={() => setIsPressing(true)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        style={{
          width,
          height,
          top,
          y: entranceY,
          scale: entranceScale,
          transformOrigin: "50% 0%",
          ...(coverAccent && {
            "--notch-accent": coverAccent,
            "--notch-accent-light": `color-mix(in srgb, ${coverAccent} 55%, white)`,
          }),
        }}
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
          <motion.path
            d={fillPath}
            fill={`rgb(9 9 11 / ${settings.opacity})`}
            style={{ transition: "fill 200ms ease" }}
          />
          {/*
            Soft glow behind the neon line; removed under battery saver.
            After a pop-in it pulses once: the key remounts the path, which
            restarts the one-shot `notch-landing` animation.
          */}
          <motion.path
            key={landingCount}
            d={strokePath}
            fill="none"
            stroke={neonColor}
            strokeWidth="3"
            opacity={isActive ? 0.5 : 0}
            className={[
              "notch-outline notch-outline-glow",
              landingCount > 0 ? "notch-landing" : "",
            ].join(" ")}
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
            stroke={neonColor}
            strokeWidth={BORDER_WIDTH}
            opacity={isActive ? 0.9 : 0}
            className="notch-outline"
          />
        </svg>

        {/*
          Faint light inside the capsule in the user's two colours (Settings):
          the start colour from the top left, the end colour from the bottom
          right, at 16% so the black stays black. It fills the capsule's own
          outline, so in notch mode one gradient runs from ear tip to ear tip
          instead of stopping at the body. It breathes while music plays.
        */}
        <svg
          width="1"
          height="1"
          aria-hidden="true"
          className={[
            "pointer-events-none absolute top-0 left-0 overflow-visible",
            isMediaPlaying && !settings.dnd_enabled ? "notch-ambient-breathing" : "",
          ].join(" ")}
        >
          <defs>
            <radialGradient id={glowStartId} cx="0" cy="0" r="1" gradientTransform="scale(1.2 1.7)">
              <stop offset="0" stopColor={settings.glow_start} stopOpacity="0.16" />
              <stop offset="0.62" stopColor={settings.glow_start} stopOpacity="0" />
            </radialGradient>
            <radialGradient
              id={glowEndId}
              cx="0"
              cy="0"
              r="1"
              gradientTransform="translate(1 1) scale(1.2 1.7)"
            >
              <stop offset="0" stopColor={settings.glow_end} stopOpacity="0.16" />
              <stop offset="0.62" stopColor={settings.glow_end} stopOpacity="0" />
            </radialGradient>
          </defs>
          <motion.path d={fillPath} fill={`url(#${glowEndId})`} />
          <motion.path d={fillPath} fill={`url(#${glowStartId})`} />
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
              // The view keeps the size of its state even while the capsule
              // is retracted to the lip: the capsule clips it, so the content
              // can never hold the capsule's height open.
              style={{
                top: BORDER_WIDTH,
                width: NOTCH_SIZES[state].width - BORDER_WIDTH * 2,
                height: (isRetracted ? NOTCH_SIZES[state].height : shape.height) - BORDER_WIDTH * 2,
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
                {/* Nothing is readable in a 5px lip: the content fades with the retraction. */}
                <div
                  className="h-full w-full transition-opacity duration-150"
                  style={{ opacity: isRetracted ? 0 : 1 }}
                >
                  {content}
                </div>
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
              scale={settings.scale}
              onSelectScale={useNotchStore.getState().setScale}
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
