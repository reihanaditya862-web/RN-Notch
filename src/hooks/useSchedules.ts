import { useCallback, useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ScheduleItem } from "../lib/types";
import { useNotchStore } from "../stores/notchStore";

let loading: Promise<void> | null = null;

/**
 * The daily schedule from `%APPDATA%\rn-notch\schedules.json`. Loaded the
 * first time it is needed; `save` shows a change at once and writes it.
 */
export function useSchedules(): {
  items: ScheduleItem[] | null;
  save: (items: ScheduleItem[]) => void;
} {
  const items = useNotchStore((store) => store.schedules);

  useEffect(() => {
    if (useNotchStore.getState().schedules !== null || loading) return;
    if (!isTauri()) {
      useNotchStore.getState().setSchedules([]);
      return;
    }
    loading = invoke<ScheduleItem[]>("load_schedules")
      .then((loaded) => useNotchStore.getState().setSchedules(loaded))
      .catch((error: unknown) => {
        console.warn("[useSchedules] load_schedules failed:", error);
        useNotchStore.getState().setSchedules([]);
      })
      .finally(() => {
        loading = null;
      });
  }, []);

  const save = useCallback((next: ScheduleItem[]) => {
    useNotchStore.getState().setSchedules(next);
    if (!isTauri()) return;
    invoke<ScheduleItem[]>("save_schedules", { items: next })
      .then((stored) => useNotchStore.getState().setSchedules(stored))
      .catch((error: unknown) => console.warn("[useSchedules] save_schedules failed:", error));
  }, []);

  return { items, save };
}
