import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AiShortcut } from "../lib/types";

const FALLBACK: AiShortcut[] = [
  { id: "claude", name: "Claude", installed: false, icon: null },
  { id: "chatgpt", name: "ChatGPT", installed: false, icon: null },
  { id: "gemini", name: "Gemini", installed: false, icon: null },
];

let cache: AiShortcut[] | null = null;
let request: Promise<AiShortcut[]> | null = null;

/** The three AI shortcuts with their real icons; looked up once per run. */
export function useAiShortcuts(): AiShortcut[] {
  const [shortcuts, setShortcuts] = useState<AiShortcut[]>(cache ?? FALLBACK);

  useEffect(() => {
    if (cache || !isTauri()) return;
    let disposed = false;
    request ??= invoke<AiShortcut[]>("ai_shortcuts")
      .then((found) => {
        cache = found;
        return found;
      })
      .catch((error: unknown) => {
        console.warn("[useAiShortcuts] ai_shortcuts failed:", error);
        request = null;
        return FALLBACK;
      });
    void request.then((found) => {
      if (!disposed) setShortcuts(found);
    });
    return () => {
      disposed = true;
    };
  }, []);

  return shortcuts;
}
