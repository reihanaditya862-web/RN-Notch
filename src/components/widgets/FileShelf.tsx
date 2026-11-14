import { isTauri } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  Paperclip,
  X,
  type LucideIcon,
} from "lucide-react";
import { SHELF_MAX_FILES } from "../../lib/constants";
import type { ShelfFile } from "../../lib/types";
import { useNotchStore } from "../../stores/notchStore";

const ICONS_BY_EXTENSION: Array<[LucideIcon, string[]]> = [
  [FileImage, ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "heic"]],
  [FileAudio, ["mp3", "wav", "flac", "m4a", "ogg", "aac"]],
  [FileVideo, ["mp4", "mkv", "mov", "avi", "webm", "wmv"]],
  [FileArchive, ["zip", "rar", "7z", "tar", "gz"]],
  [FileText, ["txt", "md", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "json"]],
];

function iconFor(name: string): LucideIcon {
  const dot = name.lastIndexOf(".");
  // No extension: almost always a folder on Windows.
  if (dot <= 0) return Folder;

  const extension = name.slice(dot + 1).toLowerCase();
  return ICONS_BY_EXTENSION.find(([, extensions]) => extensions.includes(extension))?.[0] ?? File;
}

function revealInExplorer(file: ShelfFile): void {
  if (!isTauri()) return;
  revealItemInDir(file.path).catch((error: unknown) => {
    console.warn("[FileShelf] could not show the file in Explorer:", error);
  });
}

interface ShelfItemProps {
  file: ShelfFile;
  onRemove: (id: string) => void;
}

function ShelfItem({ file, onRemove }: ShelfItemProps) {
  const Icon = iconFor(file.name);

  return (
    <li className="group relative min-w-0">
      <button
        type="button"
        onClick={() => revealInExplorer(file)}
        title={`${file.path}\nClick to show in Explorer`}
        aria-label={`${file.name}. Show in Explorer`}
        className={[
          "flex h-full w-full flex-col items-center justify-center gap-1 rounded-lg px-1.5",
          "bg-notch-surface text-notch-secondary transition-colors duration-100",
          "hover:bg-notch-surface-hover hover:text-notch-primary",
          "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-notch-focus",
        ].join(" ")}
      >
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
        <span className="w-full truncate text-center text-[10px] leading-3 font-medium">
          {file.name}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onRemove(file.id)}
        aria-label={`Remove ${file.name} from the shelf`}
        title="Remove from shelf"
        className={[
          "absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full",
          "border border-notch-border-hover bg-notch-surface-hover text-notch-primary",
          "opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-visible:opacity-100",
          "outline-none focus-visible:outline-2 focus-visible:outline-notch-focus",
        ].join(" ")}
      >
        <X size={10} strokeWidth={2} aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * Temporary shelf for files dragged in from Windows Explorer (up to five).
 *
 * The drop itself is received by `useFileDrop` - the whole capsule is the drop
 * target - and this widget shows what is parked. Clicking a file opens its
 * folder in Explorer with the file selected. Only paths are stored.
 */
export function FileShelf() {
  const files = useNotchStore((store) => store.shelfFiles);
  const removeShelfFile = useNotchStore((store) => store.removeShelfFile);

  if (files.length === 0) {
    return (
      <section
        aria-label="File shelf"
        className="flex h-[50px] items-center justify-center gap-2 rounded-lg border border-dashed border-notch-border-hover text-notch-tertiary"
      >
        <Paperclip size={14} strokeWidth={1.5} aria-hidden="true" />
        <p className="text-[12px] leading-4">
          Drag files onto the island to park them
          <span className="font-mono text-[10px]"> · max {SHELF_MAX_FILES}</span>
        </p>
      </section>
    );
  }

  const emptySlots = SHELF_MAX_FILES - files.length;

  return (
    <section aria-label={`File shelf, ${files.length} of ${SHELF_MAX_FILES} files`}>
      <ul className="grid h-[50px] grid-cols-5 gap-1.5">
        {files.map((file) => (
          <ShelfItem key={file.id} file={file} onRemove={removeShelfFile} />
        ))}
        {Array.from({ length: emptySlots }, (_, index) => (
          <li
            key={`empty-${index}`}
            aria-hidden="true"
            className="rounded-lg border border-dashed border-notch-border"
          />
        ))}
      </ul>
    </section>
  );
}
