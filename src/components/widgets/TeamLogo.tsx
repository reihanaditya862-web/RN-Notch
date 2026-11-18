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
      style={{ background: `linear-gradient(90deg, ${color}70 0%, ${color}24 42%, transparent 75%)` }}
    />
  );
}

/**
 * The winner's portrait in front of the team logo: the photo as a rounded
 * square in the team colour, and behind it a larger, tilted card carrying
 * the logo that fades out to the right, into the capsule. The element is
 * wider than the photo, so the text beside it starts after the fade.
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
  /** Side of the photo, in px; the logo card is about 1.4 times larger. */
  size: number;
}) {
  return (
    <span className="relative shrink-0" style={{ width: Math.round(size * 1.8), height: size }}>
      {logo && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute flex items-center justify-center rounded-xl bg-white/95"
          style={{
            left: Math.round(size * 0.45),
            top: Math.round(-size * 0.2),
            width: Math.round(size * 1.45),
            height: Math.round(size * 1.15),
            // The photo covers the card's left part; the logo sits in the rest.
            padding: Math.round(size * 0.1),
            paddingLeft: Math.round(size * 0.62),
            transform: "rotate(-9deg)",
            maskImage: "linear-gradient(90deg, #000 0%, #000 62%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(90deg, #000 0%, #000 62%, transparent 100%)",
          }}
        >
          <img src={logo} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
        </span>
      )}
      <span
        className="relative z-10 flex items-center justify-center overflow-hidden rounded-xl shadow-[0_6px_18px_rgb(0_0_0/0.55)]"
        style={{ width: size, height: size, backgroundColor: color }}
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
