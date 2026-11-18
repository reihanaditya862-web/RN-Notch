/**
 * The team behind the winner: a gradient of the team colour and the team
 * logo, drawn large behind the driver's photo and name. Both fade out
 * towards the edges, so the card melts into the black capsule instead of
 * sitting on it as a box. The parent must be `relative overflow-hidden`.
 */
export function TeamBackdrop({
  logo,
  color,
  logoHeight,
}: {
  logo: string | null;
  color: string;
  /** Height of the logo in px; larger than the photo it sits behind. */
  logoHeight: number;
}) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span
        className="absolute inset-0"
        style={{
          background: `linear-gradient(90deg, ${color}66 0%, ${color}26 38%, transparent 72%)`,
        }}
      />
      {logo && (
        <img
          src={logo}
          alt=""
          draggable={false}
          className="absolute top-1/2 left-3 max-w-[78%] -translate-y-1/2 object-contain object-left"
          style={{
            height: logoHeight,
            opacity: 0.42,
            // Fades to nothing at its right end and towards the top and
            // bottom, where the capsule's edge takes over.
            maskImage:
              "linear-gradient(90deg, #000 0%, #000 45%, transparent 92%), linear-gradient(180deg, transparent 0%, #000 22%, #000 78%, transparent 100%)",
            maskComposite: "intersect",
            WebkitMaskComposite: "source-in",
          }}
        />
      )}
    </span>
  );
}
