import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ScheduleItem } from "../lib/types";
import { useNotchStore } from "../stores/notchStore";
import { useSchedules } from "./useSchedules";

/** Something running that the collapsed capsule keeps in view. */
export type LiveActivity =
  | { kind: "recording"; startedAt: number }
  | { kind: "pomodoro"; phase: "focus" | "break" }
  | { kind: "schedule"; title: string; startsAt: number };

/** A routine shows this long before it starts. */
const SCHEDULE_LEAD_MS = 30 * 60_000;
/** How often the next routine is looked for. */
const SCHEDULE_CHECK_MS = 20_000;
/** Snipping Tool is asked whether it is back in front this often... */
const RECORDING_CHECK_MS = 1000;
/** ...after it has had this long to step back after the start. */
const RECORDING_GRACE_MS = 2500;
/** A recording nobody stopped from here is forgotten after this long. */
const RECORDING_MAX_MS = 3 * 3_600_000;

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The routine starting within the next half hour today, not yet ticked off. */
function upcomingRoutine(items: ScheduleItem[] | null, now: number): { title: string; startsAt: number } | null {
  if (!items?.length) return null;
  const today = new Date(now);
  const todayKey = dateKey(today);
  let best: { title: string; startsAt: number } | null = null;
  for (const item of items) {
    if (!item.days.includes(today.getDay()) || item.done_on === todayKey) continue;
    const [hours, minutes] = item.time.split(":").map(Number);
    const startsAt = new Date(today).setHours(hours, minutes, 0, 0);
    const lead = startsAt - now;
    if (lead < 0 || lead > SCHEDULE_LEAD_MS) continue;
    if (!best || startsAt < best.startsAt) best = { title: item.title, startsAt };
  }
  return best;
}

/**
 * The live activity to show beside the clock, most important first: a screen
 * recording, then the focus timer, then a routine starting within 30 minutes.
 *
 * The recording ends when Snipping Tool comes back to the front (its toolbar
 * was used to stop it) or has no window left (the area selection was
 * cancelled); that check only runs while a recording is on.
 */
export function useLiveActivity(): LiveActivity | null {
  const recording = useNotchStore((store) => store.recording);
  const pomodoroPhase = useNotchStore((store) => store.pomodoro.phase);
  const { items } = useSchedules();
  const [routine, setRoutine] = useState<{ title: string; startsAt: number } | null>(null);

  useEffect(() => {
    const check = () => {
      const next = upcomingRoutine(items, Date.now());
      setRoutine((current) =>
        current?.title === next?.title && current?.startsAt === next?.startsAt ? current : next,
      );
    };
    check();
    if (!items?.length) return;
    const timer = window.setInterval(check, SCHEDULE_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [items]);

  useEffect(() => {
    if (!recording || !isTauri()) return;
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - recording.startedAt;
      if (elapsed > RECORDING_MAX_MS) {
        useNotchStore.getState().setRecording(null);
        return;
      }
      if (elapsed < RECORDING_GRACE_MS) return;
      invoke<{ inFront: boolean; hasWindow: boolean }>("snipping_tool_status")
        .then((status) => {
          if (status.inFront || !status.hasWindow) useNotchStore.getState().setRecording(null);
        })
        .catch(() => undefined);
    }, RECORDING_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [recording]);

  if (recording) return { kind: "recording", startedAt: recording.startedAt };
  if (pomodoroPhase !== "idle") return { kind: "pomodoro", phase: pomodoroPhase };
  if (routine) return { kind: "schedule", ...routine };
  return null;
}
