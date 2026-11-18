import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles/globals.css";
import App from "./App";
import { ColorPickerOverlay } from "./components/ColorPickerOverlay";

/** The eyedropper opens the same page in a window of its own. */
const isPicker = isTauri() && getCurrentWindow().label === "picker";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isPicker ? <ColorPickerOverlay /> : <App />}</React.StrictMode>,
);
