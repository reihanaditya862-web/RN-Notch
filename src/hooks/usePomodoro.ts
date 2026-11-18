import { useEffect } from "react";
import { toastAlert } from "../lib/alerts";
import { playChime } from "../lib/sound";
import { useNotchStore } from "../stores/notchStore";

/**
 * Ends focus and break phases on time: a focus phase is followed by a break,
 * a break ends the cycle. Each end chimes and shows a pop-up. Mount it once.
 */
export function usePomodoro(): void {
  const phase = useNotchStore((store) => store.pomodoro.phase);
  const endsAt = useNotchStore((store) => store.pomodoro.endsAt);

  useEffect(() => {
    if (phase === "idle" || endsAt === null) return;

    const timer = window.setTimeout(
      () => {
        const store = useNotchStore.getState();
        playChime();
        if (phase === "focus") {
          store.startPomodoro("break");
          store.pushAlert(
            toastAlert(
              "Focus done",
              `Take a ${store.pomodoroBreakMin}-minute break`,
              { type: "symbol", name: "timer" },
              "success",
            ),
          );
        } else {
          store.resetPomodoro();
          store.pushAlert(
            toastAlert("Break over", "Ready for the next round?", { type: "symbol", name: "timer" }),
          );
        }
      },
      Math.max(0, endsAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [phase, endsAt]);
}
