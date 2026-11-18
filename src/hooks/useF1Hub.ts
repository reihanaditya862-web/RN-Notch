import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { sessionAlert, winnerAlert } from "../lib/alerts";
import {
  F1_RESULTS_URL,
  F1_SCHEDULE_URL,
  type F1Race,
  type F1Result,
  localTime,
  parseSchedule,
  parseWinner,
  raceAwaitingWinner,
  teamColor,

} from "../lib/f1";
import { transparentLogo } from "../lib/logo";
import { type F1Winner, useNotchStore } from "../stores/notchStore";

const SCHEDULE_KEY = "rn-f1-schedule-v1";
const WINNER_KEY = "rn-f1-winner-v1";
const ANNOUNCED_KEY = "rn-f1-announced-v1";
const REMINDED_KEY = "rn-f1-reminded-v1";

/** The schedule is fetched again after this long (it rarely changes). */
const SCHEDULE_MAX_AGE_MS = 12 * 3_600_000;
/** A session reminder comes this long before the start. */
const REMINDER_LEAD_MS = 15 * 60_000;
/** Results are asked for again this often until they are out. */
const RESULT_RETRY_MS = 15 * 60_000;
const TICK_MS = 60_000;

function readJson<T>(key: string): T | null {
  try {
    const text = localStorage.getItem(key);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the data is fetched again next time.
  }
}

async function fetchJson(url: string): Promise<unknown> {
  return JSON.parse(await invoke<string>("http_get_text", { url }));
}

/** Where Wikipedia serves its images from. */
const WIKIMEDIA_IMAGE = /^https:\/\/(upload|thumb)\.wikimedia\.org\//;

/**
 * The lead image of a Wikipedia article, or null: a driver's article leads
 * with their portrait, a team's article with the team logo.
 */
