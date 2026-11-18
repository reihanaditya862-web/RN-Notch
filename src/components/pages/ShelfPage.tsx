import { invoke, isTauri } from "@tauri-apps/api/core";
import { ClipboardList, X } from "lucide-react";
import { toastAlert } from "../../lib/alerts";
import { copyText } from "../../lib/clipboard";
import type { ClipItem } from "../../lib/types";
import { useNotchStore } from "../../stores/notchStore";
import { ErrorBoundary } from "../ErrorBoundary";
import { FileShelf } from "../widgets/FileShelf";
import { QuickScratchpad } from "../widgets/QuickScratchpad";
import { FOCUS_RING, PageHeader, SectionLabel } from "./PageHeader";

function ago(time: number): string {
  const minutes = Math.floor((Date.now() - time) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

async function copyBack(item: ClipItem): Promise<void> {
  let copied = false;
  if (isTauri()) {
    copied = await invoke("write_clipboard_text", { text: item.text }).then(
      () => true,
      () => false,
    );
  }
  if (!copied) copied = await copyText(item.text);
  useNotchStore
    .getState()
    .pushAlert(
      copied
        ? toastAlert(
            "Copied",
            item.text.length > 48 ? `${item.text.slice(0, 47)}…` : item.text,
            item.color ? { type: "swatch", color: item.color } : { type: "symbol", name: "copy" },
            "success",
          )
        : toastAlert("Could not copy", "The clipboard is busy", { type: "symbol", name: "error" }, "warning"),
    );
}

/** The last ten texts and colour codes copied anywhere; click one to copy it again. */
function ClipboardHistory() {
  const items = useNotchStore((store) => store.clipItems);
  const removeClip = useNotchStore((store) => store.removeClip);
  const clearClips = useNotchStore((store) => store.clearClips);

  return (
    <section aria-label="Clipboard history" className="flex min-h-0 flex-1 flex-col gap-1">
      <SectionLabel
        action={
          items.length > 0 && (
            <button
              type="button"
              onClick={clearClips}
              className={`text-[10px] leading-3 text-notch-tertiary hover:text-notch-primary ${FOCUS_RING}`}
            >
              Clear
            </button>
          )
        }
      >
        Clipboard
      </SectionLabel>
      {items.length === 0 ? (
        <p className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-notch-border text-center text-[11px] leading-4 text-notch-tertiary">
          <ClipboardList size={14} strokeWidth={1.5} aria-hidden="true" />
          Copy text or a colour code anywhere - it shows up here
        </p>
      ) : (
        <ul data-scroll className="notch-scroll -mx-1 flex min-h-0 flex-1 flex-col gap-0.5 px-1">
          {items.map((item) => (
            <li key={item.id} className="group relative flex h-[24px] shrink-0 items-center">
              <button
                type="button"
                onClick={() => void copyBack(item)}
                title={`Copy again:\n${item.text.slice(0, 300)}`}
                className={[
                  "flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left",
                  "transition-colors duration-100 hover:bg-notch-surface",
                  FOCUS_RING,
                ].join(" ")}
              >
                {item.color ? (
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 rounded-[4px] border border-white/25"
                    style={{ backgroundColor: item.color }}
                  />
                ) : (
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/25" />
                )}
                <span
                  className={`min-w-0 flex-1 truncate text-[12px] leading-4 text-notch-primary ${item.color ? "font-mono" : ""}`}
                >
                  {item.text.replace(/\s+/g, " ")}
                </span>
                <span className="shrink-0 text-[10px] leading-3 text-notch-tertiary group-hover:invisible">
                  {ago(item.copied_at)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => removeClip(item.id)}
                aria-label="Remove from history"
                title="Remove"
                className={`absolute right-1 hidden h-4 w-4 items-center justify-center rounded-full text-notch-tertiary group-hover:flex hover:text-notch-primary ${FOCUS_RING}`}
              >
                <X size={10} strokeWidth={2} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Clipboard history, the file shelf and the quick note. */
export function ShelfPage({ onCollapse }: { onCollapse: () => void }) {
  const widgets = useNotchStore((store) => store.settings.active_widgets);
  const hasHistory = useNotchStore((store) => store.settings.features.clipboard_history);

  return (
    <div className="flex h-full flex-col gap-1.5">
      <PageHeader title="Clipboard & shelf" onCollapse={onCollapse} />
      {hasHistory ? (
        <ErrorBoundary label="Clipboard history">
          <ClipboardHistory />
        </ErrorBoundary>
      ) : (
        <span className="flex-1" />
      )}
      {widgets.file_shelf && (
        <div className="h-[50px] shrink-0">
          <ErrorBoundary label="File shelf">
            <FileShelf />
          </ErrorBoundary>
        </div>
      )}
      {widgets.scratchpad && (
        <div className="h-7 shrink-0">
          <ErrorBoundary label="Quick note">
            <QuickScratchpad />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}
