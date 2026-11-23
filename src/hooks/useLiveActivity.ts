import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { F1Race } from "../lib/f1";
import type { ScheduleItem } from "../lib/types";
import { useNotchStore } from "../stores/notchStore";
import { useSchedules } from "./useSchedules";

/** Something running that the collapsed capsule keeps in view. */
export type LiveActivity =
  | { kind: "recording"; startedAt: number }
  | { kind: "pomodoro"; phase: "focus" | "break" }
  | { kind: "f1"; label: string; session: string }
  | { kind: "schedule"; title: string; startsAt: number };

/** How long each kind of F1 session runs, in minutes (a little generous). */
const F1_SESSION_MINUTES: Record<string, number> = {
  FP1: 60,
  FP2: 60,
  FP3: 60,
  "Sprint Quali": 45,
  Sprint: 60,
  Qualifying: 60,
  Race: 120,
};

/** Short pill text per session, in the Formula1 face. */
const F1_PILL_LABELS: Record<string, string> = {
  FP1: "F1 FP1",
  FP2: "F1 FP2",
  FP3: "F1 FP3",
  "Sprint Quali": "F1 SQ",
  Sprint: "F1 SPRINT",
  Qualifying: "F1 QUALI",
  Race: "RACE LIVE",
};

/** The F1 session running right now, from the season schedule. */
function liveF1Session(races: F1Race[] | null, now: number): { label: string; session: string } | null {
  if (!races) return null;
  for (const race of races) {
    for (const session of race.sessions) {
      if (!session.hasTime) continue;
      const minutes = F1_SESSION_MINUTES[session.label] ?? 60;
      if (now >= session.start && now < session.start + minutes * 60_000) {
        return { label: F1_PILL_LABELS[session.label] ?? "F1 LIVE", session: `${race.name} ${session.label}` };
      }
    }
  }
  return null;
}

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
 * recording, then the focus timer, then an F1 session on track right now
 * (with smart context and the F1 hub on), then a routine starting within 30
 * minutes.
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
  const f1Races = useNotchStore((store) => store.f1Schedule);
  const showsF1 = useNotchStore(
    (store) => store.settings.features.smart_context && store.settings.features.f1_hub,
  );
  const [f1Live, setF1Live] = useState<{ label: string; session: string } | null>(null);

  useEffect(() => {
    if (!showsF1 || !f1Races) {
      setF1Live(null);
      return;
    }
    const check = () => {
      const next = liveF1Session(f1Races, Date.now());
      setF1Live((current) => (current?.session === next?.session ? current : next));
    };
    check();
    const timer = window.setInterval(check, SCHEDULE_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [f1Races, showsF1]);

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
  if (f1Live) return { kind: "f1", ...f1Live };
  if (routine) return { kind: "schedule", ...routine };
  return null;
}
