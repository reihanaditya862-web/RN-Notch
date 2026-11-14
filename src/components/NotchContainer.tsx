import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface NotchContainerProps {
  children?: ReactNode;
}

/** Event emitted by the Rust cursor watcher: `true` = cursor is over the capsule. */
const HOVER_EVENT = "notch-hover";

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
 * The floating capsule. Idle state: 180x32px, pinned to the top-center of the
 * transparent Tauri window.
 *
 * Click-through works in two layers:
 * 1. `onMouseEnter` / `onMouseLeave` call `set_clickthrough(false / true)`.
 * 2. A window that ignores cursor events never receives `mouseenter`, so the
 *    capsule also reports its rectangle to Rust (`set_hit_region`). A cursor
 *    watcher there switches click-through off when the cursor reaches the
 *    capsule and emits `notch-hover`, which keeps `hovered` in sync here.
 */
export function NotchContainer({ children }: NotchContainerProps) {
  const capsuleRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);

  const handleMouseEnter = useCallback(() => {
    setHovered(true);
    void setClickthrough(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHovered(false);
    void setClickthrough(true);
  }, []);

  // Report the capsule rectangle to Rust, now and whenever it changes size.
  useEffect(() => {
    const capsule = capsuleRef.current;
    if (!capsule || !isTauri()) return;

    const reportRegion = () => {
      const rect = capsule.getBoundingClientRect();
      invoke("set_hit_region", {
        region: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      }).catch((error: unknown) => {
        console.warn("[NotchContainer] set_hit_region failed:", error);
      });
    };

    reportRegion();

    const observer = new ResizeObserver(reportRegion);
    observer.observe(capsule);
    window.addEventListener("resize", reportRegion);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reportRegion);
    };
  }, []);

  // Follow hover changes detected by the Rust cursor watcher.
  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<boolean>(HOVER_EVENT, (event) => setHovered(event.payload))
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

  return (
    <div
      ref={capsuleRef}
      role="status"
      aria-label="Dynamic Island"
      data-hovered={hovered}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={[
        "absolute top-0 left-1/2 -translate-x-1/2",
        "flex h-8 w-[180px] items-center justify-between",
        "rounded-full border px-3",
        "bg-[#09090B]/95 transition-colors duration-200",
        hovered ? "border-notch-border-hover" : "border-notch-border",
      ].join(" ")}
    >
      {children}
    </div>
  );
}
