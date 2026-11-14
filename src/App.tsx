import { NotchContainer } from "./components/NotchContainer";
import { BatteryIndicator } from "./components/widgets/BatteryIndicator";
import { ClockDisplay } from "./components/widgets/ClockDisplay";

function App() {
  return (
    <main className="relative h-full w-full">
      <NotchContainer>
        <ClockDisplay />
        <BatteryIndicator />
      </NotchContainer>
    </main>
  );
}

export default App;
