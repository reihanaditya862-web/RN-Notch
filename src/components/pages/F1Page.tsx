import { useEffect, useState } from "react";
import { Flag } from "lucide-react";
import {
  countdown,
  initials,
  isRaceWeek,
  localDay,
  localTime,
  teamColor,
  upcomingRace,
} from "../../lib/f1";
import { useNotchStore } from "../../stores/notchStore";
import { DigitText } from "../widgets/DigitText";
import { F1LaunchAnimation } from "../widgets/F1LaunchAnimation";
import { TeamLogo } from "../widgets/TeamLogo";
import { PageHeader, SectionLabel } from "./PageHeader";

/** The launch animation plays once a day, the first time the page opens in race week. */
const ANIMATION_DAY_KEY = "rn-f1-animation-day";
const ANIMATION_MS = 3200;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function todayKey(): string {
  const date = new Date();
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Plays the launch start when the page opens in race week, once per day. */
function useLaunchOnce(raceWeek: boolean): boolean {
  const [isPlaying, setIsPlaying] = useState(false);
  useEffect(() => {
    if (!raceWeek) return;
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(ANIMATION_DAY_KEY);
    } catch {
      // Without storage it simply plays each time.
    }
    if (seen === todayKey()) return;
    setIsPlaying(true);
    // Counted as seen only once it has played to the end; leaving the page
    // halfway lets it play again next time.
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(ANIMATION_DAY_KEY, todayKey());
      } catch {
        // See above.
      }
      setIsPlaying(false);
    }, ANIMATION_MS);
    return () => {
      window.clearTimeout(timer);
      setIsPlaying(false);
    };
  }, [raceWeek]);
  return isPlaying;
}

/**
 * The F1 Race Hub: the next Grand Prix with its sessions in local time, a
 * race-week marker from seven days out, and the last winner.
 */
export function F1Page({ onCollapse }: { onCollapse: () => void }) {
  const schedule = useNotchStore((store) => store.f1Schedule);
  const status = useNotchStore((store) => store.f1Status);
  const winner = useNotchStore((store) => store.f1Winner);
  const now = useNow(30_000);

  const race = schedule ? upcomingRace(schedule, now) : null;
  const raceWeek = isRaceWeek(race, now);
  const isLaunching = useLaunchOnce(raceWeek);

  return (
    <div className="flex h-full flex-col gap-1.5">
      <PageHeader
        title="F1 Race Hub"
        detail={race ? `Round ${race.round}${race.isSprint ? " · Sprint weekend" : ""}` : undefined}
        onCollapse={onCollapse}
      />

      <div className="relative h-11 shrink-0 overflow-hidden rounded-lg bg-notch-surface/70">
        {isLaunching ? (
          <F1LaunchAnimation />
        ) : race ? (
          <div className="flex h-full items-center gap-2.5 px-2.5">
            <span className="h-7 w-1 shrink-0 rounded-full bg-[#E10600]" aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-display text-[13px] leading-4 font-bold text-notch-primary">
                {race.name}
              </span>
              <span className="truncate text-[10px] leading-3 text-notch-tertiary">
                {[race.locality, race.country].filter(Boolean).join(", ")}
              </span>
            </span>
            {raceWeek && (
              <span className="shrink-0 rounded-full bg-[#E10600] px-2 text-[9px] leading-4 font-bold tracking-[0.06em] text-white uppercase">
                Race week
              </span>
            )}
            <span className="shrink-0 font-display text-[11px] leading-none font-bold text-notch-secondary">
              {countdown(race.raceStart, now)}
            </span>
          </div>
        ) : (
          <p className="flex h-full items-center justify-center text-[11px] text-notch-tertiary">
            {status === "loading"
              ? "Loading the season..."
              : status === "error"
                ? "No connection - the schedule loads when you are online"
                : "The season is over. See you next year!"}
          </p>
        )}
      </div>

      <section aria-label="Sessions" className="flex min-h-0 flex-1 flex-col gap-1">
        <SectionLabel>Sessions · your time</SectionLabel>
        <ul data-scroll className="notch-scroll -mx-1 flex min-h-0 flex-1 flex-col gap-0.5 px-1">
          {(race?.sessions ?? []).map((session) => {
            const isOver = session.start + (session.label === "Race" ? 2 : 1) * 3_600_000 < now;
            const isNext = !isOver && race?.sessions.find((candidate) => candidate.start + 3_600_000 >= now) === session;
            return (
              <li
                key={session.key}
                className={`flex h-[22px] shrink-0 items-center gap-2 rounded-md px-1.5 ${isNext ? "bg-notch-surface" : ""}`}
              >
                <span
                  className={`w-[78px] shrink-0 text-[11px] leading-4 font-medium ${session.label === "Race" ? "text-[#ff4d42]" : "text-notch-primary"} ${isOver ? "opacity-45" : ""}`}
                >
                  {session.label}
                </span>
                <span className={`w-12 shrink-0 text-[11px] leading-4 text-notch-secondary ${isOver ? "opacity-45" : ""}`}>
                  {localDay(session.start)}
                </span>
                <span className={`w-11 shrink-0 font-display text-[11px] leading-none font-bold text-notch-primary ${isOver ? "opacity-45" : ""}`}>
                  {session.hasTime ? <DigitText text={localTime(session.start)} /> : "TBC"}
                </span>
                <span className="flex-1" />
                <span className={`shrink-0 text-[10px] leading-3 ${isNext ? "text-notch-playing" : "text-notch-tertiary"}`}>
                  {isOver ? "done" : countdown(session.start, now)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {winner && (
        <div className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-notch-surface/70 pr-2.5 pl-1.5">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border"
            style={{ borderColor: teamColor(winner.teamId), backgroundColor: `${teamColor(winner.teamId)}33` }}
          >
            {winner.photo ? (
              <img src={winner.photo} alt="" draggable={false} className="h-full w-full object-cover object-top" />
            ) : (
              <span className="text-[10px] font-bold text-notch-primary">{initials(winner.driver)}</span>
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-1 text-[9px] leading-3 tracking-[0.06em] text-notch-tertiary uppercase">
              <Flag size={9} strokeWidth={2} aria-hidden="true" />
              Last winner · {winner.raceName}
            </span>
            <span className="truncate text-[12px] leading-4 font-semibold text-notch-primary">
              {winner.driver}
              <span className="font-normal text-notch-secondary"> · {winner.team}</span>
            </span>
          </span>
          {winner.teamLogo ? (
            <TeamLogo src={winner.teamLogo} team={winner.team} small />
          ) : (
            <span className="h-5 w-1 shrink-0 rounded-full" style={{ backgroundColor: teamColor(winner.teamId) }} aria-hidden="true" />
          )}
        </div>
      )}
    </div>
  );
}
