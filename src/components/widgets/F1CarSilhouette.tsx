/**
 * Side view of a modern ground-effect Formula 1 car (2022-2026 rules), facing
 * right, as a clean white silhouette. Drawn here rather than loaded, so it
 * costs nothing on the network and stays sharp at every scale.
 *
 * Units are 1/20 m: the car is 5.6 m long (x 0-112), the 720 mm tyres on
 * 18-inch rims have a radius of 7.2, the wheelbase is 3.6 m, and the ground
 * is at y = 24. What makes it read as a current car: the stepped front wing
 * and low nose, open wheels with the brow over the front tyre, the halo over
 * the driver's helmet, the airbox and the fin along the engine cover, the
 * undercut below the sidepod inlet, and the rear wing with its DRS slot, swan
 * neck and beam wing.
 *
 * Detail lines are drawn in `gap` (the capsule's own black) over the white,
 * so they read as recesses. It is a `<g>` for use inside another SVG.
 */

const WHITE = "#FFFFFF";
const TYRE_RADIUS = 7.2;
const REAR_AXLE = 16;
const FRONT_AXLE = 88;
const AXLE_Y = 24 - TYRE_RADIUS;

/** Engine cover, cockpit, nose and floor, from the rear crash structure round. */
const BODY =
  "M5 13.4 L12 12.2 C20 11 30 9.2 38.2 6.6 L42.6 4.8 Q44.6 4.1 47.2 4.2 L48.8 4.6 L48.8 6.5 " +
  "L47.4 6.8 L47.8 8.3 L49.8 9.6 L51.2 10.2 L63.6 10.4 Q66.2 10.4 68.4 10.9 " +
  "C76 12.4 88 15.2 100 18 L106.6 19.3 Q108.8 19.8 108.5 20.7 L104 21 " +
  "C96 20.6 86 19.8 78 19.4 L76 21.4 L76.8 22.6 L24 22.6 L9 21.2 L5.4 18.6 Z";

/** The fin running back from the airbox along the engine cover. */
const SHARK_FIN = "M42.6 4.8 L20.5 8.9 L19.6 10.9 L30 9.6 Z";

/** Front wing: footplate and endplate, then the elements stepping up rearwards. */
const FRONT_WING = [
  "M96.2 23.6 L111.8 23.6 L111.8 21.9 Q111.4 21.6 110.9 21.7 L110.9 22.8 L96.2 22.9 Z",
  "M98.6 21.5 Q103 21.2 108.6 22.1 L108.4 22.5 Q103 21.9 98.4 22.1 Z",
  "M97.2 20.1 Q100.4 20 103.8 21 L103.6 21.4 Q100.4 20.6 97 20.7 Z",
  "M96.2 18.8 Q98.4 18.9 100.6 19.9 L100.4 20.3 Q98.3 19.5 96 19.4 Z",
];

/**
 * Rear wing seen through its endplate: one rounded plate (flap above, main
 * plane below) and its lower leg curving down to the beam wing. The DRS slot
 * between flap and main plane is cut across it (see `DRS_SLOT`).
 */
const REAR_WING = [
  "M0.6 3.3 Q5.6 2.5 10.9 5.9 L10.9 9.4 Q6.4 10.4 2.6 11.1 Q1.1 7.4 0.6 3.3 Z",
  "M2.6 10.4 Q2.4 13.2 3 15.8 L4.2 15.6 Q3.7 13.2 3.9 10.3 Z",
];
const DRS_SLOT = "M1.2 6.7 Q5.8 5.7 10.6 7.7";

/** Beam wing, low behind the rear axle above the diffuser. */
const BEAM_WING = "M8.8 15.3 Q5.6 15.2 2.2 16 L2.3 16.8 Q5.6 16.1 8.7 16.1 Z";

/** Swan neck pylon: from the crash structure up into the wing. */
const SWAN_NECK = "M7.6 13.6 C7.3 12 7.2 10.8 7.6 9.6";

/** Halo: front pillar on the cockpit rim, hoop back over the helmet. */
const HALO = "M64 10.4 C63.5 8.8 63 7.8 62 7.2 Q57 6.1 51.8 7 Q50.7 7.6 50.6 9.8";

