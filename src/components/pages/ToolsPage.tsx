import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  Camera,
  ChevronDown,
  Headphones,
  Mic,
  MicOff,
  Pause,
  Pipette,
  Play,
  RotateCcw,
  Timer,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useAudioMixer } from "../../hooks/useAudioMixer";
import { toastAlert } from "../../lib/alerts";
import { POMODORO_BREAK_OPTIONS, POMODORO_FOCUS_OPTIONS } from "../../lib/constants";
import { useNotchStore } from "../../stores/notchStore";
import { DigitText } from "../widgets/DigitText";
import { FOCUS_RING, PageHeader, SectionLabel } from "./PageHeader";

/** Time for the capsule to fade out before Windows freezes the screen for the snip. */
const STEP_ASIDE_MS = 240;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Starts Snipping Tool's screenshot or recording overlay. The capsule fades
 * out first so it is not in the picture, and comes back once the overlay is
 * gone.
 */
async function capture(kind: "screenshot" | "record"): Promise<void> {
  const store = useNotchStore.getState();
  if (!isTauri()) return;
  store.setCapturing(true);
  let failure: string | null = null;
  try {
    await wait(STEP_ASIDE_MS);
    await invoke("launch_snip", { kind });
  } catch (error) {
    failure = String(error);
  } finally {
    useNotchStore.getState().setCapturing(false);
  }

  const after = useNotchStore.getState();
  if (failure) {
    after.pushAlert(
      toastAlert(
        "Snipping Tool did not open",
        kind === "record" ? "Screen recording needs the Windows 11 Snipping Tool" : failure,
        { type: "symbol", name: "error" },
        "warning",
      ),
    );
  } else if (kind === "record") {
    after.pushAlert(
      toastAlert("Recording with Snipping Tool", "Stop it from Snipping Tool's toolbar", {
        type: "symbol",
        name: "record",
      }),
    );
  }
}

function pickColor(): void {
  if (!isTauri()) return;
  // The panel folds away so the colour under it can be picked too.
  useNotchStore.getState().setExpanded(false);
  invoke("start_color_pick").catch((error: unknown) =>
    useNotchStore
      .getState()
      .pushAlert(toastAlert("Colour picker unavailable", String(error), { type: "symbol", name: "error" }, "warning")),
  );
}

