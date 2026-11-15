import type { CSSProperties, ReactNode } from "react";
import {
  BatteryCharging,
  BatteryMedium,
  Cpu,
  MemoryStick,
  Plug,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useVolume } from "../../hooks/useVolume";
import { BATTERY_LOW_THRESHOLD } from "../../lib/constants";
import { useNotchStore } from "../../stores/notchStore";
import { DigitText } from "./DigitText";

interface StatTileProps {
  icon: ReactNode;
  label: string;
  value: string;
  /** Small unit or note after the value, e.g. "/ 7.3 GB". */
  detail?: string;
  /** 0-1 fill of the meter; null hides the fill. */
  level: number | null;
  /** Paints the meter red: the reading needs attention. */
  critical?: boolean;
}

function StatTile({ icon, label, value, detail, level, critical }: StatTileProps) {
  return (
    <div className="flex min-w-0 flex-col justify-between rounded-lg bg-notch-surface px-2.5 py-1.5">
      <div className="flex items-center gap-1.5 text-notch-tertiary">
        {icon}
        <span className="text-[10px] leading-3 font-medium">{label}</span>
      </div>

      <p
        aria-label={detail ? `${value} ${detail}` : value}
        className="truncate font-display text-[13px] leading-4 font-bold text-notch-primary"
      >
        <DigitText text={value} />
        {detail && (
          <span aria-hidden="true" className="text-[10px] text-notch-tertiary">
            {" "}
            {detail}
          </span>
        )}
      </p>

      <div className="h-[2px] w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full w-full origin-left transition-transform duration-500 ease-out ${
            critical ? "bg-notch-error" : "bg-notch-primary/70"
          }`}
          style={{ transform: `scaleX(${level === null ? 0 : Math.min(1, Math.max(0, level))})` }}
        />
      </div>
    </div>
  );
}

function VolumeRow() {
  const { volume, isMuted, setVolume, toggleMute } = useVolume();
  const isAvailable = volume !== null;
  const shown = isAvailable ? volume : 0;
  const isSilent = isMuted || shown === 0;

  const Icon = isSilent ? VolumeX : shown < 50 ? Volume1 : Volume2;

  return (
    <div className="flex h-[22px] items-center gap-2">
      <button
        type="button"
        onClick={toggleMute}
        disabled={!isAvailable}
        aria-label={isMuted ? "Unmute" : "Mute"}
        aria-pressed={isMuted}
        title={isMuted ? "Unmute" : "Mute"}
        className={[
          "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md",
          "transition-[color,scale] duration-100 hover:scale-110 active:scale-95",
          "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-notch-focus",
          "disabled:pointer-events-none disabled:opacity-35",
          isMuted ? "text-notch-error" : "text-notch-secondary hover:text-notch-primary",
        ].join(" ")}
      >
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>

      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={shown}
        disabled={!isAvailable}
        onChange={(event) => setVolume(Number(event.currentTarget.value))}
        aria-label="Master volume"
        className={`notch-range min-w-0 flex-1 ${isMuted ? "notch-range-muted" : ""}`}
        style={{ "--range-fill": `${shown}%` } as CSSProperties}
      />

      <span
        aria-hidden="true"
        className="w-11 shrink-0 text-right font-display text-[12px] leading-none font-bold text-notch-secondary"
      >
        {isAvailable ? <DigitText text={`${shown}%`} /> : "--"}
      </span>
    </div>
  );
}

/**
 * Hardware monitor: battery, CPU and RAM tiles plus the master volume slider.
 * All values are real readings from Windows, refreshed by `useSystemInfo`.
 */
export function SystemHUD() {
  const info = useNotchStore((store) => store.systemInfo);

  const battery = info?.battery_percent ?? null;
  const onAc = info?.is_ac_connected ?? false;
  const ramLevel = info && info.ram_total_gb > 0 ? info.ram_used_gb / info.ram_total_gb : null;

  const batteryDetail = info?.is_charging ? "Charging" : onAc && battery !== null ? "Plugged in" : "";
  const BatteryIcon = battery === null ? Plug : onAc ? BatteryCharging : BatteryMedium;

  return (
    <section aria-label="System" className="flex flex-col gap-1.5">
      <div className="grid h-[42px] grid-cols-3 gap-1.5">
        <StatTile
          icon={<BatteryIcon size={12} strokeWidth={1.5} aria-hidden="true" />}
          label="Battery"
          value={!info ? "--" : battery === null ? "AC" : `${battery}%`}
          detail={batteryDetail}
          level={battery === null ? null : battery / 100}
          critical={battery !== null && !onAc && battery < BATTERY_LOW_THRESHOLD}
        />
        <StatTile
          icon={<Cpu size={12} strokeWidth={1.5} aria-hidden="true" />}
          label="CPU"
          value={info ? `${Math.round(info.cpu_usage_percent)}%` : "--"}
          level={info ? info.cpu_usage_percent / 100 : null}
          critical={info !== null && info.cpu_usage_percent >= 90}
        />
        <StatTile
          icon={<MemoryStick size={12} strokeWidth={1.5} aria-hidden="true" />}
          label="RAM"
          value={info ? info.ram_used_gb.toFixed(1) : "--"}
          detail={info ? `/ ${info.ram_total_gb.toFixed(1)} GB` : ""}
          level={ramLevel}
          critical={ramLevel !== null && ramLevel >= 0.9}
        />
      </div>

      <VolumeRow />
    </section>
  );
}
