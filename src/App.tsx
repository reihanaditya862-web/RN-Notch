import { ErrorBoundary } from "./components/ErrorBoundary";
import { NotchContainer } from "./components/NotchContainer";
import { APP_NAME } from "./lib/constants";

function App() {
  return (
    <main className="relative h-full w-full">
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
