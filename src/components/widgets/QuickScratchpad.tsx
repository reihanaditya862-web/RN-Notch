import { PenLine, X } from "lucide-react";
import { useNotchStore } from "../../stores/notchStore";

/**
 * One-line sticky note. Every keystroke is saved to localStorage through the
 * store's persist middleware, so the note survives a restart.
 */
export function QuickScratchpad() {
  const text = useNotchStore((store) => store.scratchpadText);
  const setScratchpadText = useNotchStore((store) => store.setScratchpadText);

  return (
    <label
      className={[
        "flex h-7 items-center gap-2 rounded-lg border border-transparent bg-notch-surface px-2.5",
        "transition-colors duration-100 focus-within:border-notch-border-active",
      ].join(" ")}
    >
      <PenLine
        size={14}
        strokeWidth={1.5}
        aria-hidden="true"
        className="shrink-0 text-notch-tertiary"
      />
      <input
        type="text"
        value={text}
        onChange={(event) => setScratchpadText(event.currentTarget.value)}
        placeholder="Quick note / paste link..."
        aria-label="Quick note"
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-[12px] leading-4 text-notch-primary outline-none placeholder:text-notch-tertiary"
      />
      {text !== "" && (
        <button
          type="button"
          onClick={() => setScratchpadText("")}
          aria-label="Clear note"
          title="Clear note"
          className={[
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-notch-tertiary",
            "transition-colors duration-100 hover:text-notch-primary",
            "outline-none focus-visible:outline-2 focus-visible:outline-notch-focus",
          ].join(" ")}
        >
          <X size={12} strokeWidth={1.5} aria-hidden="true" />
        </button>
      )}
    </label>
  );
}
