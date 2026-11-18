import { useEffect, useState } from "react";
import { motion, type MotionValue } from "framer-motion";
import { useNotchStore } from "../../stores/notchStore";

const FOCUS_COLOR = "#FF6B5E";
const BREAK_COLOR = "#34D399";

/**
 * The focus timer's progress as a thin line along the capsule's edge (the
 * same outline the neon line follows, ear to ear in notch mode). It grows as
 * the phase runs and dims while paused. Draws nothing while the timer is off.
 *
 * It ticks by itself, so the rest of the capsule does not re-render for it.
 */
export function PomodoroRing({ path }: { path: MotionValue<string> }) {
  const pomodoro = useNotchStore((store) => store.pomodoro);
  const [now, setNow] = useState(Date.now);

  const isRunning = pomodoro.phase !== "idle" && pomodoro.endsAt !== null;
  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  if (pomodoro.phase === "idle" || pomodoro.totalMs <= 0) return null;

  const remaining = pomodoro.pausedRemaining ?? Math.max(0, (pomodoro.endsAt ?? now) - now);
  const progress = Math.min(1, Math.max(0, 1 - remaining / pomodoro.totalMs));

  return (
    <motion.path
      d={path}
      fill="none"
      pathLength={1}
      stroke={pomodoro.phase === "break" ? BREAK_COLOR : FOCUS_COLOR}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeDasharray={`${progress} 1`}
      opacity={isRunning ? 0.95 : 0.45}
      style={{ transition: "stroke-dasharray 900ms linear, opacity 200ms ease" }}
    />
  );
}
