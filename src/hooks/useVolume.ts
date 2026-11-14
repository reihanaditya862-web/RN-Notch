import { useCallback, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useNotchStore } from "../stores/notchStore";

interface Volume {
  /** 0-100, or null when unknown (no audio device, or not loaded yet). */
  volume: number | null;
  isMuted: boolean;
  setVolume: (percent: number) => void;
  toggleMute: () => void;
}

/**
 * Master volume of Windows: the value comes from the system info polls, the
 * setters talk to Core Audio through Rust.
 */
export function useVolume(): Volume {
  const volume = useNotchStore((store) => store.systemInfo?.volume_percent ?? null);
  const isMuted = useNotchStore((store) => store.systemInfo?.is_muted ?? false);

  // Dragging the slider fires many changes. Only one request runs at a time,
  // and the newest value waiting replaces any older one.
  const inFlight = useRef(false);
  const queued = useRef<number | null>(null);

  const send = useCallback(async (level: number) => {
    if (!isTauri()) return;
    if (inFlight.current) {
      queued.current = level;
      return;
    }

    inFlight.current = true;
    try {
      await invoke("set_volume", { level });
    } catch (error) {
      console.warn("[useVolume] set_volume failed:", error);
    } finally {
      inFlight.current = false;
    }

    const waiting = queued.current;
    if (waiting !== null) {
      queued.current = null;
      void send(waiting);
    }
  }, []);

  const setVolume = useCallback(
    (percent: number) => {
      const level = Math.min(100, Math.max(0, Math.round(percent)));
      useNotchStore.getState().setVolumeOptimistic(level);
      void send(level);
    },
    [send],
  );

  const toggleMute = useCallback(() => {
    const store = useNotchStore.getState();
    const wasMuted = store.systemInfo?.is_muted ?? false;
    store.setMutedOptimistic(!wasMuted);

    if (!isTauri()) return;
    invoke<boolean>("toggle_mute")
      .then((muted) => useNotchStore.getState().setMutedOptimistic(muted))
      .catch((error: unknown) => {
        useNotchStore.getState().setMutedOptimistic(wasMuted);
        console.warn("[useVolume] toggle_mute failed:", error);
      });
  }, []);

  return { volume, isMuted, setVolume, toggleMute };
}
