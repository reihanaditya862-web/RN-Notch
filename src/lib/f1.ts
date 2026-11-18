/**
 * Formula 1 season data from the Jolpica API (the Ergast-compatible F1 API):
 * schedule parsing, which weekend is coming up, and team colours.
 *
 * All times in the API are UTC; `Date` turns them into the computer's local
 * time zone when they are shown.
 */

export const F1_SCHEDULE_URL = "https://api.jolpi.ca/ergast/f1/current.json";
export const F1_RESULTS_URL = "https://api.jolpi.ca/ergast/f1/current/last/results.json";

export interface F1Session {
  key: string;
  /** "FP1", "Sprint Quali", "Qualifying", "Race"... */
  label: string;
  start: number;
  /** False when the API has only the date so far. */
  hasTime: boolean;
}

export interface F1Race {
  season: string;
  round: number;
  name: string;
  circuit: string;
  locality: string;
  country: string;
  isSprint: boolean;
  /** In running order, the race last. */
  sessions: F1Session[];
  raceStart: number;
}

export interface F1Result {
  season: string;
  round: number;
  raceName: string;
  driver: string;
  driverNumber: string | null;
  /** Wikipedia article of the driver, for the portrait. */
  driverWiki: string | null;
  team: string;
  teamId: string;
}

/** Order and names of the sessions of a weekend, in the API's keys. */
const SESSION_KEYS: Array<[string, string]> = [
  ["FirstPractice", "FP1"],
  ["SecondPractice", "FP2"],
  ["ThirdPractice", "FP3"],
  ["SprintQualifying", "Sprint Quali"],
  ["SprintShootout", "Sprint Quali"],
  ["Sprint", "Sprint"],
  ["Qualifying", "Qualifying"],
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A race is "on" until two hours after its start (the usual distance limit). */
const RACE_WINDOW = 2 * HOUR;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** "2026-11-21" + "06:00:00Z" -> epoch ms; noon UTC when the time is unknown. */
function parseMoment(entry: unknown): { start: number; hasTime: boolean } | null {
  if (!isObject(entry)) return null;
  const date = text(entry.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = text(entry.time);
  const hasTime = /^\d{2}:\d{2}(:\d{2})?Z?$/.test(time);
  const start = Date.parse(`${date}T${hasTime ? time.replace(/Z?$/, "Z") : "12:00:00Z"}`);
  return Number.isFinite(start) ? { start, hasTime } : null;
}

function races(json: unknown): unknown[] {
  if (!isObject(json) || !isObject(json.MRData)) return [];
  const table = json.MRData.RaceTable;
  return isObject(table) && Array.isArray(table.Races) ? table.Races : [];
}

/** The season's weekends; entries the API got wrong are skipped. */
export function parseSchedule(json: unknown): F1Race[] {
  const parsed: F1Race[] = [];
  for (const race of races(json)) {
    if (!isObject(race)) continue;
    const raceMoment = parseMoment(race);
    const round = Number(text(race.round));
    if (!raceMoment || !Number.isInteger(round)) continue;

    const sessions: F1Session[] = [];
    for (const [key, label] of SESSION_KEYS) {
      const moment = parseMoment(race[key]);
      if (moment && !sessions.some((session) => session.label === label)) {
        sessions.push({ key, label, ...moment });
      }
    }
    sessions.sort((a, b) => a.start - b.start);
    sessions.push({ key: "Race", label: "Race", ...raceMoment });

    const circuit = isObject(race.Circuit) ? race.Circuit : {};
    const location = isObject(circuit.Location) ? circuit.Location : {};
    parsed.push({
      season: text(race.season),
      round,
      name: text(race.raceName) || `Round ${round}`,
      circuit: text(circuit.circuitName),
      locality: text(location.locality),
      country: text(location.country),
      isSprint: sessions.some((session) => session.label === "Sprint"),
      sessions,
      raceStart: raceMoment.start,
    });
  }
  return parsed.sort((a, b) => a.raceStart - b.raceStart);
}

/** The winner of the latest race in a results answer, or null. */
export function parseWinner(json: unknown): F1Result | null {
  const race = races(json)[0];
  if (!isObject(race) || !Array.isArray(race.Results)) return null;
  const first = race.Results.find((result) => isObject(result) && text(result.position) === "1");
  if (!isObject(first) || !isObject(first.Driver) || !isObject(first.Constructor)) return null;

  const driver = first.Driver;
  const name = `${text(driver.givenName)} ${text(driver.familyName)}`.trim();
  const round = Number(text(race.round));
  if (!name || !Number.isInteger(round)) return null;

  return {
    season: text(race.season),
    round,
    raceName: text(race.raceName),
    driver: name,
    driverNumber: text(driver.permanentNumber) || null,
    driverWiki: wikiTitle(text(driver.url)),
    team: text(first.Constructor.name),
    teamId: text(first.Constructor.constructorId),
  };
}

/** "http://en.wikipedia.org/wiki/Max_Verstappen" -> "Max_Verstappen". */
export function wikiTitle(url: string): string | null {
  const match = /wikipedia\.org\/wiki\/([^?#]+)$/.exec(url);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** The weekend that is coming up or still running. */
export function upcomingRace(schedule: F1Race[], now: number): F1Race | null {
  return schedule.find((race) => race.raceStart + RACE_WINDOW >= now) ?? null;
}

/** Race week: from seven days before the race until it is over. */
export function isRaceWeek(race: F1Race | null, now: number): boolean {
  return race !== null && now >= race.raceStart - 7 * DAY && now <= race.raceStart + RACE_WINDOW;
}

/**
 * The latest race whose result should be out by now (about an hour after the
 * flag, so 2.5 h after the start), but not one from days ago.
 */
export function raceAwaitingWinner(schedule: F1Race[], now: number): F1Race | null {
  const finished = schedule.filter(
    (race) => race.raceStart + 2.5 * HOUR <= now && now - race.raceStart <= 2 * DAY,
  );
  return finished[finished.length - 1] ?? null;
}

/** "in 3d 4h", "in 2h 15m", "in 12m", "now". */
export function countdown(target: number, now: number): string {
  const left = target - now;
  if (left <= 0) return "now";
  const minutes = Math.floor(left / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
  return `in ${Math.max(1, minutes)}m`;
}

/** Local "HH:MM". */
export function localTime(epoch: number): string {
  const date = new Date(epoch);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Local "Fri 21". */
export function localDay(epoch: number): string {
  const date = new Date(epoch);
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()}`;
}

const TEAM_COLORS: Record<string, string> = {
  red_bull: "#3671C6",
  ferrari: "#E8002D",
  mercedes: "#27F4D2",
  mclaren: "#FF8000",
  aston_martin: "#229971",
  alpine: "#0093CC",
  williams: "#64C4FF",
  rb: "#6692FF",
  racing_bulls: "#6692FF",
  sauber: "#52E252",
  kick_sauber: "#52E252",
  audi: "#F50537",
  haas: "#B6BABD",
  cadillac: "#C9A74A",
};

/** The team's livery colour; F1 red for a team not on the list. */
export function teamColor(teamId: string): string {
  return TEAM_COLORS[teamId] ?? "#E10600";
}

/** "Max Verstappen" -> "MV". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}
