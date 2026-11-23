import { ALERT_DURATION_MS, NOTCH_SIZES } from "./constants";
import type { AppNotification, HardwareAlert } from "./types";

/**
 * Short-lived pop-ups, ordered by importance: the volume/brightness HUD >
 * hardware (battery, Wi-Fi...) > notifications > F1 > toasts (a copied colour).
 */
export type AlertKind = "hud" | "hardware" | "notification" | "f1" | "toast";

export const ALERT_PRIORITY: Record<AlertKind, number> = {
  hud: 5,
  hardware: 4,
  notification: 3,
  f1: 2,
  toast: 1,
};

/** Built-in pictures for pop-ups that have no app icon. */
export type AlertSymbol =
  | "wifi"
  | "wifi-off"
  | "bluetooth"
  | "display"
  | "battery"
  | "battery-low"
  | "charging"
  | "copy"
  | "timer"
  | "camera"
  | "record"
  | "flag"
  | "bell"
  | "error";

export type AlertIcon =
  | { type: "image"; src: string }
  | { type: "symbol"; name: AlertSymbol }
  | { type: "swatch"; color: string };

export interface F1WinnerCard {
  driver: string;
  grandPrix: string;
  team: string;
  /** The team logo as a `data:` URL; null shows only the team colour. */
  teamLogo: string | null;
  teamColor: string;
  /** Portrait as a `data:` URL; null shows the driver's initials. */
  photo: string | null;
  number: string | null;
}

export interface F1SessionCard {
  grandPrix: string;
  session: string;
  /** Local start time, "HH:MM". */
  startsAt: string;
  minutesLeft: number;
}

/** A volume or brightness change reported by Windows (see `hud.rs`). */
export interface HudReading {
  kind: "volume" | "brightness";
  /** 0-100. */
  level: number;
  muted: boolean;
}

/** How long the HUD stays after the last change. */
export const HUD_DURATION_MS = 1500;

export interface Alert {
  id: string;
  kind: AlertKind;
  title: string;
  body: string;
  icon: AlertIcon | null;
  tone: "info" | "success" | "warning";
  /** Small app name above the title (notifications). */
  source: string | null;
  durationMs: number;
  /** Clicking the pop-up opens this app (the sender of a notification). */
  openAppId: string | null;
  /** Pop-ups with their own layout. */
  winner: F1WinnerCard | null;
  session: F1SessionCard | null;
  /** The volume/brightness pill; `revision` counts in-place updates. */
  hud: (HudReading & { revision: number }) | null;
  createdAt: number;
}

let sequence = 0;
function nextId(kind: AlertKind): string {
  sequence += 1;
  return `${kind}-${Date.now()}-${sequence}`;
}

function base(kind: AlertKind, title: string, body: string, durationMs: number): Alert {
  return {
    id: nextId(kind),
    kind,
    title,
    body,
    icon: null,
    tone: "info",
    source: null,
    durationMs,
    openAppId: null,
    winner: null,
    session: null,
    hud: null,
    createdAt: Date.now(),
  };
}

const HARDWARE_SYMBOLS: Record<HardwareAlert["kind"], (alert: HardwareAlert) => AlertSymbol> = {
  wifi: (alert) => (alert.tone === "warning" ? "wifi-off" : "wifi"),
  bluetooth: () => "bluetooth",
  display: () => "display",
  battery: (alert) => (alert.tone === "warning" ? "battery-low" : "battery"),
  charging: () => "charging",
};

export function hardwareAlert(hardware: HardwareAlert): Alert {
  return {
    ...base("hardware", hardware.title, hardware.detail, ALERT_DURATION_MS.hardware),
    icon: { type: "symbol", name: HARDWARE_SYMBOLS[hardware.kind](hardware) },
    tone: hardware.tone,
  };
}

export function notificationAlert(notification: AppNotification): Alert {
  return {
    ...base("notification", notification.title, notification.body, ALERT_DURATION_MS.notification),
    icon: notification.icon
      ? { type: "image", src: notification.icon }
      : { type: "symbol", name: "bell" },
    source: notification.app,
    openAppId: notification.app_id,
  };
}

export function toastAlert(
  title: string,
  body: string,
  icon: AlertIcon | null,
  tone: Alert["tone"] = "info",
): Alert {
  return { ...base("toast", title, body, ALERT_DURATION_MS.toast), icon, tone };
}

export function winnerAlert(card: F1WinnerCard): Alert {
  return {
    ...base("f1", `${card.driver} wins`, card.grandPrix, ALERT_DURATION_MS.f1Winner),
    winner: card,
  };
}

export function sessionAlert(card: F1SessionCard): Alert {
  return {
    ...base("f1", `${card.session} in ${card.minutesLeft} min`, card.grandPrix, ALERT_DURATION_MS.f1Session),
    session: card,
  };
}

export function hudAlert(reading: HudReading): Alert {
  const title = reading.kind === "volume" ? "Volume" : "Brightness";
  const level = Math.round(Math.min(100, Math.max(0, reading.level)));
  return {
    ...base("hud", title, reading.muted ? "Muted" : `${level}%`, HUD_DURATION_MS),
    hud: { ...reading, level, revision: 0 },
  };
}

/** Higher priority first; within a priority, the older one first. */
export function compareAlerts(a: Alert, b: Alert): number {
  return ALERT_PRIORITY[b.kind] - ALERT_PRIORITY[a.kind] || a.createdAt - b.createdAt;
}

/** Same pop-up twice in a row (a flapping Wi-Fi, a double notification). */
export function isDuplicate(a: Alert, b: Alert): boolean {
  return a.kind === b.kind && a.title === b.title && a.body === b.body && a.source === b.source;
}

let measureContext: CanvasRenderingContext2D | null = null;

/** Width of a line of text in px, as the capsule will draw it. */
export function textWidth(text: string, font: string): number {
  if (typeof document === "undefined") return text.length * 6.5;
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return text.length * 6.5;
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

export const ALERT_TITLE_FONT = '600 12px "Inter Variable", system-ui, sans-serif';
export const ALERT_BODY_FONT = '400 11px "Inter Variable", system-ui, sans-serif';

const ALERT_MIN_WIDTH = 220;
const ALERT_MAX_WIDTH = 400;
/** Icon, paddings, gap and the close button around the text. */
const ALERT_CHROME_WIDTH = 14 + 30 + 10 + 22 + 14;

/**
 * The pop-up's size: as wide as its text needs (within limits), so a short
 * "Charging 80%" stays small and a message gets room.
 */
export function alertSize(alert: Alert): { width: number; height: number } {
  if (alert.winner) return { width: 400, height: 100 };
  if (alert.session) return { width: 400, height: 76 };
  if (alert.hud) return { width: 280, height: 40 };

  const text = Math.max(
    textWidth(alert.source ? `${alert.title}  ${alert.source}` : alert.title, ALERT_TITLE_FONT),
    textWidth(alert.body, ALERT_BODY_FONT),
  );
  const width = Math.round(
    Math.min(ALERT_MAX_WIDTH, Math.max(ALERT_MIN_WIDTH, text + ALERT_CHROME_WIDTH)),
  );
  return { width, height: alert.body ? NOTCH_SIZES.alert.height : 40 };
}
