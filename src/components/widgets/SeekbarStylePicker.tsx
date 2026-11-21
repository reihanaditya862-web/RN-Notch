import type { SeekbarStyle } from "../../lib/types";
import { useNotchStore } from "../../stores/notchStore";
import { FOCUS_RING } from "../pages/PageHeader";
import { squigglePath } from "./MediaSeekbar";

const OPTIONS: Array<{ value: SeekbarStyle; label: string }> = [
  { value: "standard", label: "Standard" },
  { value: "wave", label: "Wave" },
  { value: "slim", label: "Slim" },
  { value: "wavy", label: "Wavy" },
];

/** Preview size, in px: a short bar about 45% played. */
const W = 44;
const H = 14;
const MID = H / 2;

/**
 * A still drawing of a seek bar style, in `currentColor`, so the chosen one
 * lights up with its button. The played part is solid, the rest faint.
 */
function Preview({ style }: { style: SeekbarStyle }) {
  const faint = { opacity: 0.3 };
  switch (style) {
    case "standard":
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <rect x="0" y={MID - 3} width="18" height="6" rx="3" fill="currentColor" />
          <rect x="20" y="0" width="2" height={H} rx="1" fill="currentColor" />
          <rect x="24" y={MID - 1.5} width={W - 24} height="3" rx="1.5" fill="currentColor" style={faint} />
          <circle cx={W - 1.5} cy={MID} r="1.5" fill="currentColor" style={{ opacity: 0.6 }} />
        </svg>
      );
    case "wave":
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <path d={squigglePath(12, 7, 2, MID)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="20.5" cy={MID} r="3.5" fill="currentColor" />
          <rect x="26" y={MID - 1} width={W - 26} height="2" rx="1" fill="currentColor" style={faint} />
          <circle cx={W - 1.2} cy={MID} r="1.2" fill="currentColor" style={{ opacity: 0.6 }} />
        </svg>
      );
    case "slim":
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <rect x="0" y={MID - 1.5} width={W} height="3" rx="1.5" fill="currentColor" style={faint} />
          <rect x="0" y={MID - 1.5} width="21" height="3" rx="1.5" fill="currentColor" />
        </svg>
      );
    case "wavy":
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <path
            d={squigglePath(12, 12, 3.4, MID)}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <rect x="20" y={MID - 6} width="2.5" height="12" rx="1.25" fill="currentColor" />
          <rect x="25.5" y={MID - 0.9} width={W - 25.5} height="1.8" rx="0.9" fill="currentColor" style={faint} />
        </svg>
      );
  }
}

/**
 * The seek bar's look, picked from four previews: standard, wave (Material
 * You's squiggle), slim and wavy. The media player changes at once.
 */
export function SeekbarStylePicker() {
  const current = useNotchStore((store) => store.settings.seekbar_style);
  const setSeekbarStyle = useNotchStore((store) => store.setSeekbarStyle);

  return (
    <div role="radiogroup" aria-label="Seek bar style" className="grid h-full min-w-0 flex-1 grid-cols-4 gap-1">
      {OPTIONS.map((option) => {
        const isSelected = option.value === current;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={option.label}
            title={option.label}
            onClick={() => setSeekbarStyle(option.value)}
            className={[
              "flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg transition-colors duration-100",
              FOCUS_RING,
              isSelected
                ? "bg-notch-surface-hover text-notch-primary"
                : "bg-notch-surface text-notch-tertiary hover:text-notch-primary",
            ].join(" ")}
          >
            <Preview style={option.value} />
            <span className="text-[9px] leading-none font-medium">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
