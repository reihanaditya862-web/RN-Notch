import { useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Sparkles } from "lucide-react";
import { useAiShortcuts } from "../../hooks/useAiShortcuts";
import { AI_DRAWER_HEIGHT } from "../../lib/constants";
import type { AiShortcut } from "../../lib/types";
import { useNotchStore } from "../../stores/notchStore";

/** The drawer stays this long after the cursor leaves it. */
const CLOSE_DELAY_MS = 350;
/** Height of the strip along the pop-up's bottom edge that opens the drawer. */
export const AI_TRIGGER_HEIGHT = 10;

function launch(shortcut: AiShortcut): void {
  if (!isTauri()) return;
  invoke("launch_ai", { id: shortcut.id }).catch((error: unknown) =>
    console.warn("[AiDrawer] launch_ai failed:", error),
  );
}

function ShortcutButton({ shortcut }: { shortcut: AiShortcut }) {
  const where = shortcut.installed ? "app" : "website";
  return (
    <button
      type="button"
      onClick={() => launch(shortcut)}
      title={`Open ${shortcut.name} (${where})`}
      aria-label={`Open ${shortcut.name}`}
      className={[
        "flex h-[26px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2",
        "bg-notch-surface text-[11px] leading-none font-medium text-notch-secondary",
        "transition-[color,background-color,scale] duration-100 hover:bg-notch-surface-hover hover:text-notch-primary active:scale-95",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-notch-focus",
      ].join(" ")}
    >
      {shortcut.icon ? (
        <img src={shortcut.icon} alt="" draggable={false} className="h-4 w-4 shrink-0 rounded-[4px] object-contain" />
      ) : (
        <Sparkles size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
      )}
      <span className="truncate">{shortcut.name}</span>
    </button>
  );
}

/** The three shortcuts in a row. */
export function AiShortcutRow() {
  const shortcuts = useAiShortcuts();
  return (
    <div role="group" aria-label="AI apps" className="flex items-center gap-1.5">
      {shortcuts.map((shortcut) => (
        <ShortcutButton key={shortcut.id} shortcut={shortcut} />
      ))}
    </div>
  );
}

/**
 * Hover drawer under the media controls of the pop-up: a thin strip along
 * the pop-up's bottom edge. Reaching it lets the pop-up grow by one row with
 * the Claude, ChatGPT and Gemini shortcuts; leaving folds it away again.
 *
 * `top` is where the strip starts, measured from the top of the content.
 */
export function AiDrawer({ top }: { top: number }) {
  const isOpen = useNotchStore((store) => store.isDrawerOpen);
  const setDrawerOpen = useNotchStore((store) => store.setDrawerOpen);
  const closeTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const open = () => {
    window.clearTimeout(closeTimer.current);
    setDrawerOpen(true);
  };
  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setDrawerOpen(false), CLOSE_DELAY_MS);
  };

  return (
    <div
      onPointerEnter={open}
      onPointerLeave={scheduleClose}
      className="absolute inset-x-0"
      style={{ top, height: AI_TRIGGER_HEIGHT + AI_DRAWER_HEIGHT }}
    >
      <span
        aria-hidden="true"
        className={[
          "absolute top-1 left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-full bg-white/15 transition-opacity duration-150",
          isOpen ? "opacity-0" : "opacity-100",
        ].join(" ")}
      />
      <div
        className={[
          "absolute inset-x-3 transition-opacity duration-150",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
        style={{ top: AI_TRIGGER_HEIGHT - 2 }}
      >
        <AiShortcutRow />
      </div>
    </div>
  );
}
