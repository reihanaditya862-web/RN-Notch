import { initials } from "../../lib/f1";

/**
 * A soft gradient of the team colour from the left edge, fading into the
 * black capsule. The parent must be `relative overflow-hidden`.
 */
export function TeamGlow({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{ background: `linear-gradient(90deg, ${color}66 0%, ${color}22 42%, transparent 75%)` }}
    />
  );
}

/**
 * The winner's portrait with the team logo behind it. The logo has no
 * background of its own (see `lib/logo.ts`); it is drawn half again as tall
 * as the photo, glows faintly in the team colour and fades out to the right
 * and towards the capsule's edges, so it sits in the notch rather than on it.
 */
export function WinnerHero({
  photo,
  logo,
  color,
  driver,
  size,
}: {
  photo: string | null;
  logo: string | null;
  color: string;
  driver: string;
  /** Diameter of the photo, in px. */
  size: number;
}) {
  return (
    <span className="relative shrink-0" style={{ width: Math.round(size * 1.3), height: size }}>
      {logo && (
        <img
          src={logo}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute top-1/2 w-auto max-w-none -translate-y-1/2 object-contain"
          style={{
            left: Math.round(size * 0.3),
            height: Math.round(size * 1.5),
            maxWidth: Math.round(size * 3.4),
            opacity: 0.55,
            filter: `drop-shadow(0 0 ${Math.round(size * 0.12)}px ${color}99)`,
            maskImage:
              "linear-gradient(90deg, #000 0%, #000 40%, transparent 100%), linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%)",
            maskComposite: "intersect",
            WebkitMaskComposite: "source-in",
          }}
        />
      )}
      <span
        className="relative z-10 flex items-center justify-center overflow-hidden rounded-full"
        style={{
          width: size,
          height: size,
          backgroundColor: color,
          boxShadow: `0 0 0 2px ${color}, 0 6px 18px rgb(0 0 0 / 0.55)`,
        }}
      >
        {photo ? (
          <img src={photo} alt="" draggable={false} className="h-full w-full object-cover object-top" />
        ) : (
          <span className="font-display font-bold text-white" style={{ fontSize: Math.round(size * 0.32) }}>
            {initials(driver)}
          </span>
        )}
      </span>
    </span>
  );
}
