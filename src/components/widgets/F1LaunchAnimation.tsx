import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

/** Seconds: the five start lights come on one by one, then go out together. */
const LIGHT_STEP_S = 0.45;
const LIGHTS_OUT_S = 2.5;
const LAUNCH_S = 0.5;

const LIGHT_COUNT = 5;
const F1_RED = "#E10600";

/** Side view of a car facing right, 72 x 24 units, wheels on y = 23. */
function Car() {
  return (
    <g>
      {/* Rear wing */}
      <rect x="0" y="3" width="9" height="2.2" rx="0.6" fill="#1b1b1f" />
      <rect x="1" y="3" width="2.2" height="12" rx="0.6" fill="#1b1b1f" />
      {/* Body: engine cover and airbox, cockpit, long nose */}
      <path
        d="M4 17 L6 11 L18 10 L26 6.5 L31 6.5 L33 10 L44 11 L58 14.5 L70 16.5 L71.5 18 L60 19.5 L6 19.5 Z"
        fill={F1_RED}
      />
      {/* Sidepod shadow and floor */}
      <path d="M16 15.5 L44 15 L56 17.5 L56 19.5 L16 19.5 Z" fill="#9b0400" />
      <rect x="5" y="19.2" width="58" height="1.6" rx="0.8" fill="#121214" />
      {/* Halo and helmet */}
      <circle cx="37" cy="9.6" r="2.4" fill="#f5c400" />
      <path d="M32.5 10.2 Q37 5.6 43 10.6" fill="none" stroke="#2a2a2e" strokeWidth="1.3" strokeLinecap="round" />
      {/* Front wing */}
      <rect x="59" y="20" width="13" height="1.8" rx="0.6" fill="#1b1b1f" />
      {/* Wheels */}
      {[
        { cx: 14, r: 5.6 },
        { cx: 57, r: 4.8 },
      ].map((wheel) => (
        <g key={wheel.cx}>
          <circle cx={wheel.cx} cy={23 - wheel.r} r={wheel.r} fill="#0c0c0e" />
          <circle cx={wheel.cx} cy={23 - wheel.r} r={wheel.r * 0.55} fill="none" stroke="#3a3a40" strokeWidth="0.9" />
          <circle cx={wheel.cx} cy={23 - wheel.r} r={wheel.r * 0.18} fill={F1_RED} />
        </g>
      ))}
    </g>
  );
}

/** Puffs of tyre smoke drifting back from the rear wheel while it revs. */
function Smoke({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <g>
      {[0, 0.35, 0.7, 1.05].map((delay) => (
        <motion.circle
          key={delay}
          cx={10}
          cy={20}
          fill="#d4d4d8"
          initial={{ r: 1.5, opacity: 0, x: 0, y: 0 }}
          animate={{ r: [1.5, 5, 8], opacity: [0, 0.45, 0], x: [0, -10, -20], y: [0, -3, -6] }}
          transition={{ duration: 1.4, delay, repeat: Infinity, ease: "easeOut" }}
        />
      ))}
    </g>
  );
}

/**
 * Three-second launch start for the F1 Race Hub: the car sits on the grid
 * revving (a fine jitter, tyre smoke), the five red lights come on one by one,
 * and when they go out the car launches off to the right with a sharply
 * accelerating ease. Plays once per mount; reduced motion shows a still.
 */
export function F1LaunchAnimation() {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<"grid" | "launch">("grid");
  const [lit, setLit] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const timers = [
      ...Array.from({ length: LIGHT_COUNT }, (_, index) =>
        window.setTimeout(() => setLit(index + 1), (index + 1) * LIGHT_STEP_S * 1000 - 200),
      ),
      window.setTimeout(() => {
        setLit(0);
        setPhase("launch");
      }, LIGHTS_OUT_S * 1000),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reducedMotion]);

  return (
    <svg
      viewBox="0 0 400 44"
      preserveAspectRatio="xMinYMid meet"
      aria-label="Lights out and away we go"
      role="img"
      className="h-full w-full overflow-visible"
    >
      {/* Start gantry */}
      <g transform="translate(300 6)">
        <rect x="0" y="0" width="78" height="14" rx="4" fill="#0e0e11" stroke="#2a2a30" strokeWidth="0.8" />
        {Array.from({ length: LIGHT_COUNT }, (_, index) => (
          <circle
            key={index}
            cx={9 + index * 15}
            cy={7}
            r={4.2}
            fill={index < lit ? "#ff1a1a" : "#2b0d0d"}
            style={{
              filter: index < lit ? "drop-shadow(0 0 3px #ff2a2a)" : "none",
              transition: "fill 80ms linear",
            }}
          />
        ))}
      </g>

      {/* Track line */}
      <line x1="0" y1="41.5" x2="400" y2="41.5" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="1" />

      <motion.g
        initial={{ x: 16 }}
        animate={phase === "launch" ? { x: 480 } : { x: 16 }}
        transition={phase === "launch" ? { duration: LAUNCH_S, ease: [0.7, 0, 0.84, 0] } : { duration: 0 }}
      >
        <g transform="translate(0 18)">
          <Smoke active={phase === "grid" && !reducedMotion} />
          <g className={phase === "grid" && !reducedMotion ? "notch-rev-jitter" : undefined}>
            <Car />
          </g>
          {phase === "launch" &&
            [6, 12, 18].map((y) => (
              <motion.line
                key={y}
                x1={-4}
                x2={-4}
                y1={y}
                y2={y}
                stroke={F1_RED}
                strokeOpacity={0.55}
                strokeWidth={1.2}
                strokeLinecap="round"
                initial={{ x2: -4 }}
                animate={{ x2: -60 }}
                transition={{ duration: LAUNCH_S, ease: "easeIn" }}
              />
            ))}
        </g>
      </motion.g>
    </svg>
  );
}
