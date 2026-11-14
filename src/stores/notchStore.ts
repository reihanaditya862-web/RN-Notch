import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { SHELF_FILE_TTL_MS, SHELF_MAX_FILES } from "../lib/constants";
import type { NotchState, ShelfFile, SystemInfo } from "../lib/types";

/** How long a volume change made in the UI outranks what the polls report, in ms. */
const VOLUME_HOLD_MS = 1000;

/** The inputs the visual state is derived from. */
interface StateInputs {
  isHoverOpen: boolean;
  isExpanded: boolean;
  isDragOver: boolean;
  isMediaPlaying: boolean;
}

interface NotchStore extends StateInputs {
  /** Current visual state of the capsule. Derived from the inputs above. */
  state: NotchState;
  previousState: NotchState;

  /** Latest hardware snapshot from Rust; null until the first poll lands. */
  systemInfo: SystemInfo | null;
  volumeHoldUntil: number;

  /** Persisted to localStorage. */
  shelfFiles: ShelfFile[];
  scratchpadText: string;

  /** The cursor has settled on the capsule (after the hover delay). Closing also closes the dashboard. */
  setHoverOpen: (open: boolean) => void;
  setMediaPlaying: (playing: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  toggleExpanded: () => void;
  setDragOver: (over: boolean) => void;

  setSystemInfo: (info: SystemInfo) => void;
  /** Show a volume change at once, before Windows confirms it. */
  setVolumeOptimistic: (percent: number) => void;
  setMutedOptimistic: (muted: boolean) => void;

  /** Adds dropped files up to the shelf limit. Returns how many were added and how many did not fit. */
  addShelfFiles: (paths: string[]) => { added: number; rejected: number };
  removeShelfFile: (id: string) => void;
  /** Drops files that have been on the shelf longer than the time limit. */
  pruneExpiredShelfFiles: () => void;

  setScratchpadText: (text: string) => void;
}

/** Priority: a file drag beats the dashboard, which beats hover, which beats idle. */
function resolveState(inputs: StateInputs): NotchState {
  if (inputs.isDragOver) return "dragOver";
  if (inputs.isExpanded) return "expanded";
  if (inputs.isHoverOpen) return "hover";
  return inputs.isMediaPlaying ? "idleMedia" : "idle";
}

function fileName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || path;
}

function isFresh(file: ShelfFile, now: number): boolean {
  return now - file.added_at < SHELF_FILE_TTL_MS;
}

export const useNotchStore = create<NotchStore>()(
  persist(
    (set, get) => {
      /** Applies input changes and re-derives `state` in one update. */
      const applyInputs = (patch: Partial<StateInputs>) => {
        const current = get();
        const inputs: StateInputs = {
          isHoverOpen: current.isHoverOpen,
          isExpanded: current.isExpanded,
          isDragOver: current.isDragOver,
          isMediaPlaying: current.isMediaPlaying,
          ...patch,
        };
        const state = resolveState(inputs);
        set({
          ...inputs,
          state,
          previousState: state === current.state ? current.previousState : current.state,
        });
      };

      return {
        state: "idle",
        previousState: "idle",
        isHoverOpen: false,
        isExpanded: false,
        isDragOver: false,
        isMediaPlaying: false,

        systemInfo: null,
        volumeHoldUntil: 0,

        shelfFiles: [],
        scratchpadText: "",

        setHoverOpen: (open) => {
          if (open === get().isHoverOpen) return;
          applyInputs(open ? { isHoverOpen: true } : { isHoverOpen: false, isExpanded: false });
        },
        setMediaPlaying: (playing) => {
          if (playing !== get().isMediaPlaying) applyInputs({ isMediaPlaying: playing });
        },
        setExpanded: (expanded) => {
          if (expanded !== get().isExpanded) applyInputs({ isExpanded: expanded });
        },
        toggleExpanded: () => applyInputs({ isExpanded: !get().isExpanded }),
        setDragOver: (over) => {
          if (over !== get().isDragOver) applyInputs({ isDragOver: over });
        },

        setSystemInfo: (info) => {
          const { systemInfo, volumeHoldUntil } = get();
          if (systemInfo && Date.now() < volumeHoldUntil) {
            set({
              systemInfo: {
                ...info,
                volume_percent: systemInfo.volume_percent,
                is_muted: systemInfo.is_muted,
              },
            });
          } else {
            set({ systemInfo: info });
          }
        },
        setVolumeOptimistic: (percent) => {
          const { systemInfo } = get();
          if (!systemInfo) return;
          const volume = Math.min(100, Math.max(0, Math.round(percent)));
          set({
            systemInfo: {
              ...systemInfo,
              volume_percent: volume,
              is_muted: volume > 0 ? false : systemInfo.is_muted,
            },
            volumeHoldUntil: Date.now() + VOLUME_HOLD_MS,
          });
        },
        setMutedOptimistic: (muted) => {
          const { systemInfo } = get();
          if (!systemInfo) return;
          set({
            systemInfo: { ...systemInfo, is_muted: muted },
            volumeHoldUntil: Date.now() + VOLUME_HOLD_MS,
          });
        },

        addShelfFiles: (paths) => {
          const now = Date.now();
          const files = get().shelfFiles.filter((file) => isFresh(file, now));
          const known = new Set(files.map((file) => file.path.toLowerCase()));

          let added = 0;
          let rejected = 0;
          for (const path of paths) {
            const key = path.toLowerCase();
            if (known.has(key)) continue; // already on the shelf
            if (files.length >= SHELF_MAX_FILES) {
              rejected += 1;
              continue;
            }
            known.add(key);
            files.push({ id: crypto.randomUUID(), name: fileName(path), path, added_at: now });
            added += 1;
          }

          set({ shelfFiles: files });
          return { added, rejected };
        },
        removeShelfFile: (id) =>
          set({ shelfFiles: get().shelfFiles.filter((file) => file.id !== id) }),
        pruneExpiredShelfFiles: () => {
          const now = Date.now();
          const files = get().shelfFiles;
          const fresh = files.filter((file) => isFresh(file, now));
          if (fresh.length !== files.length) set({ shelfFiles: fresh });
        },

        setScratchpadText: (text) => set({ scratchpadText: text }),
      };
    },
    {
      name: "dynamic-island",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only user content survives a restart; everything else is live data.
      partialize: (store) => ({
        shelfFiles: store.shelfFiles,
        scratchpadText: store.scratchpadText,
      }),
      onRehydrateStorage: () => (store) => store?.pruneExpiredShelfFiles(),
    },
  ),
);
