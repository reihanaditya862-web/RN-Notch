import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Distance of the preview from the cursor, so it never covers the pixel being read. */
const PREVIEW_OFFSET = 18;

/**
 * Full-screen, transparent eyedropper (its own window, see `picker.rs`).
 * The colour under the cursor shows in a small preview; a click copies its
 * hex code and closes the picker, Esc or a right click cancels.
 */
export function ColorPickerOverlay() {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const busy = useRef(false);
  const finished = useRef(false);

  const finish = useCallback((pick: boolean) => {
    if (finished.current) return;
    finished.current = true;
    invoke("finish_color_pick", { pick }).catch((error: unknown) =>
      console.warn("[ColorPicker] finish_color_pick failed:", error),
    );
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish(false);
      if (event.key === "Enter") finish(true);
    };
    // Switching to another window (Alt+Tab) cancels; the picker must never trap the screen.
    const onBlur = () => finish(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [finish]);

  const sample = () => {
    if (busy.current) return;
    busy.current = true;
    invoke<string | null>("pixel_at_cursor")
      .then((hex) => setColor(hex))
      .catch(() => setColor(null))
      .finally(() => {
        busy.current = false;
      });
  };

  const nearRight = cursor !== null && cursor.x > window.innerWidth - 170;
  const nearBottom = cursor !== null && cursor.y > window.innerHeight - 70;

  return (
    <div
      className="fixed inset-0 cursor-crosshair select-none"
      onPointerMove={(event) => {
        setCursor({ x: event.clientX, y: event.clientY });
        sample();
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        finish(event.button === 0);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <p className="pointer-events-none fixed top-4 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-[rgb(9_9_11/0.92)] px-3.5 py-1.5 text-[12px] text-notch-primary shadow-[0_6px_20px_rgb(0_0_0/0.45)]">
        Click to copy a colour · Esc to cancel
      </p>

      {cursor && (
        <div
          className="pointer-events-none fixed flex items-center gap-2 rounded-xl border border-white/15 bg-[rgb(9_9_11/0.94)] py-1.5 pr-3 pl-1.5 shadow-[0_6px_20px_rgb(0_0_0/0.5)]"
          style={{
            left: nearRight ? cursor.x - PREVIEW_OFFSET - 150 : cursor.x + PREVIEW_OFFSET,
            top: nearBottom ? cursor.y - PREVIEW_OFFSET - 40 : cursor.y + PREVIEW_OFFSET,
          }}
        >
          <span
            className="h-7 w-7 rounded-lg border border-white/30"
            style={{ backgroundColor: color ?? "transparent" }}
          />
          <span className="font-mono text-[12px] leading-none text-notch-primary">{color ?? "..."}</span>
        </div>
      )}
    </div>
  );
}
