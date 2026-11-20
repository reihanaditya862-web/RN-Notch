import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  Bell,
  Blend,
  ClipboardList,
  Cpu,
  ExternalLink,
  Flag,
  MicVocal,
  Moon,
  Music,
  Palette,
  Paperclip,
  PenLine,
  Power,
  RotateCcw,
  Scaling,
  SlidersHorizontal,
  Sparkles,
  SunMoon,
  Volume2,
  Wifi,
  X,
} from "lucide-react";
import { useAutostart } from "../hooks/useAutostart";
import { hexFromHue, hueFromHex, parseTypedHex } from "../lib/color";
import {
  GLOW_END_DEFAULT,
  GLOW_START_DEFAULT,
  OPACITY_MAX,
  OPACITY_MIN,
  SCALE_OPTIONS,
} from "../lib/constants";
import type { ActiveWidgets, DisplayMode, Features } from "../lib/types";
import { useNotchStore } from "../stores/notchStore";
import { DigitText } from "./widgets/DigitText";

const FOCUS_RING =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-notch-focus";

interface ModeOptionProps {
  mode: DisplayMode;
  label: string;
  isSelected: boolean;
  onSelect: (mode: DisplayMode) => void;
}

/** One of the two display modes, with a tiny picture of the screen's top edge. */
function ModeOption({ mode, label, isSelected, onSelect }: ModeOptionProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      onClick={() => onSelect(mode)}
      className={[
        "flex flex-col items-center justify-center gap-1.5 rounded-lg border transition-colors duration-100",
        FOCUS_RING,
        isSelected
          ? "border-notch-border-active bg-notch-surface-hover text-notch-primary"
          : "border-transparent bg-notch-surface text-notch-secondary hover:text-notch-primary",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className="relative h-[18px] w-14 overflow-hidden rounded-t-[5px] border border-b-0 border-white/20 bg-black/40"
      >
        <span
          className={[
            "absolute left-1/2 w-5 -translate-x-1/2 bg-current",
            mode === "island" ? "top-[3px] h-[5px] rounded-full" : "top-0 h-[7px] rounded-b-[4px]",
          ].join(" ")}
        />
      </span>
      <span className="text-[12px] leading-4 font-medium">{label}</span>
    </button>
  );
}

interface ToggleRowProps {
  icon: ReactNode;
  label: string;
  isOn: boolean;
  onChange: (isOn: boolean) => void;
  /** Colour of the switch when on. */
  tone?: "default" | "dnd";
}

/** A labelled switch; the whole row is clickable. */
function ToggleRow({ icon, label, isOn, onChange, tone = "default" }: ToggleRowProps) {
  const onColour = tone === "dnd" ? "bg-notch-dnd" : "bg-notch-playing";

  return (
    <label className="flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-lg bg-notch-surface px-2.5">
      <span aria-hidden="true" className="flex shrink-0 text-notch-tertiary">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-notch-primary">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label={label}
        onClick={() => onChange(!isOn)}
        className={[
          "relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150",
          FOCUS_RING,
          isOn ? onColour : "bg-white/15",
        ].join(" ")}
      >
        <span
          aria-hidden="true"
          className={[
            "absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-notch-primary transition-transform duration-150",
            isOn ? "translate-x-3" : "translate-x-0",
          ].join(" ")}
        />
      </button>
    </label>
  );
}


interface SettingsModalProps {
  onClose: () => void;
}

/** Which of the two glow colours a control refers to. */
type GlowEnd = "start" | "end";

/**
 * The two colours of the glow inside the capsule.
 *
 * Top row: one chip per colour (pick which one to edit) and a reset button.
 * Bottom row: a hue slider and a "#RRGGBB" field for the colour being edited.
 * Everything is inline - no system colour dialog, which would open a separate
 * window and count as a click outside the panel. Each change goes straight to
 * the store, so the capsule itself is the live preview.
 */
function GlowColors() {
  const start = useNotchStore((store) => store.settings.glow_start);
  const end = useNotchStore((store) => store.settings.glow_end);
  const setGlowColor = useNotchStore((store) => store.setGlowColor);
  const resetGlowColors = useNotchStore((store) => store.resetGlowColors);

  const [editing, setEditing] = useState<GlowEnd>("start");
  const color = editing === "start" ? start : end;
  const isDefault = start === GLOW_START_DEFAULT && end === GLOW_END_DEFAULT;

  // What is in the text field. It may be half-typed, so it is kept apart
  // from the colour and follows it whenever the colour changes elsewhere.
  const [draft, setDraft] = useState(color);
  useEffect(() => setDraft(color), [color]);

  const handleDraft = (text: string) => {
    setDraft(text);
    const typed = parseTypedHex(text);
    if (typed) setGlowColor(editing, typed);
  };

  const chips: Array<{ which: GlowEnd; label: string; value: string }> = [
    { which: "start", label: "Start", value: start },
    { which: "end", label: "End", value: end },
  ];

  return (
    <div role="group" aria-label="Glow colours" className="flex flex-col gap-2">
      <div className="flex h-7 items-center gap-2">
        <Palette
          size={14}
          strokeWidth={1.5}
          aria-hidden="true"
          className="mx-1 shrink-0 text-notch-tertiary"
        />
        <span className="w-14 shrink-0 text-[12px] leading-4 text-notch-primary">Glow</span>

        <div
          role="radiogroup"
          aria-label="Colour to edit"
          className="grid h-full min-w-0 flex-1 grid-cols-2 gap-1 rounded-lg bg-notch-surface p-1"
        >
          {chips.map((chip) => {
            const isSelected = chip.which === editing;
            return (
              <button
                key={chip.which}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={`${chip.label} colour, ${chip.value}`}
                onClick={() => setEditing(chip.which)}
                className={[
                  "flex min-w-0 items-center justify-center gap-1.5 rounded-md text-[11px] leading-none font-medium",
                  "transition-colors duration-100",
                  FOCUS_RING,
                  isSelected
                    ? "bg-notch-surface-hover text-notch-primary"
                    : "text-notch-secondary hover:text-notch-primary",
                ].join(" ")}
              >
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-full border border-white/25"
                  style={{ backgroundColor: chip.value }}
                />
                <span>{chip.label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={resetGlowColors}
          disabled={isDefault}
          aria-label="Reset glow colours to blue and purple"
          title="Reset to the default blue and purple"
          className={[
            "flex h-7 shrink-0 items-center gap-1 rounded-lg bg-notch-surface px-2 text-[11px] leading-none font-medium",
            "text-notch-secondary transition-colors duration-100 hover:text-notch-primary",
            "disabled:pointer-events-none disabled:opacity-40",
            FOCUS_RING,
          ].join(" ")}
        >
          <RotateCcw size={12} strokeWidth={1.5} aria-hidden="true" />
          Reset
        </button>
      </div>

      <div className="flex h-7 items-center gap-2">
        <span
          aria-hidden="true"
          className="mx-1 h-3.5 w-3.5 shrink-0 rounded-full border border-white/25"
          style={{ backgroundColor: color }}
        />
        <span className="w-14 shrink-0 text-[12px] leading-4 text-notch-secondary">
          {editing === "start" ? "Start" : "End"}
        </span>
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={hueFromHex(color)}
          onChange={(event) => setGlowColor(editing, hexFromHue(Number(event.currentTarget.value)))}
          aria-label={`Hue of the ${editing} colour`}
          className="notch-range notch-range-hue min-w-0 flex-1"
        />
        <input
          type="text"
          value={draft}
          onChange={(event) => handleDraft(event.currentTarget.value)}
          // Leaving the field with something incomplete in it restores the colour.
          onBlur={() => setDraft(color)}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-label={`Hex value of the ${editing} colour`}
          aria-invalid={parseTypedHex(draft) === null}
          className={[
            "h-7 w-[76px] shrink-0 rounded-lg border bg-notch-surface px-2 text-center",
            "font-mono text-[11px] leading-none text-notch-primary uppercase outline-none",
            "transition-colors duration-100",
            parseTypedHex(draft) === null
              ? "border-notch-error"
              : "border-transparent focus:border-notch-border-active",
          ].join(" ")}
        />
      </div>
    </div>
  );
}


const WIDGETS: Array<{ key: keyof ActiveWidgets; label: string; icon: ReactNode }> = [
  { key: "media", label: "Media player", icon: <Music size={14} strokeWidth={1.5} /> },
  { key: "system", label: "System monitor", icon: <Cpu size={14} strokeWidth={1.5} /> },
  { key: "file_shelf", label: "File shelf", icon: <Paperclip size={14} strokeWidth={1.5} /> },
  { key: "scratchpad", label: "Quick note", icon: <PenLine size={14} strokeWidth={1.5} /> },
];

const FEATURES: Array<{ key: keyof Features; label: string; icon: ReactNode }> = [
  { key: "notifications", label: "Notifications", icon: <Bell size={14} strokeWidth={1.5} /> },
  { key: "hardware_alerts", label: "Hardware pop-ups", icon: <Wifi size={14} strokeWidth={1.5} /> },
  {
    key: "clipboard_history",
    label: "Clipboard history",
    icon: <ClipboardList size={14} strokeWidth={1.5} />,
  },
  { key: "audio_mixer", label: "Audio mixer", icon: <SlidersHorizontal size={14} strokeWidth={1.5} /> },
  { key: "f1_hub", label: "F1 Race Hub", icon: <Flag size={14} strokeWidth={1.5} /> },
  { key: "lyrics", label: "Live lyrics", icon: <MicVocal size={14} strokeWidth={1.5} /> },
  { key: "system_hud", label: "System HUD", icon: <Volume2 size={14} strokeWidth={1.5} /> },
];

type NotificationAccess = "allowed" | "denied" | "unspecified" | "unavailable";

/** Asks Rust whether Windows lets the app read notifications. */
function useNotificationAccess(enabled: boolean): NotificationAccess | null {
  const [access, setAccess] = useState<NotificationAccess | null>(null);
  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let disposed = false;
    const check = () =>
      invoke<NotificationAccess>("notification_access")
        .then((status) => {
          if (!disposed) setAccess(status);
        })
        .catch(() => {
          if (!disposed) setAccess("unavailable");
        });
    void check();
    // The user may be flipping the switch in Windows Settings right now.
    const timer = window.setInterval(() => void check(), 3000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return access;
}

/** Notification access from Windows, with a way to fix it when it is missing. */
function NotificationAccessRow() {
  const enabled = useNotchStore((store) => store.settings.features.notifications);
  const access = useNotificationAccess(enabled);
  if (!enabled || access === null || access === "allowed") return null;

  const message =
    access === "unavailable"
      ? "This Windows does not share notifications"
      : "Notification access is off in Windows";

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-notch-border-hover px-2.5">
      <Bell size={13} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-notch-charging" />
      <span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-notch-secondary">{message}</span>
      {access !== "unavailable" && (
        <button
          type="button"
          onClick={() =>
            void invoke("open_notification_settings").catch((error: unknown) =>
              console.warn("[Settings] open_notification_settings failed:", error),
            )
          }
          className={[
            "flex h-6 shrink-0 items-center gap-1 rounded-md bg-notch-surface px-2 text-[11px] leading-none font-medium",
            "text-notch-primary transition-colors duration-100 hover:bg-notch-surface-hover",
            FOCUS_RING,
          ].join(" ")}
        >
          Open Windows settings
          <ExternalLink size={11} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

type Tab = "general" | "modules";

function GeneralTab() {
  const settings = useNotchStore((store) => store.settings);
  const setDisplayMode = useNotchStore((store) => store.setDisplayMode);
  const setOpacity = useNotchStore((store) => store.setOpacity);
  const setScale = useNotchStore((store) => store.setScale);
  const setVisualEffect = useNotchStore((store) => store.setVisualEffect);

  const opacityPercent = Math.round(settings.opacity * 100);
  const opacityMin = Math.round(OPACITY_MIN * 100);
  const opacityMax = Math.round(OPACITY_MAX * 100);
  const opacityFill = ((opacityPercent - opacityMin) / (opacityMax - opacityMin)) * 100;

  return (
    <>
      <div role="radiogroup" aria-label="Display mode" className="grid h-14 grid-cols-2 gap-1.5">
        <ModeOption
          mode="island"
          label="Dynamic Island"
          isSelected={settings.display_mode === "island"}
          onSelect={setDisplayMode}
        />
        <ModeOption
          mode="notch"
          label="Notch"
          isSelected={settings.display_mode === "notch"}
          onSelect={setDisplayMode}
        />
      </div>

      <div className="flex h-7 items-center gap-2">
        <Scaling size={14} strokeWidth={1.5} aria-hidden="true" className="mx-1 shrink-0 text-notch-tertiary" />
        <span className="w-14 shrink-0 text-[12px] leading-4 text-notch-primary">Size</span>
        <div
          role="radiogroup"
          aria-label="Size"
          className="grid h-full min-w-0 flex-1 grid-cols-5 gap-1 rounded-lg bg-notch-surface p-1"
        >
          {SCALE_OPTIONS.map((option) => {
            const isSelected = option.value === settings.scale;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setScale(option.value)}
                className={[
                  "rounded-md text-[11px] leading-none font-medium transition-colors duration-100",
                  FOCUS_RING,
                  isSelected
                    ? "bg-notch-surface-hover text-notch-primary"
                    : "text-notch-secondary hover:text-notch-primary",
                ].join(" ")}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="flex h-[22px] items-center gap-2">
        <Blend size={14} strokeWidth={1.5} aria-hidden="true" className="mx-1 shrink-0 text-notch-tertiary" />
        <span className="w-14 shrink-0 text-[12px] leading-4 text-notch-primary">Opacity</span>
        <input
          type="range"
          min={opacityMin}
          max={opacityMax}
          step={1}
          value={opacityPercent}
          onChange={(event) => setOpacity(Number(event.currentTarget.value) / 100)}
          aria-label="Capsule opacity"
          className="notch-range min-w-0 flex-1"
          style={{ "--range-fill": `${opacityFill}%` } as CSSProperties}
        />
        <span
          aria-hidden="true"
          className="w-11 shrink-0 text-right font-display text-[12px] leading-none font-bold text-notch-secondary"
        >
          <DigitText text={`${opacityPercent}%`} />
        </span>
      </label>

      <GlowColors />

      <div role="group" aria-label="Capsule effects" className="grid grid-cols-2 gap-1.5">
        <ToggleRow
          icon={<Sparkles size={14} strokeWidth={1.5} />}
          label="Neon border"
          isOn={settings.neon_border_enabled}
          onChange={(isOn) => setVisualEffect("neon_border_enabled", isOn)}
        />
        <ToggleRow
          icon={<SunMoon size={14} strokeWidth={1.5} />}
          label="Inner glow"
          isOn={settings.inner_gradient_enabled}
          onChange={(isOn) => setVisualEffect("inner_gradient_enabled", isOn)}
        />
      </div>
    </>
  );
}

function ModulesTab() {
  const settings = useNotchStore((store) => store.settings);
  const setWidgetActive = useNotchStore((store) => store.setWidgetActive);
  const setFeature = useNotchStore((store) => store.setFeature);
  const toggleDnd = useNotchStore((store) => store.toggleDnd);
  const autostart = useAutostart();

  return (
    <>
      <div role="group" aria-label="Widgets" className="grid grid-cols-2 gap-1.5">
        {WIDGETS.map(({ key, label, icon }) => (
          <ToggleRow
            key={key}
            icon={icon}
            label={label}
            isOn={settings.active_widgets[key]}
            onChange={(isOn) => setWidgetActive(key, isOn)}
          />
        ))}
        {FEATURES.map(({ key, label, icon }) => (
          <ToggleRow
            key={key}
            icon={icon}
            label={label}
            isOn={settings.features[key]}
            onChange={(isOn) => setFeature(key, isOn)}
          />
        ))}
        <ToggleRow
          icon={<Moon size={14} strokeWidth={1.5} />}
          label="Do Not Disturb"
          isOn={settings.dnd_enabled}
          onChange={toggleDnd}
          tone="dnd"
        />
        <ToggleRow
          icon={<Power size={14} strokeWidth={1.5} />}
          label="Start with Windows"
          isOn={autostart.isEnabled ?? false}
          onChange={autostart.setEnabled}
        />
      </div>
      <NotificationAccessRow />
    </>
  );
}

/**
 * Settings panel, shown inside the capsule (420x380), in two tabs:
 * - General: display mode, size, opacity, the glow colours, and switches
 *   for the neon border and the inner glow.
 * - Modules: which widgets and modules are on, Do Not Disturb and Start
 *   with Windows. A module switched off also stops its background work.
 *
 * Every control changes the store at once, so the capsule previews it live;
 * `useSettingsSync` writes the result to `%APPDATA%\rn-notch\settings.json`.
 * "Start with Windows" is the exception: it is Windows' own startup entry,
 * switched through `useAutostart`.
 */
export function SettingsModal({ onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("general");

  return (
    <div role="dialog" aria-label="Settings" className="flex h-full w-full flex-col gap-2 p-3 *:shrink-0">
      <header className="flex h-6 items-center gap-2">
        <h2 className="text-[13px] leading-[18px] font-medium text-notch-primary">Settings</h2>
        <div role="tablist" aria-label="Settings sections" className="ml-1 flex h-6 gap-0.5 rounded-lg bg-notch-surface p-0.5">
          {(["general", "modules"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={[
                "rounded-md px-2.5 text-[11px] leading-none font-medium transition-colors duration-100",
                FOCUS_RING,
                tab === value ? "bg-notch-surface-hover text-notch-primary" : "text-notch-secondary hover:text-notch-primary",
              ].join(" ")}
            >
              {value === "general" ? "General" : "Modules"}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          title="Close (Esc)"
          className={[
            "flex h-5 w-5 items-center justify-center rounded-md text-notch-secondary",
            "transition-[color,scale] duration-100 hover:scale-110 hover:text-notch-primary active:scale-95",
            FOCUS_RING,
          ].join(" ")}
        >
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>

      {tab === "general" ? <GeneralTab /> : <ModulesTab />}

      <span className="flex-1" />
      <p className="truncate font-mono text-[10px] leading-3 tracking-[-0.02em] text-notch-tertiary">
        Saved to %APPDATA%\rn-notch\settings.json
      </p>
    </div>
  );
}
