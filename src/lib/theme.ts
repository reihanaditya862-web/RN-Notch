import type { AppSettings, ThemePreset } from "./types";

/**
 * The three looks of the capsule. Each sets the capsule's fill, its edge and
 * a default accent; the user may pick their own accent on top of any of them.
 *
 * - Liquid Glass: dark tinted glass. The window is transparent, so what lies
 *   behind the capsule shows through faintly; a specular rim and a sheen on
 *   the surfaces inside make it read as glass. (A real blur of the desktop
 *   is not something a WebView can do: CSS \`backdrop-filter\` only sees the
 *   page's own content, never the windows behind it.)
 * - Pure Obsidian: solid OLED black, solid surfaces, hairline edges only.
 * - Paddock Telemetry: carbon black with a fine grid, racing red, and the
 *   Formula1 face on headings.
 */
export interface ThemeSpec {
  label: string;
  /** Fill colour of the capsule, as "r g b". */
  fill: string;
  /** Opacity of the fill for the user's opacity setting (0.7-1). */
  fillAlpha: (opacity: number) => number;
  /** The outline hairline, at rest and with the cursor on the capsule. */
  edge: string;
  edgeHover: string;
  accent: string;
}

export const THEMES: Record<ThemePreset, ThemeSpec> = {
  "liquid-glass": {
    label: "Liquid Glass",
    fill: "12 14 20",
    // 95% (the default) gives 0.76: glass, yet white text stays readable.
    fillAlpha: (opacity) => Math.min(0.9, opacity * 0.8),
    edge: "rgb(255 255 255 / 0.16)",
    edgeHover: "rgb(255 255 255 / 0.24)",
    accent: "#34D399",
  },
  "pure-obsidian": {
    label: "Pure Obsidian",
    fill: "0 0 0",
    fillAlpha: () => 1,
    edge: "rgb(255 255 255 / 0.06)",
    edgeHover: "rgb(255 255 255 / 0.12)",
    accent: "#0A84FF",
  },
  "paddock-telemetry": {
    label: "Paddock",
    fill: "9 10 13",
    fillAlpha: (opacity) => opacity,
    edge: "rgb(255 255 255 / 0.1)",
    edgeHover: "rgb(255 255 255 / 0.18)",
    accent: "#E10600",
  },
};

export const THEME_ORDER: ThemePreset[] = ["liquid-glass", "pure-obsidian", "paddock-telemetry"];

/** Quick accent picks in Settings; the theme's own accent is offered first. */
export const ACCENT_SWATCHES = ["#34D399", "#0A84FF", "#BF5AF2", "#FF9F0A", "#E10600", "#FF375F"] as const;

export function themeOf(settings: AppSettings): ThemeSpec {
  return THEMES[settings.theme_preset] ?? THEMES["liquid-glass"];
}

/** The accent in effect: the user's own, or the theme's. */
export function accentOf(settings: AppSettings): string {
  return settings.custom_accent_hex ?? themeOf(settings).accent;
}

/** The capsule's fill for the current theme and opacity. */
export function capsuleFill(settings: AppSettings): string {
  const theme = themeOf(settings);
  return `rgb(${theme.fill} / ${theme.fillAlpha(settings.opacity)})`;
}

/**
 * Puts the theme on the document: \`data-theme\` for the stylesheet, the
 * accent tokens (\`--accent-primary\`, \`--accent-soft\`, \`--accent-glow\`), and
 * \`data-inner-glow\` so the glass sheen can leave out colour when the inner
 * glow is switched off.
 */
export function applyThemeToDocument(settings: AppSettings): void {
  const root = document.documentElement;
  const accent = accentOf(settings);
  root.dataset.theme = settings.theme_preset;
  root.dataset.innerGlow = settings.inner_gradient_enabled ? "on" : "off";
  root.style.setProperty("--accent-primary", accent);
  root.style.setProperty("--accent-soft", `color-mix(in srgb, ${accent} 22%, transparent)`);
  root.style.setProperty("--accent-glow", `color-mix(in srgb, ${accent} 45%, transparent)`);
}
