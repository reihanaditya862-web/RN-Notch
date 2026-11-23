import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import type { LiveActivity } from "../../hooks/useLiveActivity";
import type { DashboardPageId } from "../../lib/pages";
import { useNotchStore } from "../../stores/notchStore";
import { FOCUS_RING } from "../pages/PageHeader";
import { DigitText } from "./DigitText";

/** Room the pill takes in the collapsed capsule, in px (see `getNotchShape`). */
export const LIVE_ACTIVITY_WIDTH = 72;

/** Room for an activity's pill; an F1 session label needs a little more. */
export function liveActivityWidth(activity: LiveActivity | null): number {
  if (!activity) return 0;
  return activity.kind === "f1" ? 100 : LIVE_ACTIVITY_WIDTH;
}

const RING_RADIUS = 5;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Re-renders every `ms` while mounted (the pill is only mounted while shown). */
function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}

/** A small progress ring: the stroke shortens as the phase runs out. */
function Ring({ progress, color }: { progress: number; color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true" className="shrink-0 -rotate-90">
      <circle cx="6.5" cy="6.5" r={RING_RADIUS} fill="none" stroke="white" strokeOpacity={0.18} strokeWidth="1.6" />
      <circle
        cx="6.5"
        cy="6.5"
        r={RING_RADIUS}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray={RING_LENGTH}
        strokeDashoffset={RING_LENGTH * (1 - Math.min(1, Math.max(0, progress)))}
        style={{ transition: "stroke-dashoffset 900ms linear" }}
      />
    </svg>
  );
}

function PomodoroContent() {
  const pomodoro = useNotchStore((store) => store.pomodoro);
  const now = useTick(1000);
  const remaining =
    pomodoro.pausedRemaining ?? (pomodoro.endsAt === null ? 0 : Math.max(0, pomodoro.endsAt - now));
  const progress = pomodoro.totalMs > 0 ? remaining / pomodoro.totalMs : 0;
  const color = pomodoro.phase === "break" ? "#34d399" : "var(--notch-accent-1, #60a5fa)";
  return (
    <>
      <Ring progress={progress} color={color} />
      <span className={pomodoro.pausedRemaining !== null ? "opacity-50" : undefined}>
        <DigitText text={clock(remaining)} />
      </span>
    </>
  );
}

function RecordingContent({ startedAt }: { startedAt: number }) {
  const now = useTick(1000);
  return (
    <>
      <span aria-hidden="true" className="notch-pulse h-2 w-2 shrink-0 rounded-full bg-[#ff3b30]" />
      <DigitText text={clock(now - startedAt)} />
    </>
  );
}

/** A live F1 session: a red pulse and the session, e.g. "F1 QUALI". */
function F1Content({ label }: { label: string }) {
  return (
    <>
      <span aria-hidden="true" className="notch-pulse h-2 w-2 shrink-0 rounded-full bg-[#E10600]" />
      <span className="whitespace-nowrap">{label}</span>
    </>
  );
}

function ScheduleContent({ startsAt }: { startsAt: number }) {
  const now = useTick(15_000);
  const minutes = Math.max(0, Math.ceil((startsAt - now) / 60_000));
  return (
    <>
      <CalendarClock size={12} strokeWidth={2} aria-hidden="true" className="shrink-0 text-notch-playing" />
      <DigitText text={minutes === 0 ? "now" : `${minutes}m`} />
    </>
  );
}

function describe(activity: LiveActivity): { label: string; page: DashboardPageId } {
  switch (activity.kind) {
    case "recording":
      return { label: "Screen recording in progress", page: "tools" };
    case "pomodoro":
      return { label: activity.phase === "break" ? "Break timer" : "Focus timer", page: "tools" };
    case "f1":
      return { label: `Live now: ${activity.session}`, page: "f1" };
    case "schedule":
      return { label: `Next: ${activity.title}`, page: "calendar" };
  }
}

/**
 * The live activity beside the clock: a recording's elapsed time, the focus
 * timer's ring and countdown, or the minutes until the next routine, all in
 * the Formula1 face. With `isInteractive` (the hover pill) it is a button
 * that opens the page the activity belongs to.
 */
export function LiveActivityPill({
  activity,
  isInteractive = false,
}: {
  activity: LiveActivity;
  isInteractive?: boolean;
}) {
  const { label, page } = describe(activity);
  const content =
    activity.kind === "recording" ? (
      <RecordingContent startedAt={activity.startedAt} />
    ) : activity.kind === "pomodoro" ? (
      <PomodoroContent />
    ) : activity.kind === "f1" ? (
      <F1Content label={activity.label} />
    ) : (
      <ScheduleContent startsAt={activity.startsAt} />
    );
  const className =
    "flex h-[18px] shrink-0 items-center gap-1 rounded-full bg-notch-surface px-1.5 font-display text-[11px] leading-none font-bold text-notch-primary";

  if (!isInteractive) {
    return (
      <span role="status" aria-label={label} className={className}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={label}
      aria-label={`${label}. Open`}
      onClick={() => {
        const store = useNotchStore.getState();
        store.setDashboardPage(page);
        store.setExpanded(true);
      }}
      className={`${className} hover:bg-notch-surface-hover ${FOCUS_RING}`}
    >
      {content}
    </button>
  );
}
