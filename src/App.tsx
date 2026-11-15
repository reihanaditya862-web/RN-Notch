import { ErrorBoundary } from "./components/ErrorBoundary";
import { NotchContainer } from "./components/NotchContainer";
import { useUiScale } from "./hooks/useUiScale";
import { APP_NAME } from "./lib/constants";

function App() {
  // The size the user picked (Auto, 100% ... 175%). Applied as CSS zoom, so
  // width, height, type, padding and the notch's ears all scale together;
  // the hook also resizes the transparent window to fit.
  const scale = useUiScale();

  return (
    <main className="relative h-full w-full" style={{ zoom: scale }}>
      {/*
        Last line of defence. Each widget has its own boundary inside; if the
        capsule itself fails, a small static pill stays on screen instead of
        an empty window, and the tray menu keeps working.
      */}
      <ErrorBoundary
        label={APP_NAME}
        fallback={
          <p className="absolute top-2 left-1/2 flex h-7 -translate-x-1/2 items-center rounded-full border border-notch-border bg-notch-bg px-3 text-[11px] leading-none text-notch-tertiary">
            {APP_NAME} is unavailable. Quit it from the tray and start it again.
          </p>
        }
      >
        <NotchContainer />
      </ErrorBoundary>
    </main>
  );
}

export default App;
