import { useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, Trash, X } from "lucide-react";
import { useSchedules } from "../../hooks/useSchedules";
import type { ScheduleItem } from "../../lib/types";
import { CustomTimePicker } from "../widgets/CustomTimePicker";
import { DigitText } from "../widgets/DigitText";
import { FOCUS_RING, PageHeader } from "./PageHeader";

/** The week as shown: Monday first. Values are JavaScript weekdays (0 = Sunday). */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const PRESETS: Array<{ label: string; days: number[] }> = [
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Weekend", days: [0, 6] },
  { label: "Daily", days: [0, 1, 2, 3, 4, 5, 6] },
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function sameDays(a: number[], b: number[]): boolean {
  return a.length === b.length && [...a].sort().every((day, index) => day === [...b].sort()[index]);
}

/** "Weekdays", "Weekend", "Daily" or "Mon, Wed". */
function describeDays(days: number[]): string {
  const preset = PRESETS.find((candidate) => sameDays(candidate.days, days));
  if (preset) return preset.label;
  return WEEK.filter((day) => days.includes(day))
    .map((day) => SHORT[day])
    .join(", ");
}

function nowTime(): string {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** The next full hour, as a starting time for a new entry. */
function nextHour(): string {
  return `${pad((new Date().getHours() + 1) % 24)}:00`;
}

/** Re-renders every minute, so "next" moves along by itself. */
function useMinute(): string {
  const [time, setTime] = useState(nowTime);
  useEffect(() => {
    const timer = window.setInterval(() => setTime(nowTime()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return time;
}

interface Draft {
  id: string | null;
  time: string;
  title: string;
  days: number[];
}

function DayToggle({
  day,
  isOn,
  onToggle,
}: {
  day: number;
  isOn: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isOn}
      aria-label={SHORT[day]}
      onClick={onToggle}
      className={[
        "h-[22px] w-[22px] shrink-0 rounded-md font-display text-[10px] leading-none font-bold transition-colors duration-100",
        FOCUS_RING,
        isOn ? "bg-notch-primary text-black" : "bg-notch-surface text-notch-secondary hover:text-notch-primary",
      ].join(" ")}
    >
      {LETTER[day]}
    </button>
  );
}

/**
 * Today's schedule from a recurring weekly plan: entries repeat on weekdays,
 * at the weekend, daily or on chosen days. A strip of the week picks the day
 * to look at; today's entries can be ticked off and the next one is marked.
 */
export function CalendarPage({ onCollapse }: { onCollapse: () => void }) {
  const { items, save } = useSchedules();
  const minute = useMinute();
  const today = new Date();
  const todayDay = today.getDay();
  const todayKey = dateKey(today);
  const [day, setDay] = useState(todayDay);
  const [draft, setDraft] = useState<Draft>(() => ({
    id: null,
    time: nextHour(),
    title: "",
    days: [todayDay],
  }));

  const isToday = day === todayDay;
  const entries = useMemo(
    () => (items ?? []).filter((item) => item.days.includes(day)).sort((a, b) => a.time.localeCompare(b.time)),
    [items, day],
  );
  const nextId = isToday
    ? entries.find((item) => item.time >= minute && item.done_on !== todayKey)?.id
    : undefined;

  // The week strip shows real dates: this week, Monday to Sunday.
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((todayDay + 6) % 7));

  const canSave = draft.title.trim() !== "" && /^\d{2}:\d{2}$/.test(draft.time) && draft.days.length > 0;

  const submit = () => {
    if (!canSave || items === null) return;
    const entry: ScheduleItem = {
      id: draft.id ?? crypto.randomUUID(),
      title: draft.title.trim(),
      time: draft.time,
      days: [...draft.days].sort(),
      done_on: draft.id ? (items.find((item) => item.id === draft.id)?.done_on ?? null) : null,
    };
    save(draft.id ? items.map((item) => (item.id === draft.id ? entry : item)) : [...items, entry]);
    setDraft({ id: null, time: nextHour(), title: "", days: [day] });
  };

  const edit = (item: ScheduleItem) =>
    setDraft({ id: item.id, time: item.time, title: item.title, days: item.days });

  const remove = (item: ScheduleItem) => {
    if (items === null) return;
    save(items.filter((candidate) => candidate.id !== item.id));
    if (draft.id === item.id) setDraft({ id: null, time: nextHour(), title: "", days: [day] });
  };

  const toggleDone = (item: ScheduleItem) => {
    if (items === null) return;
    const done_on = item.done_on === todayKey ? null : todayKey;
    save(items.map((candidate) => (candidate.id === item.id ? { ...candidate, done_on } : candidate)));
  };

  const toggleDraftDay = (value: number) =>
    setDraft((current) => ({
      ...current,
      days: current.days.includes(value)
        ? current.days.filter((candidate) => candidate !== value)
        : [...current.days, value],
    }));

  return (
    <div className="flex h-full flex-col gap-1.5">
      <PageHeader
        title="Today"
        detail={`${SHORT[todayDay]} ${today.getDate()} ${MONTHS[today.getMonth()]}`}
        onCollapse={onCollapse}
      />

      <div role="tablist" aria-label="Day of the week" className="grid h-[34px] shrink-0 grid-cols-7 gap-1">
        {WEEK.map((value, index) => {
          const date = new Date(monday);
          date.setDate(monday.getDate() + index);
          const isSelected = value === day;
          const count = (items ?? []).filter((item) => item.days.includes(value)).length;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => {
                setDay(value);
                if (draft.id === null) setDraft((current) => ({ ...current, days: [value] }));
              }}
              className={[
                "relative flex flex-col items-center justify-center rounded-lg transition-colors duration-100",
                FOCUS_RING,
                isSelected ? "bg-notch-surface-hover text-notch-primary" : "text-notch-secondary hover:text-notch-primary",
              ].join(" ")}
            >
              <span className="text-[9px] leading-3 font-medium uppercase">{SHORT[value]}</span>
              <span
                className={`font-display text-[12px] leading-4 font-bold ${value === todayDay ? "text-notch-playing" : ""}`}
              >
                <DigitText text={String(date.getDate())} />
              </span>
              {count > 0 && (
                <span aria-hidden="true" className="absolute bottom-0.5 h-[3px] w-[3px] rounded-full bg-current opacity-60" />
              )}
            </button>
          );
        })}
      </div>

      <ul
        data-scroll
        aria-label={`Schedule for ${SHORT[day]}`}
        className="notch-scroll -mx-1 flex min-h-0 flex-1 flex-col gap-0.5 px-1"
      >
        {items === null ? (
          <li className="py-3 text-center text-[11px] text-notch-tertiary">Loading...</li>
        ) : entries.length === 0 ? (
          <li className="py-3 text-center text-[11px] leading-4 text-notch-tertiary">
            Nothing on {isToday ? "today" : SHORT[day]}. Add a routine below - it repeats every week.
          </li>
        ) : (
          entries.map((item) => {
            const isDone = isToday && item.done_on === todayKey;
            const isNext = item.id === nextId;
            const isPast = isToday && !isDone && item.time < minute;
            return (
              <li
                key={item.id}
                className={[
                  "group flex h-[26px] shrink-0 items-center gap-2 rounded-lg px-1.5",
                  isNext ? "bg-notch-surface" : "",
                  draft.id === item.id ? "ring-1 ring-notch-border-active" : "",
                ].join(" ")}
              >
                {isToday ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isDone}
                    aria-label={`${item.title} done`}
                    onClick={() => toggleDone(item)}
                    className={[
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-100",
                      FOCUS_RING,
                      isDone ? "border-notch-playing bg-notch-playing text-black" : "border-white/30 hover:border-white/60",
                    ].join(" ")}
                  >
                    {isDone && <Check size={10} strokeWidth={3} aria-hidden="true" />}
                  </button>
                ) : (
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/25" />
                )}
                <span
                  className={`w-11 shrink-0 font-display text-[11px] leading-none font-bold ${isNext ? "text-notch-playing" : "text-notch-secondary"}`}
                >
                  <DigitText text={item.time} />
                </span>
                <span
                  className={[
                    "min-w-0 flex-1 truncate text-[12px] leading-4",
                    isDone ? "text-notch-tertiary line-through" : isPast ? "text-notch-secondary" : "text-notch-primary",
                  ].join(" ")}
                >
                  {item.title}
                </span>
                {isNext && (
                  <span className="shrink-0 rounded-full bg-notch-playing/15 px-1.5 text-[9px] leading-[14px] font-semibold text-notch-playing uppercase">
                    Next
                  </span>
                )}
                <span className="shrink-0 text-[10px] leading-3 text-notch-tertiary group-hover:hidden group-focus-within:hidden">
                  {describeDays(item.days)}
                </span>
                <span className="hidden shrink-0 items-center gap-0.5 group-focus-within:flex group-hover:flex">
                  <button
                    type="button"
                    onClick={() => edit(item)}
                    aria-label={`Edit ${item.title}`}
                    title="Edit"
                    className={`flex h-5 w-5 items-center justify-center rounded-md text-notch-tertiary hover:text-notch-primary ${FOCUS_RING}`}
                  >
                    <Pencil size={11} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(item)}
                    aria-label={`Delete ${item.title}`}
                    title="Delete"
                    className={`flex h-5 w-5 items-center justify-center rounded-md text-notch-tertiary hover:text-notch-error ${FOCUS_RING}`}
                  >
                    <Trash size={11} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })
        )}
      </ul>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex shrink-0 flex-col gap-2"
        aria-label={draft.id ? "Edit routine" : "New routine"}
      >
        <div className="flex h-7 items-center gap-2.5">
          <CustomTimePicker value={draft.time} onChange={(time) => setDraft((current) => ({ ...current, time }))} />
          <input
            type="text"
            value={draft.title}
            maxLength={80}
            onChange={(event) => {
              const title = event.currentTarget.value;
              setDraft((current) => ({ ...current, title }));
            }}
            placeholder={draft.id ? "Title" : "Add a routine, e.g. Lecture"}
            aria-label="Title"
            spellCheck={false}
            autoComplete="off"
            className="h-7 min-w-0 flex-1 rounded-lg border border-transparent bg-notch-surface px-2.5 text-[12px] text-notch-primary outline-none placeholder:text-notch-tertiary focus:border-notch-border-active"
          />
          {draft.id && (
            <button
              type="button"
              onClick={() => setDraft({ id: null, time: nextHour(), title: "", days: [day] })}
              aria-label="Cancel editing"
              title="Cancel"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-notch-surface text-notch-secondary hover:text-notch-primary ${FOCUS_RING}`}
            >
              <X size={13} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
          <button
            type="submit"
            disabled={!canSave}
            aria-label={draft.id ? "Save changes" : "Add routine"}
            title={draft.id ? "Save" : "Add"}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-notch-primary text-black transition-opacity duration-100 disabled:opacity-30 ${FOCUS_RING}`}
          >
            {draft.id ? (
              <Check size={14} strokeWidth={2.25} aria-hidden="true" />
            ) : (
              <Plus size={14} strokeWidth={2.25} aria-hidden="true" />
            )}
          </button>
        </div>
        <div className="flex h-[22px] items-center gap-1" role="group" aria-label="Repeats on">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setDraft((current) => ({ ...current, days: preset.days }))}
              aria-pressed={sameDays(preset.days, draft.days)}
              className={[
                "h-[22px] shrink-0 rounded-md px-2 font-display text-[11px] leading-none font-bold transition-colors duration-100",
                FOCUS_RING,
                sameDays(preset.days, draft.days)
                  ? "bg-notch-surface-hover text-notch-primary"
                  : "bg-notch-surface text-notch-secondary hover:text-notch-primary",
              ].join(" ")}
            >
              {preset.label}
            </button>
          ))}
          <span className="flex-1" />
          {WEEK.map((value) => (
            <DayToggle
              key={value}
              day={value}
              isOn={draft.days.includes(value)}
              onToggle={() => toggleDraftDay(value)}
            />
          ))}
        </div>
      </form>
    </div>
  );
}
