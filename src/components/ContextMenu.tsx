import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Moon, RefreshCw, Scaling, Settings, X } from "lucide-react";
import { copyText } from "../lib/clipboard";
import { APP_NAME, SCALE_OPTIONS } from "../lib/constants";
import type { DisplayMode, ScaleOption } from "../lib/types";

/**
 * Fixed geometry of the menu, in px. It is fixed on purpose: the menu's
 * rectangle is reported to Rust as a clickable area the moment it opens,
 * before the browser has laid it out.
 */
const ITEM_HEIGHT = 28;
const SEPARATOR_HEIGHT = 9;
const PADDING = 4;
const BORDER = 1;
/** Five actions plus the size row, which is as tall as an item. */
const ITEM_COUNT = 6;
const SEPARATOR_COUNT = 1;

export const CONTEXT_MENU_WIDTH = 216;
export const CONTEXT_MENU_HEIGHT =
  ITEM_COUNT * ITEM_HEIGHT + SEPARATOR_COUNT * SEPARATOR_HEIGHT + (PADDING + BORDER) * 2;
export const CONTEXT_MENU_RADIUS = 12;

/** Distance kept from the window edges, and from the cursor's hot spot. */
const EDGE_MARGIN = 8;
const CURSOR_OFFSET = 2;

/** How long "Copied" stays on screen before the menu closes, in ms. */
const COPIED_FEEDBACK_MS = 700;

/**
 * Top-left corner for a menu opened at the cursor: just below-right of it,
 * pulled back inside the window when it would not fit.
 */
export function placeContextMenu(
  cursorX: number,
  cursorY: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const maxX = Math.max(EDGE_MARGIN, viewportWidth - CONTEXT_MENU_WIDTH - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, viewportHeight - CONTEXT_MENU_HEIGHT - EDGE_MARGIN);
  return {
    x: Math.round(Math.min(maxX, Math.max(EDGE_MARGIN, cursorX + CURSOR_OFFSET))),
    y: Math.round(Math.min(maxY, Math.max(EDGE_MARGIN, cursorY + CURSOR_OFFSET))),
  };
}

interface MenuItemProps {
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Renders the item as a checkbox with a dot when checked. */
  checked?: boolean;
  tone?: "default" | "danger";
}

function MenuItem({ icon, label, onSelect, disabled, checked, tone = "default" }: MenuItemProps) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      style={{ height: ITEM_HEIGHT }}
      className={[
        "group flex w-full items-center gap-2 rounded-md px-2 text-left text-[12px] leading-4",
        "text-notch-primary outline-none transition-colors duration-75",
        "hover:bg-white/[0.07] focus-visible:bg-white/[0.07]",
        "disabled:pointer-events-none disabled:text-notch-disabled",
        tone === "danger" ? "hover:text-notch-error focus-visible:text-notch-error" : "",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "flex h-4 w-4 shrink-0 items-center justify-center text-notch-secondary",
          "group-disabled:text-notch-disabled",
          tone === "danger"
            ? "group-hover:text-notch-error group-focus-visible:text-notch-error"
            : "",
        ].join(" ")}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked && (
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-notch-dnd" />
      )}
    </button>
  );
}

interface SizeRowProps {
  scale: ScaleOption;
  onSelect: (scale: ScaleOption) => void;
}

/** "Size" with one small button per option; the current one is highlighted. */
function SizeRow({ scale, onSelect }: SizeRowProps) {
  return (
    <div
      role="group"
      aria-label="Size"
      style={{ height: ITEM_HEIGHT }}
      className="flex items-center gap-2 px-2 text-[12px] leading-4 text-notch-primary"
    >
      <span
        aria-hidden="true"
        className="flex h-4 w-4 shrink-0 items-center justify-center text-notch-secondary"
      >
        <Scaling size={14} strokeWidth={1.5} />
      </span>
      <span className="shrink-0">Size</span>
      <span className="ml-auto flex items-center gap-0.5">
        {SCALE_OPTIONS.map((option) => {
          const isSelected = option.value === scale;
          return (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={isSelected}
              aria-label={`Size ${option.label}`}
              onClick={() => onSelect(option.value)}
              className={[
                "h-5 rounded px-1 text-[10px] leading-none font-medium outline-none transition-colors duration-75",
                "hover:bg-white/[0.1] focus-visible:bg-white/[0.1]",
                isSelected ? "bg-white/[0.14] text-notch-primary" : "text-notch-secondary",
              ].join(" ")}
            >
              {/* The percent sign is dropped to fit five options in one row. */}
              {option.value === "auto" ? "Auto" : option.value}
            </button>
          );
        })}
      </span>
    </div>
  );
}