async function fetchWikiImage(wikiTitle: string | null | undefined): Promise<string | null> {
  if (!wikiTitle) return null;
  try {
    const summary = await fetchJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`,
    );
    const thumbnail =
      typeof summary === "object" && summary !== null && "thumbnail" in summary
        ? (summary.thumbnail as { source?: unknown } | null)
        : null;
    const source = thumbnail?.source;
    if (typeof source !== "string" || !WIKIMEDIA_IMAGE.test(source)) return null;
    return await invoke<string>("http_get_image", { url: source });
  } catch {
    return null;
  }
}

/** The logo with its background removed; the original when that fails. */
async function withoutBackground(logo: string | null): Promise<string | null> {
  if (!logo) return null;
  try {
    return await transparentLogo(logo);
  } catch {
    return logo;
  }
}

function raceKey(race: { season: string; round: number }): string {
  return `${race.season}-${race.round}`;
}

/**
 * The F1 Race Hub's background work, while the module is on:
 * - keeps the season schedule (cached for 12 h, so it also works offline),
 * - fifteen minutes before each session of race week, shows a reminder,
 * - about an hour after a race has finished, fetches the result (again every
 *   fifteen minutes until it is published) and shows the winner card once.
 */
export function useF1Hub(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !isTauri()) return;

    let disposed = false;
    let lastResultAttempt = 0;
    const { setF1, pushAlert } = useNotchStore.getState();

    const cached = readJson<{ fetchedAt: number; races: F1Race[] }>(SCHEDULE_KEY);
    if (cached?.races?.length) setF1({ f1Schedule: cached.races, f1Status: "ready" });
    const storedWinner = readJson<F1Winner>(WINNER_KEY);
    if (storedWinner) setF1({ f1Winner: storedWinner });
    // A logo saved by an earlier version may still have its background.
    if (storedWinner?.teamLogo && !storedWinner.logoTransparent) {
      void withoutBackground(storedWinner.teamLogo).then((teamLogo) => {
        const cleaned = { ...storedWinner, teamLogo, logoTransparent: true };
        writeJson(WINNER_KEY, cleaned);
        if (!disposed) setF1({ f1Winner: cleaned });
      });
    }

    const refreshSchedule = async () => {
      const latest = readJson<{ fetchedAt: number; races: F1Race[] }>(SCHEDULE_KEY);
      if (latest && Date.now() - latest.fetchedAt < SCHEDULE_MAX_AGE_MS) return;
      if (!useNotchStore.getState().f1Schedule) setF1({ f1Status: "loading" });
      try {
        const races = parseSchedule(await fetchJson(F1_SCHEDULE_URL));
        if (disposed || races.length === 0) return;
        writeJson(SCHEDULE_KEY, { fetchedAt: Date.now(), races });
        setF1({ f1Schedule: races, f1Status: "ready" });
      } catch (error) {
        console.warn("[useF1Hub] schedule unavailable:", error);
        if (!disposed && !useNotchStore.getState().f1Schedule) setF1({ f1Status: "error" });
      }
    };

    const remind = (races: F1Race[], now: number) => {
      // Any weekend may have a session starting soon: the next race's first
      // practice can begin while the previous race is still "on".
      const reminded = new Set(readJson<string[]>(REMINDED_KEY) ?? []);
      for (const race of races) {
        for (const session of race.sessions) {
          const lead = session.start - now;
          const id = `${raceKey(race)}-${session.key}`;
          if (!session.hasTime || lead <= 0 || lead > REMINDER_LEAD_MS || reminded.has(id)) continue;
          reminded.add(id);
          pushAlert(
            sessionAlert({
              grandPrix: race.name,
              session: session.label,
              startsAt: localTime(session.start),
              minutesLeft: Math.max(1, Math.round(lead / 60_000)),
            }),
          );
        }
      }
      writeJson(REMINDED_KEY, [...reminded].slice(-40));
    };

    const keepWinner = async (result: F1Result): Promise<F1Winner> => {
      const known = useNotchStore.getState().f1Winner;
      const sameRace = known !== null && raceKey(known) === raceKey(result);
      const [photo, teamLogo] = await Promise.all([
        sameRace && known.photo ? known.photo : fetchWikiImage(result.driverWiki),
        sameRace && known.teamLogo ? known.teamLogo : fetchWikiImage(result.teamWiki),
      ]);
      const winner = { ...result, photo, teamLogo: await withoutBackground(teamLogo), logoTransparent: true };
      writeJson(WINNER_KEY, winner);
      if (!disposed) setF1({ f1Winner: winner });
      return winner;
    };

    // Pictures that failed to load (offline, or saved by an older version)
    // are tried once more per run.
    let picturesRetried = false;

    const checkResults = async (races: F1Race[], now: number) => {
      const awaiting = raceAwaitingWinner(races, now);
      const known = useNotchStore.getState().f1Winner;
      const wantsAnnouncement =
        awaiting !== null && localStorage.getItem(ANNOUNCED_KEY) !== raceKey(awaiting);
      // Also fill in the page's "last winner" when nothing is known yet, or
      // when its portrait or team logo is missing.
      const missingPictures = known !== null && (!known.photo || !known.teamLogo) && !picturesRetried;
      if (missingPictures) picturesRetried = true;
      const wantsLatest = known === null || missingPictures;
      if ((!wantsAnnouncement && !wantsLatest) || now - lastResultAttempt < RESULT_RETRY_MS) return;
      lastResultAttempt = now;

      try {
        const result = parseWinner(await fetchJson(F1_RESULTS_URL));
        if (!result || disposed) return;
        const isAwaited =
          awaiting !== null && result.season === awaiting.season && result.round === awaiting.round;
        if (!isAwaited && !wantsLatest) return;

        const winner = await keepWinner(result);
        if (isAwaited && wantsAnnouncement && !disposed) {
          localStorage.setItem(ANNOUNCED_KEY, raceKey(result));
          pushAlert(
            winnerAlert({
              driver: winner.driver,
              grandPrix: winner.raceName,
              team: winner.team,
              teamColor: teamColor(winner.teamId),
              teamLogo: winner.teamLogo,
              photo: winner.photo,
              number: winner.driverNumber,
            }),
          );
        }
      } catch (error) {
        console.warn("[useF1Hub] results unavailable:", error);
      }
    };

    const tick = async () => {
      await refreshSchedule();
      const races = useNotchStore.getState().f1Schedule;
      if (disposed || !races) return;
      const now = Date.now();
      remind(races, now);
      await checkResults(races, now);
    };

    void tick();
    const timer = window.setInterval(() => void tick(), TICK_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [enabled]);
}