function ToolButton({
  icon,
  label,
  onClick,
  isActive,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isActive}
      className={[
        "flex h-10 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg",
        "text-[10px] leading-3 font-medium transition-[color,background-color,scale] duration-100 active:scale-95",
        "disabled:pointer-events-none disabled:opacity-35",
        FOCUS_RING,
        isActive
          ? "bg-notch-error/20 text-notch-error"
          : "bg-notch-surface text-notch-secondary hover:bg-notch-surface-hover hover:text-notch-primary",
      ].join(" ")}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Cycles through the options of a small setting chip. */
function cycle(options: readonly number[], current: number): number {
  const index = options.indexOf(current);
  return options[(index + 1) % options.length];
}

function PomodoroRow() {
  const pomodoro = useNotchStore((store) => store.pomodoro);
  const focusMin = useNotchStore((store) => store.pomodoroFocusMin);
  const breakMin = useNotchStore((store) => store.pomodoroBreakMin);
  const store = useNotchStore.getState();
  const [now, setNow] = useState(Date.now);

  const isRunning = pomodoro.phase !== "idle" && pomodoro.endsAt !== null;
  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  const remaining =
    pomodoro.phase === "idle"
      ? focusMin * 60_000
      : (pomodoro.pausedRemaining ?? Math.max(0, (pomodoro.endsAt ?? now) - now));
  const label = pomodoro.phase === "break" ? "Break" : pomodoro.phase === "focus" ? "Focus" : "Focus timer";
  const tone = pomodoro.phase === "break" ? "text-notch-playing" : pomodoro.phase === "focus" ? "text-[#ff6b5e]" : "text-notch-secondary";

  const chip = (text: string, onClick: () => void, title: string) => (
    <button
      type="button"
      onClick={onClick}
      disabled={pomodoro.phase !== "idle"}
      title={title}
      className={[
        "h-[22px] shrink-0 rounded-md bg-notch-surface px-1.5 text-[10px] leading-none font-medium text-notch-secondary",
        "transition-colors duration-100 hover:text-notch-primary disabled:opacity-40",
        FOCUS_RING,
      ].join(" ")}
    >
      {text}
    </button>
  );

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 rounded-lg bg-notch-surface/60 px-2">
      <Timer size={14} strokeWidth={1.75} aria-hidden="true" className={tone} />
      <span className={`w-[62px] shrink-0 text-[11px] leading-3 font-medium ${tone}`}>{label}</span>
      <span className="w-14 shrink-0 font-display text-[14px] leading-none font-bold text-notch-primary">
        <DigitText text={formatClock(remaining)} />
      </span>
      <span className="flex-1" />
      {chip(`${focusMin}m`, () => store.setPomodoroMinutes("focus", cycle(POMODORO_FOCUS_OPTIONS, focusMin)), "Focus length")}
      {chip(`${breakMin}m break`, () => store.setPomodoroMinutes("break", cycle(POMODORO_BREAK_OPTIONS, breakMin)), "Break length")}
      <button
        type="button"
        onClick={() =>
          pomodoro.phase === "idle"
            ? store.startPomodoro("focus")
            : isRunning
              ? store.pausePomodoro()
              : store.resumePomodoro()
        }
        aria-label={pomodoro.phase === "idle" ? "Start focus timer" : isRunning ? "Pause timer" : "Resume timer"}
        title={pomodoro.phase === "idle" ? "Start" : isRunning ? "Pause" : "Resume"}
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-notch-primary text-black active:scale-95 ${FOCUS_RING}`}
      >
        {isRunning ? (
          <Pause size={12} strokeWidth={2} fill="currentColor" aria-hidden="true" />
        ) : (
          <Play size={12} strokeWidth={2} fill="currentColor" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        onClick={store.resetPomodoro}
        disabled={pomodoro.phase === "idle"}
        aria-label="Reset timer"
        title="Reset"
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md text-notch-secondary hover:text-notch-primary disabled:opacity-30 ${FOCUS_RING}`}
      >
        <RotateCcw size={12} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}