interface ContextMenuProps {
  /** Top-left corner inside the window; use `placeContextMenu`. */
  x: number;
  y: number;
  displayMode: DisplayMode;
  isDndEnabled: boolean;
  /** The size currently chosen. */
  scale: ScaleOption;
  onSelectScale: (scale: ScaleOption) => void;
  /** "Artist - Title" of the current track, or null when nothing is playing. */
  nowPlaying: string | null;
  onSwitchMode: () => void;
  onToggleDnd: () => void;
  onOpenSettings: () => void;
  onQuit: () => void;
  onClose: () => void;
  /** Hover reporting for environments without the Rust cursor watcher. */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/**
 * Right-click menu of the capsule.
 *
 * Closes when an item is chosen, on Escape, on a click anywhere else inside
 * the window, and when the window loses focus. Clicks outside the window
 * never reach the webview; the parent closes the menu for those (it hears
 * about them from Rust).
 */
export function ContextMenu({
  x,
  y,
  displayMode,
  isDndEnabled,
  scale,
  onSelectScale,
  nowPlaying,
  onSwitchMode,
  onToggleDnd,
  onOpenSettings,
  onQuit,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [isCopied, setIsCopied] = useState(false);

  // Take keyboard focus, so the arrow keys and Escape work right away.
  useEffect(() => {
    menuRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  useEffect(() => {
    if (!isCopied) return;
    const timer = window.setTimeout(onClose, COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [isCopied, onClose]);

  /** Runs an action and closes the menu. */
  const choose = useCallback(
    (action: () => void) => () => {
      action();
      onClose();
    },
    [onClose],
  );

  const handleCopy = useCallback(() => {
    if (!nowPlaying) return;
    void copyText(nowPlaying).then((ok) => {
      if (ok) setIsCopied(true);
      else onClose();
    });
  }, [nowPlaying, onClose]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
      );
      if (items.length === 0) return;

      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      let next: number;
      switch (event.key) {
        case "ArrowDown":
          next = (current + 1) % items.length;
          break;
        case "ArrowUp":
          next = current <= 0 ? items.length - 1 : current - 1;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = items.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      items[next].focus();
    },
    [onClose],
  );

  const otherMode = displayMode === "island" ? "Notch" : "Dynamic Island";

  return (
    <motion.div
      ref={menuRef}
      role="menu"
      aria-label={`${APP_NAME} menu`}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.1, ease: "easeOut" }}
      style={{
        left: x,
        top: y,
        width: CONTEXT_MENU_WIDTH,
        height: CONTEXT_MENU_HEIGHT,
        padding: PADDING,
        borderRadius: CONTEXT_MENU_RADIUS,
        transformOrigin: "top left",
      }}
      className={[
        // `notch-blur` lets battery saver switch the backdrop blur off.
        "notch-blur absolute z-10 border border-white/10 bg-[#121215]/90 font-sans outline-none backdrop-blur-md",
        "shadow-[0_8px_24px_rgba(0,0,0,0.45),0_1px_3px_rgba(0,0,0,0.3)]",
      ].join(" ")}
    >
      <MenuItem
        icon={<RefreshCw size={14} strokeWidth={1.5} />}
        label={`Switch to ${otherMode}`}
        onSelect={choose(onSwitchMode)}
      />
      <MenuItem
        icon={
          isCopied ? (
            <Check size={14} strokeWidth={1.5} className="text-notch-playing" />
          ) : (
            <Copy size={14} strokeWidth={1.5} />
          )
        }
        label={isCopied ? "Copied" : "Copy Now Playing"}
        onSelect={handleCopy}
        disabled={!nowPlaying}
      />
      <MenuItem
        icon={
          <Moon
            size={14}
            strokeWidth={1.5}
            className={isDndEnabled ? "text-notch-dnd" : undefined}
          />
        }
        label="Do Not Disturb"
        onSelect={choose(onToggleDnd)}
        checked={isDndEnabled}
      />

      <div
        role="separator"
        style={{ height: SEPARATOR_HEIGHT }}
        className="flex items-center px-1"
      >
        <div className="h-px w-full bg-white/10" />
      </div>

      {/* Resizing moves everything under the cursor, so the menu closes on a choice. */}
      <SizeRow scale={scale} onSelect={(option) => choose(() => onSelectScale(option))()} />
      <MenuItem
        icon={<Settings size={14} strokeWidth={1.5} />}
        label="Settings..."
        onSelect={choose(onOpenSettings)}
      />
      <MenuItem
        icon={<X size={14} strokeWidth={1.5} />}
        label={`Quit ${APP_NAME}`}
        onSelect={choose(onQuit)}
        tone="danger"
      />
    </motion.div>
  );
}
