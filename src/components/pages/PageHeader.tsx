import type { ReactNode } from "react";
import { ChevronUp } from "lucide-react";
import { ClockDisplay } from "../widgets/ClockDisplay";

/** Collapse button of the dashboard. */
export function CollapseButton({ onCollapse }: { onCollapse: () => void }) {
  return (
    <button
      type="button"
      onClick={onCollapse}
      aria-label="Collapse"
      title="Collapse (Esc)"
      className={[
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-notch-secondary",
        "transition-[color,scale] duration-100 hover:scale-110 hover:text-notch-primary active:scale-95",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-notch-focus",
      ].join(" ")}
    >
      <ChevronUp size={16} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}

/** Title row of a dashboard page: what the page is, the time, collapse. */
export function PageHeader({
  title,
  detail,
  onCollapse,
}: {
  title: string;
  detail?: ReactNode;
  onCollapse: () => void;
}) {
  return (
    <header className="flex h-5 shrink-0 items-center gap-2">
      <h2 className="text-[13px] leading-[18px] font-medium text-notch-primary">{title}</h2>
      {detail && <span className="min-w-0 truncate text-[11px] leading-4 text-notch-tertiary">{detail}</span>}
      <span className="flex-1" />
      <ClockDisplay />
      <CollapseButton onCollapse={onCollapse} />
    </header>
  );
}

/** Small label above a section of a page. */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-3.5 shrink-0 items-center justify-between">
      <span className="text-[10px] leading-3 font-medium tracking-[0.06em] text-notch-tertiary uppercase">
        {children}
      </span>
      {action}
    </div>
  );
}

export const FOCUS_RING =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-notch-focus";