function Wheel({ cx, gap, isSpinning }: { cx: number; gap: string; isSpinning: boolean }) {
  return (
    <g>
      {/* A thin gap all round lifts the tyre off the bodywork behind it. */}
      <circle cx={cx} cy={AXLE_Y} r={TYRE_RADIUS + 0.7} fill={gap} />
      <circle cx={cx} cy={AXLE_Y} r={TYRE_RADIUS} fill={WHITE} />
      {/* Low-profile sidewall: the dark rim takes most of the wheel. */}
      <circle cx={cx} cy={AXLE_Y} r={4.6} fill={gap} fillOpacity={0.88} />
      <g className={isSpinning ? "notch-wheel-spin" : undefined}>
        {/* A glint on the rim, which turns with the wheel. */}
        <path
          d={`M${cx - 3.4} ${AXLE_Y - 1.6} A3.75 3.75 0 0 1 ${cx + 0.4} ${AXLE_Y - 3.7}`}
          fill="none"
          stroke={WHITE}
          strokeOpacity={0.55}
          strokeWidth={0.7}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={AXLE_Y} r={1.2} fill={WHITE} />
      </g>
    </g>
  );
}

export function F1CarSilhouette({
  gap = "#09090b",
  isRevving = false,
  isSpinning = false,
}: {
  /** The colour behind the car; detail lines and wheel gaps use it. */
  gap?: string;
  /** Blinks the red rain light (the car on the grid). */
  isRevving?: boolean;
  /** Turns the glint on the rims (the car moving). */
  isSpinning?: boolean;
}) {
  return (
    <g>
      {/* Rear wing assembly, behind the body. */}
      <path d={SWAN_NECK} fill="none" stroke={WHITE} strokeWidth={1.1} strokeLinecap="round" />
      {REAR_WING.map((d) => (
        <path key={d} d={d} fill={WHITE} />
      ))}
      <path d={DRS_SLOT} fill="none" stroke={gap} strokeWidth={0.75} strokeLinecap="round" />
      <path d={BEAM_WING} fill={WHITE} />

      <path d={BODY} fill={WHITE} />
      <path d={SHARK_FIN} fill={WHITE} />

      {/* Sidepod: the inlet, the top surface sweeping down, and the undercut below. */}
      <rect x={60.4} y={12.6} width={1.6} height={3.8} rx={0.6} fill={gap} fillOpacity={0.78} />
      <path d="M62 12.6 C52 12.2 40 13.4 28 16.8" fill="none" stroke={gap} strokeOpacity={0.4} strokeWidth={0.5} />
      <path d="M61.8 16.6 C56 17 50 18.6 44.5 21.5 L61.8 21.5 Z" fill={gap} fillOpacity={0.5} />
      {/* Floor edge. */}
      <path d="M24 21.6 H76" stroke={gap} strokeOpacity={0.45} strokeWidth={0.4} />

      {/* Driver: helmet with its visor, the halo in front of it. */}
      <circle cx={56.4} cy={8.6} r={2.4} fill={gap} />
      <circle cx={56.4} cy={8.6} r={2} fill={WHITE} />
      <path d="M57.4 7.3 Q58.6 8.1 58.2 9.4" fill="none" stroke={gap} strokeWidth={0.8} strokeLinecap="round" />
      <path d={HALO} fill="none" stroke={gap} strokeWidth={1.8} strokeLinecap="round" />
      <path d={HALO} fill="none" stroke={WHITE} strokeWidth={1} strokeLinecap="round" />

      {/* Rain light on the crash structure. */}
      <rect
        x={4.2}
        y={14}
        width={1.4}
        height={1}
        rx={0.3}
        fill="#FF2A2A"
        className={isRevving ? "notch-blink" : undefined}
        style={{ filter: "drop-shadow(0 0 1.2px #ff2a2a)" }}
      />

      <Wheel cx={REAR_AXLE} gap={gap} isSpinning={isSpinning} />
      <Wheel cx={FRONT_AXLE} gap={gap} isSpinning={isSpinning} />

      {/* Wake control brow over the front tyre. */}
      <path
        d={`M${FRONT_AXLE - 6} 10.6 Q${FRONT_AXLE} 7 ${FRONT_AXLE + 6} 10.6`}
        fill="none"
        stroke={WHITE}
        strokeWidth={0.9}
        strokeLinecap="round"
      />

      {FRONT_WING.map((d) => (
        <path key={d} d={d} fill={WHITE} />
      ))}
    </g>
  );
}
