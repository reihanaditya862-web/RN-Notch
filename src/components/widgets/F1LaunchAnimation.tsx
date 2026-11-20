import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { F1CarSilhouette } from "./F1CarSilhouette";

/** Seconds: the five start lights come on one by one, then go out together. */
const LIGHT_STEP_S = 0.45;
const LIGHTS_OUT_S = 2.5;
const LAUNCH_S = 0.5;

const LIGHT_COUNT = 5;
/** Where the rear tyre meets the track, in the car's units (see F1CarSilhouette). */
const REAR_CONTACT = { x: 9, y: 22 };

/** Puffs of tyre smoke drifting back from the rear wheel while it revs. */
function Smoke({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <g>
      {[0, 0.35, 0.7, 1.05].map((delay) => (
        <motion.circle
          key={delay}
          cx={REAR_CONTACT.x}
          cy={REAR_CONTACT.y}
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
 * Three-second launch start for the F1 Race Hub: a white silhouette of a
 * current F1 car sits on the grid revving (a fine jitter, tyre smoke, the
 * rain light blinking) while the five red lights come on one by one; when
 * they go out at 2.5 s it launches off to the right with a sharply
 * accelerating ease, wheels turning. Transform and opacity only. Plays once
 * per mount; reduced motion shows a still.
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
        initial={{ x: 12 }}
        animate={phase === "launch" ? { x: 440 } : { x: 12 }}
        transition={phase === "launch" ? { duration: LAUNCH_S, ease: [0.7, 0, 0.84, 0] } : { duration: 0 }}
      >
        <g transform="translate(0 18)">
          <Smoke active={phase === "grid" && !reducedMotion} />
          <g className={phase === "grid" && !reducedMotion ? "notch-rev-jitter" : undefined}>
            <F1CarSilhouette
              isRevving={phase === "grid" && !reducedMotion}
              isSpinning={phase === "launch"}
            />
          </g>
          {phase === "launch" &&
            [6, 12, 18].map((y) => (
              <motion.line
                key={y}
                x1={-4}
                x2={-4}
                y1={y}
                y2={y}
                stroke="#FFFFFF"
                strokeOpacity={0.35}
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
