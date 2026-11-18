import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  BatteryCharging,
  Bell,
  BatteryLow,
  BatteryMedium,
  Bluetooth,
  Camera,
  Copy,
  Flag,
  Monitor,
  Timer,
  TriangleExclamationPoint,
  Video,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";
import type { Alert, AlertIcon, AlertSymbol } from "../lib/alerts";
import { useNotchStore } from "../stores/notchStore";
import { F1LaunchAnimation } from "./widgets/F1LaunchAnimation";
import { TeamGlow, WinnerHero } from "./widgets/TeamLogo";

const SYMBOLS: Record<AlertSymbol, LucideIcon> = {
  wifi: Wifi,
  "wifi-off": WifiOff,
  bluetooth: Bluetooth,
  display: Monitor,
  battery: BatteryMedium,
  "battery-low": BatteryLow,
  charging: BatteryCharging,
  copy: Copy,
  timer: Timer,
  camera: Camera,
  record: Video,
  flag: Flag,
  bell: Bell,
  error: TriangleExclamationPoint,
};

const TONE_COLOR: Record<Alert["tone"], string> = {
  info: "text-notch-primary",
  success: "text-notch-playing",
  warning: "text-notch-charging",
};

function AlertGlyph({ icon, tone }: { icon: AlertIcon | null; tone: Alert["tone"] }) {
  if (icon?.type === "image") {
    return (
      <img
        src={icon.src}
        alt=""
        draggable={false}
        className="h-7 w-7 shrink-0 rounded-lg object-contain"
      />
    );
  }
  if (icon?.type === "swatch") {
    return (
      <span
        aria-hidden="true"
        className="h-7 w-7 shrink-0 rounded-lg border border-white/20"
        style={{ backgroundColor: icon.color }}
      />
    );
  }
  const Icon = icon?.type === "symbol" ? SYMBOLS[icon.name] : Bell;
  return (
    <span
      aria-hidden="true"
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-notch-surface ${TONE_COLOR[tone]}`}
    >
      <Icon size={16} strokeWidth={1.75} />
    </span>
  );
}

function openSender(alert: Alert): void {
  if (!alert.openAppId || !isTauri()) return;
  invoke("open_app", { appId: alert.openAppId }).catch((error: unknown) =>
    console.warn("[AlertView] open_app failed:", error),
  );
}

function DismissButton({ alert }: { alert: Alert }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        useNotchStore.getState().dismissAlert(alert.id);
      }}
      aria-label="Dismiss"
      title="Dismiss"
      className={[
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-notch-tertiary",
        "transition-colors duration-100 hover:bg-notch-surface hover:text-notch-primary",
        "outline-none focus-visible:outline-2 focus-visible:outline-notch-focus",
      ].join(" ")}
    >
      <X size={12} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

/** The usual pop-up: icon, title (with the app's name), one line of text. */
function StandardAlert({ alert }: { alert: Alert }) {
  const canOpen = alert.openAppId !== null;
  const body = (
    <>
      <AlertGlyph icon={alert.icon} tone={alert.tone} />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 text-left">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[12px] leading-4 font-semibold text-notch-primary">
            {alert.title}
          </span>
          {alert.source && (
            <span className="shrink-0 text-[10px] leading-3 text-notch-tertiary">{alert.source}</span>
          )}
        </span>
        {alert.body && (
          <span className="truncate text-[11px] leading-[14px] text-notch-secondary">{alert.body}</span>
        )}
      </span>
    </>
  );

  return (
    <div className="flex h-full w-full items-center gap-2.5 pr-2.5 pl-3.5">
      {canOpen ? (
        <button
          type="button"
          onClick={() => {
            openSender(alert);
            useNotchStore.getState().dismissAlert(alert.id);
          }}
          title={`Open ${alert.source ?? "the app"}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-notch-focus"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5">{body}</div>
      )}
      <DismissButton alert={alert} />
    </div>
  );
}

/** Race result: the winner's portrait, name, Grand Prix and team colour. */
function WinnerAlert({ alert }: { alert: Alert }) {
  const winner = alert.winner;
  if (!winner) return null;
  return (
    <div className="relative flex h-full w-full items-center gap-2 overflow-hidden pr-2.5 pl-3.5">
      {/* Team colour behind everything, the logo card behind the photo. */}
      <TeamGlow color={winner.teamColor} />
      <WinnerHero
        photo={winner.photo}
        logo={winner.teamLogo}
        color={winner.teamColor}
        driver={winner.driver}
        size={68}
      />
      <span className="relative flex min-w-0 flex-1 flex-col gap-0.5 [text-shadow:0_1px_6px_rgb(0_0_0/0.65)]">
        <span
          className="flex items-center gap-1 text-[10px] leading-3 font-semibold tracking-[0.08em] uppercase"
          style={{ color: winner.teamColor }}
        >
          <Flag size={11} strokeWidth={2} aria-hidden="true" />
          Race winner
        </span>
        <span className="truncate font-display text-[15px] leading-5 font-bold text-notch-primary">
          {winner.driver}
          {winner.number && <span className="text-notch-tertiary"> #{winner.number}</span>}
        </span>
        <span className="truncate text-[11px] leading-[14px] text-notch-secondary">
          {winner.grandPrix} · {winner.team}
        </span>
      </span>
      <span className="relative">
        <DismissButton alert={alert} />
      </span>
    </div>
  );
}

/** Session reminder with the launch-start animation running along the top. */
function SessionAlert({ alert }: { alert: Alert }) {
  const session = alert.session;
  if (!session) return null;
  return (
    <div className="relative flex h-full w-full flex-col justify-end overflow-hidden px-3.5 pb-2">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-11">
        <F1LaunchAnimation key={alert.id} />
      </div>
      <div className="relative flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] leading-4 font-semibold text-notch-primary">
          {session.session} at {session.startsAt}
          <span className="font-normal text-notch-secondary"> · {session.grandPrix}</span>
        </span>
        <span className="shrink-0 font-display text-[11px] leading-none font-bold text-[#E10600]">
          {session.minutesLeft} MIN
        </span>
        <DismissButton alert={alert} />
      </div>
    </div>
  );
}

/** Content of the capsule in the `alert` state. */
export function AlertView({ alert }: { alert: Alert }) {
  return (
    <div role="status" aria-live="polite" className="h-full w-full">
      {alert.winner ? (
        <WinnerAlert alert={alert} />
      ) : alert.session ? (
        <SessionAlert alert={alert} />
      ) : (
        <StandardAlert alert={alert} />
      )}
    </div>
  );
}

/**
 * The same pop-up as a banner over the dashboard or the settings panel: it
 * slides in at the top for its few seconds and leaves whatever the user was
 * doing exactly as it was.
 */
export function AlertBanner({ alert }: { alert: Alert }) {
  const height = alert.winner ? 92 : alert.session ? 68 : 48;
  return (
    <motion.div
      key={alert.id}
      initial={{ y: -height - 8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -height - 8, opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className="absolute inset-x-2 top-2 z-20 overflow-hidden rounded-2xl border border-notch-border-hover bg-[rgb(18_18_22/0.97)] shadow-[0_8px_24px_rgb(0_0_0/0.5)]"
      style={{ height }}
    >
      <AlertView alert={alert} />
    </motion.div>
  );
}
