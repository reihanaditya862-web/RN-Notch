import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AudioApp, OutputDevice } from "../lib/types";

const POLL_MS = 2000;
/** A change made here outranks the polls for this long. */
const HOLD_MS = 1500;

interface AudioMixer {
  outputs: OutputDevice[];
  apps: AudioApp[];
  /** null: no microphone. */
  micMuted: boolean | null;
  setOutput: (id: string) => void;
  toggleMic: () => void;
  setAppVolume: (pid: number, volume: number) => void;
  toggleAppMute: (pid: number) => void;
}

function run(command: string, args?: Record<string, unknown>): void {
  if (!isTauri()) return;
  invoke(command, args).catch((error: unknown) =>
    console.warn(`[useAudioMixer] ${command} failed:`, error),
  );
}

/**
 * Output devices, the microphone and the apps playing sound, refreshed every
 * two seconds while `active` (the tools page is on screen and the mixer is
 * switched on). Changes show at once and are confirmed by the next poll.
 */
export function useAudioMixer(active: boolean): AudioMixer {
  const [outputs, setOutputs] = useState<OutputDevice[]>([]);
  const [apps, setApps] = useState<AudioApp[]>([]);
  const [micMuted, setMicMuted] = useState<boolean | null>(null);
  const holdUntil = useRef(0);
  const appsRef = useRef<AudioApp[]>([]);
  appsRef.current = apps;

  useEffect(() => {
    if (!active || !isTauri()) return;
    let disposed = false;
    let timer = 0;

    const poll = async () => {
      try {
        const [nextOutputs, nextApps, nextMic] = await Promise.all([
          invoke<OutputDevice[]>("audio_outputs"),
          invoke<AudioApp[]>("audio_apps"),
          invoke<boolean | null>("mic_muted"),
        ]);
        if (disposed || Date.now() < holdUntil.current) return;
        setOutputs(nextOutputs);
        setApps(nextApps);
        setMicMuted(nextMic);
      } catch (error) {
        console.warn("[useAudioMixer] poll failed:", error);
      } finally {
        if (!disposed) timer = window.setTimeout(() => void poll(), POLL_MS);
      }
    };
    void poll();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [active]);

  const hold = () => {
    holdUntil.current = Date.now() + HOLD_MS;
  };

  const setOutput = useCallback((id: string) => {
    hold();
    setOutputs((current) => current.map((device) => ({ ...device, is_default: device.id === id })));
    run("set_audio_output", { id });
  }, []);

  const toggleMic = useCallback(() => {
    hold();
    setMicMuted((current) => (current === null ? null : !current));
    run("toggle_mic");
  }, []);

  const setAppVolume = useCallback((pid: number, volume: number) => {
    hold();
    setApps((current) =>
      current.map((app) =>
        app.pid === pid ? { ...app, volume, muted: volume > 0 ? false : app.muted } : app,
      ),
    );
    run("set_app_volume", { pid, volume });
  }, []);

  const toggleAppMute = useCallback((pid: number) => {
    const app = appsRef.current.find((candidate) => candidate.pid === pid);
    if (!app) return;
    hold();
    const muted = !app.muted;
    setApps((current) =>
      current.map((candidate) => (candidate.pid === pid ? { ...candidate, muted } : candidate)),
    );
    run("set_app_muted", { pid, muted });
  }, []);

  return { outputs, apps, micMuted, setOutput, toggleMic, setAppVolume, toggleAppMute };
}
