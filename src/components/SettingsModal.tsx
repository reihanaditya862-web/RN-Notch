import type { CSSProperties, ReactNode } from "react";
import { Blend, Cpu, Moon, Music, Paperclip, PenLine, Power, Scaling, X } from "lucide-react";
import { useAutostart } from "../hooks/useAutostart";
import { OPACITY_MAX, OPACITY_MIN, SCALE_OPTIONS } from "../lib/constants";
import type { ActiveWidgets, DisplayMode } from "../lib/types";
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

const WIDGETS: Array<{ key: keyof ActiveWidgets; label: string; icon: ReactNode }> = [
  { key: "media", label: "Media player", icon: <Music size={14} strokeWidth={1.5} /> },
  { key: "system", label: "System monitor", icon: <Cpu size={14} strokeWidth={1.5} /> },
  { key: "file_shelf", label: "File shelf", icon: <Paperclip size={14} strokeWidth={1.5} /> },
  { key: "scratchpad", label: "Quick note", icon: <PenLine size={14} strokeWidth={1.5} /> },
];

interface SettingsModalProps {
  onClose: () => void;
}

/**
 * Settings panel, shown inside the capsule (420x308): display mode, size,
 * opacity, which widgets are on, Do Not Disturb and Start with Windows.
 *
 * Every control changes the store at once, so the capsule previews it live;
 * `useSettingsSync` writes the result to `%APPDATA%\rn-notch\settings.json`.
 * "Start with Windows" is the exception: it is Windows' own startup entry,
 * switched through `useAutostart`.
 */
export function SettingsModal({ onClose }: SettingsModalProps) {
  const settings = useNotchStore((store) => store.settings);
  const setDisplayMode = useNotchStore((store) => store.setDisplayMode);
  const setOpacity = useNotchStore((store) => store.setOpacity);
  const setScale = useNotchStore((store) => store.setScale);
  const setWidgetActive = useNotchStore((store) => store.setWidgetActive);
  const toggleDnd = useNotchStore((store) => store.toggleDnd);
  const autostart = useAutostart();

  const opacityPercent = Math.round(settings.opacity * 100);
  const opacityMin = Math.round(OPACITY_MIN * 100);
  const opacityMax = Math.round(OPACITY_MAX * 100);
  const opacityFill = ((opacityPercent - opacityMin) / (opacityMax - opacityMin)) * 100;

  return (
    <div
      role="dialog"
      aria-label="Settings"
      className="flex h-full w-full flex-col gap-2 p-3 *:shrink-0"
    >
      <header className="flex h-6 items-center justify-between">
        <h2 className="text-[13px] leading-[18px] font-medium text-notch-primary">Settings</h2>
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
        <Scaling
          size={14}
          strokeWidth={1.5}
          aria-hidden="true"
          className="mx-1 shrink-0 text-notch-tertiary"
        />
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
        <Blend
          size={14}
          strokeWidth={1.5}
          aria-hidden="true"
          className="mx-1 shrink-0 text-notch-tertiary"
        />
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
      </div>

      <div className="grid grid-cols-2 gap-1.5">
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

      <p className="truncate font-mono text-[10px] leading-3 tracking-[-0.02em] text-notch-tertiary">
        Saved to %APPDATA%\rn-notch\settings.json
      </p>
    </div>
  );
}
