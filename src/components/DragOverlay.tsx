import { FolderDown, FolderX } from "lucide-react";
import { SHELF_MAX_FILES } from "../lib/constants";
import { useNotchStore } from "../stores/notchStore";

/**
 * Shown while a file is dragged over the capsule: a pulsing dashed cyan frame
 * and how much room is left on the shelf.
 */
export function DragOverlay() {
  const count = useNotchStore((store) => store.shelfFiles.length);
  const free = SHELF_MAX_FILES - count;
  const isFull = free <= 0;

  return (
    <div className="h-full w-full p-1.5">
      <div
        className={[
          "flex h-full w-full flex-col items-center justify-center gap-1 rounded-[18px] border-2 border-dashed",
          isFull ? "border-notch-error text-notch-error" : "notch-drop-pulse border-notch-info",
        ].join(" ")}
      >
        {isFull ? (
          <FolderX size={18} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <FolderDown
            size={18}
            strokeWidth={1.5}
            aria-hidden="true"
            className="text-notch-info"
          />
        )}
        <p className="text-[13px] leading-[18px] font-medium text-notch-primary">
          {isFull ? "Shelf full" : "Drop files here"}
        </p>
        <p className="font-mono text-[10px] leading-3 tracking-[-0.02em] text-notch-tertiary">
          {isFull
            ? `remove a file first (${SHELF_MAX_FILES}/${SHELF_MAX_FILES})`
            : `${free} of ${SHELF_MAX_FILES} slots free`}
        </p>
      </div>
    </div>
  );
}