function OutputPicker({
  outputs,
  onSelect,
}: {
  outputs: ReturnType<typeof useAudioMixer>["outputs"];
  onSelect: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const current = outputs.find((device) => device.is_default);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        disabled={outputs.length === 0}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        title="Output device"
        className={[
          "flex h-7 w-full items-center gap-2 rounded-lg bg-notch-surface px-2.5 text-left",
          "text-[12px] leading-4 text-notch-primary transition-colors duration-100 hover:bg-notch-surface-hover disabled:opacity-40",
          FOCUS_RING,
        ].join(" ")}
      >
        <Headphones size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-notch-tertiary" />
        <span className="min-w-0 flex-1 truncate">{current?.name ?? "No output device"}</span>
        {outputs.length > 1 && (
          <span className="shrink-0 text-[10px] text-notch-tertiary">{outputs.length} devices</span>
        )}
        <ChevronDown
          size={13}
          strokeWidth={1.75}
          aria-hidden="true"
          className={`shrink-0 text-notch-tertiary transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && (
        <ul
          role="listbox"
          aria-label="Output devices"
          className="absolute inset-x-0 top-8 z-10 max-h-[112px] overflow-y-auto rounded-lg border border-notch-border-hover bg-[#141417] p-1 shadow-[0_8px_20px_rgb(0_0_0/0.55)]"
        >
          {outputs.map((device) => (
            <li key={device.id}>
              <button
                type="button"
                role="option"
                aria-selected={device.is_default}
                onClick={() => {
                  onSelect(device.id);
                  setIsOpen(false);
                }}
                className={[
                  "flex h-6 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] leading-4",
                  device.is_default ? "bg-notch-surface-hover text-notch-primary" : "text-notch-secondary hover:bg-notch-surface hover:text-notch-primary",
                  FOCUS_RING,
                ].join(" ")}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${device.is_default ? "bg-notch-playing" : "bg-transparent"}`}
                />
                <span className="truncate">{device.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Mixer({ mixer }: { mixer: ReturnType<typeof useAudioMixer> }) {
  return (
    <section aria-label="App volume" className="flex min-h-0 flex-1 flex-col gap-1">
      <SectionLabel>Apps playing</SectionLabel>
      {mixer.apps.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-[11px] text-notch-tertiary">
          No app is playing sound right now
        </p>
      ) : (
        <ul data-scroll className="notch-scroll -mx-1 flex min-h-0 flex-1 flex-col gap-0.5 px-1">
          {mixer.apps.map((app) => {
            const shown = app.muted ? 0 : app.volume;
            return (
              <li key={app.pid} className="flex h-[26px] shrink-0 items-center gap-2">
                {app.icon ? (
                  <img src={app.icon} alt="" draggable={false} className="h-4 w-4 shrink-0 object-contain" />
                ) : (
                  <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded bg-notch-surface" />
                )}
                <span className="w-[72px] shrink-0 truncate text-[11px] leading-4 text-notch-primary">{app.name}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={shown}
                  onChange={(event) => mixer.setAppVolume(app.pid, Number(event.currentTarget.value))}
                  aria-label={`${app.name} volume`}
                  className={`notch-range min-w-0 flex-1 ${app.muted ? "notch-range-muted" : ""}`}
                  style={{ "--range-fill": `${shown}%` } as CSSProperties}
                />
                <span className="w-8 shrink-0 text-right font-display text-[10px] leading-none font-bold text-notch-secondary">
                  <DigitText text={`${shown}%`} />
                </span>
                <button
                  type="button"
                  onClick={() => mixer.toggleAppMute(app.pid)}
                  aria-label={app.muted ? `Unmute ${app.name}` : `Mute ${app.name}`}
                  aria-pressed={app.muted}
                  title={app.muted ? "Unmute" : "Mute"}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${app.muted ? "text-notch-error" : "text-notch-secondary hover:text-notch-primary"} ${FOCUS_RING}`}
                >
                  {app.muted ? (
                    <VolumeX size={13} strokeWidth={1.5} aria-hidden="true" />
                  ) : (
                    <Volume2 size={13} strokeWidth={1.5} aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Screenshot, recording, colour picker, focus timer and the audio suite. */
export function ToolsPage({ onCollapse }: { onCollapse: () => void }) {
  const hasMixer = useNotchStore((store) => store.settings.features.audio_mixer);
  const mixer = useAudioMixer(hasMixer);

  return (
    <div className="flex h-full flex-col gap-1.5">
      <PageHeader title="Tools" onCollapse={onCollapse} />
      <div className="flex shrink-0 gap-1.5">
        <ToolButton
          icon={<Camera size={15} strokeWidth={1.5} aria-hidden="true" />}
          label="Screenshot"
          onClick={() => void capture("screenshot")}
        />
        <ToolButton
          icon={<Video size={15} strokeWidth={1.5} aria-hidden="true" />}
          label="Record"
          onClick={() => void capture("record")}
        />
        <ToolButton
          icon={<Pipette size={15} strokeWidth={1.5} aria-hidden="true" />}
          label="Pick colour"
          onClick={pickColor}
        />
        {hasMixer && (
          <ToolButton
            icon={
              mixer.micMuted ? (
                <MicOff size={15} strokeWidth={1.5} aria-hidden="true" />
              ) : (
                <Mic size={15} strokeWidth={1.5} aria-hidden="true" />
              )
            }
            label={mixer.micMuted === null ? "No mic" : mixer.micMuted ? "Mic off" : "Mic on"}
            onClick={mixer.toggleMic}
            isActive={mixer.micMuted === true}
            disabled={mixer.micMuted === null}
          />
        )}
      </div>
      {hasMixer && <OutputPicker outputs={mixer.outputs} onSelect={mixer.setOutput} />}
      <PomodoroRow />
      {hasMixer ? <Mixer mixer={mixer} /> : <span className="flex-1" />}
    </div>
  );
}
