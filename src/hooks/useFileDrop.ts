import { useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useNotchStore } from "../stores/notchStore";

/**
 * Receives files dragged in from Windows Explorer.
 *
 * Tauri's native drag-drop events are used rather than HTML5 ones, because
 * only they carry the real file paths. The whole capsule is the drop target:
 * entering switches the capsule to its `dragOver` state, dropping parks the
 * files on the shelf.
 *
 * @param onDrop called after a drop was handled, with the number of files added.
 */
export function useFileDrop(onDrop: (added: number) => void): void {
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const store = useNotchStore.getState();
        const payload = event.payload;

        // With the file shelf switched off the capsule is not a drop target,
        // and a file being dragged out of the shelf is not coming back in.
        if (!store.settings.active_widgets.file_shelf || store.isDraggingOut) {
          store.setDragOver(false);
          return;
        }

        switch (payload.type) {
          case "enter":
          case "over":
            store.setDragOver(true);
            break;
          case "leave":
            store.setDragOver(false);
            break;
          case "drop": {
            const { added } = store.addShelfFiles(payload.paths);
            store.setDragOver(false);
            onDropRef.current(added);
            break;
          }
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error: unknown) => {
        console.warn("[useFileDrop] could not listen for file drops:", error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
