import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  /** Name of the wrapped part, for the log and the default fallback. */
  label: string;
  children: ReactNode;
  /**
   * Shown instead of the children after a crash. Defaults to a small
   * "(unavailable)" note; pass `null` to show nothing at all.
   */
  fallback?: ReactNode;
  /**
   * When this value changes, the boundary forgets the error and renders its
   * children again. Pass something that changes when a retry makes sense
   * (the capsule's state, for example), so one bad render is not permanent.
   */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  hasError: boolean;
  /** The `resetKey` seen on the last render; a different one clears the error. */
  lastResetKey: unknown;
}

/**
 * Keeps a crash in one widget from taking the whole capsule down.
 *
 * A render error inside the children is caught here: the rest of the UI keeps
 * running, the failing part shows a small placeholder, and the error goes to
 * the console as a warning.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, lastResetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    // The key changed: whatever failed before gets another chance. With an
    // unchanged key the error stays, so a broken widget cannot loop.
    if (!Object.is(state.lastResetKey, props.resetKey)) {
      return { hasError: false, lastResetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn(`[ErrorBoundary] ${this.props.label} crashed:`, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;

    return (
      <span
        role="status"
        className="flex h-full min-h-4 w-full items-center justify-center px-2 text-[10px] leading-3 text-notch-tertiary"
      >
        {this.props.label} (unavailable)
      </span>
    );
  }
}
