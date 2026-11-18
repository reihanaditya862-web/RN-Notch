/**
 * A team's logo on a light chip, set at a slight angle at the side of the
 * winner card. Team logos are made for light backgrounds, so on the black
 * capsule they need one.
 */
export function TeamLogo({ src, team, small }: { src: string; team: string; small?: boolean }) {
  return (
    <span
      title={team}
      className={[
        "flex shrink-0 -rotate-6 items-center justify-center rounded-md bg-white/95 shadow-[0_2px_8px_rgb(0_0_0/0.4)]",
        small ? "h-6 w-10 p-0.5" : "h-9 w-14 p-1",
      ].join(" ")}
    >
      <img src={src} alt={`${team} logo`} draggable={false} className="max-h-full max-w-full object-contain" />
    </span>
  );
}
