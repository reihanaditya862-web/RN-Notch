import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { parseTypedHex } from "../../lib/color";
import { ACCENT_SWATCHES, THEMES, THEME_ORDER } from "../../lib/theme";
import type { ThemePreset } from "../../lib/types";
import { useNotchStore } from "../../stores/notchStore";
import { FOCUS_RING } from "../pages/PageHeader";

/** A tiny capsule drawn in a theme's own fill, edge and accent. */
function ThemeSample({ preset }: { preset: ThemePreset }) {
  const theme = THEMES[preset];
  return (
    <span
      aria-hidden="true"
      className="relative flex h-[18px] w-[64px] items-center justify-between overflow-hidden rounded-full px-2"
      style={{
        background: `rgb(${theme.fill} / ${preset === "liquid-glass" ? 0.72 : 1})`,
        boxShadow: `inset 0 0 0 1px ${theme.edge}${preset === "liquid-glass" ? ", inset 0 1px 0 rgb(255 255 255 / 0.22)" : ""}`,
        backgroundImage:
          preset === "paddock-telemetry"
            ? "linear-gradient(rgb(255 255 255 / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.06) 1px, transparent 1px)"
            : undefined,
        backgroundSize: preset === "paddock-telemetry" ? "6px 6px" : undefined,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: theme.accent }} />
      <span className="h-[3px] w-7 rounded-full bg-white/70" />
    </span>
  );
}

/** Liquid Glass, Pure Obsidian or Paddock Telemetry, as three small cards. */
export function ThemePresetPicker() {
  const current = useNotchStore((store) => store.settings.theme_preset);
  const setThemePreset = useNotchStore((store) => store.setThemePreset);

  return (
    <div role="radiogroup" aria-label="Theme" className="grid h-[50px] grid-cols-3 gap-1.5">
      {THEME_ORDER.map((preset) => {
        const isSelected = preset === current;
        return (
          <button
            key={preset}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => setThemePreset(preset)}
            className={[
              "flex flex-col items-center justify-center gap-1.5 rounded-xl border transition-colors duration-100",
              FOCUS_RING,
              isSelected
                ? "border-notch-border-active bg-notch-surface-hover text-notch-primary"
                : "border-transparent bg-notch-surface text-notch-secondary hover:text-notch-primary",
            ].join(" ")}
          >
            <ThemeSample preset={preset} />
            <span className="text-[10px] leading-none font-medium">{THEMES[preset].label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The accent: the theme's own (first swatch), a quick pick, or any "#RRGGBB"
 * typed in. It colours switches, highlights and the glass sheen.
 */
export function AccentPicker() {
  const custom = useNotchStore((store) => store.settings.custom_accent_hex);
  const preset = useNotchStore((store) => store.settings.theme_preset);
  const setCustomAccent = useNotchStore((store) => store.setCustomAccent);
  const themeAccent = THEMES[preset].accent;
  const current = custom ?? themeAccent;

  // The text field may hold a half-typed value; it follows the accent otherwise.
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current]);

  const swatches: Array<{ value: string | null; color: string; label: string }> = [
    { value: null, color: themeAccent, label: `Theme accent ${themeAccent}` },
    ...ACCENT_SWATCHES.filter((color) => color !== themeAccent).map((color) => ({
      value: color,
      color,
      label: color,
    })),
  ];

  return (
    <div role="group" aria-label="Accent colour" className="flex h-7 items-center gap-1.5">
      {swatches.map((swatch) => {
        const isSelected = swatch.value === custom;
        return (
          <button
            key={swatch.label}
            type="button"
            onClick={() => setCustomAccent(swatch.value)}
            aria-label={swatch.label}
            aria-pressed={isSelected}
            title={swatch.value === null ? "Theme accent" : swatch.color}
            className={[
              "relative flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full transition-transform duration-100 hover:scale-110",
              FOCUS_RING,
              isSelected ? "ring-2 ring-white/80 ring-offset-1 ring-offset-black" : "",
            ].join(" ")}
            style={{ background: swatch.color }}
          >
            {swatch.value === null && (
              <span className="text-[8px] leading-none font-bold text-black/70" aria-hidden="true">
                A
              </span>
            )}
            {isSelected && swatch.value !== null && (
              <Check size={11} strokeWidth={3} aria-hidden="true" className="text-black/70" />
            )}
          </button>
        );
      })}
      <span className="flex-1" />
      <input
        type="text"
        value={draft}
        onChange={(event) => {
          const text = event.currentTarget.value;
          setDraft(text);
          const typed = parseTypedHex(text);
          if (typed) setCustomAccent(typed);
        }}
        // Leaving the field with something incomplete in it restores the accent.
        onBlur={() => setDraft(current)}
        maxLength={7}
        spellCheck={false}
        autoComplete="off"
        aria-label="Accent hex value"
        aria-invalid={parseTypedHex(draft) === null}
        className={[
          "h-7 w-[76px] shrink-0 rounded-lg border bg-notch-surface px-2 text-center",
          "font-mono text-[11px] leading-none text-notch-primary uppercase outline-none transition-colors duration-100",
          parseTypedHex(draft) === null ? "border-notch-error" : "border-transparent focus:border-notch-border-active",
        ].join(" ")}
      />
    </div>
  );
}
