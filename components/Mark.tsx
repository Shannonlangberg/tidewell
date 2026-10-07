type Props = { width: number; fill: string; hole: string };

/** The key tag at header scale: arch top (radius = half width), 2px bottom, one hole. Height = 1.4 × width. */
export function Mark({ width, fill, hole }: Props) {
  const height = Math.round(width * 1.4);
  return (
    <span
      aria-hidden
      className="mark"
      style={
        {
          width,
          height,
          background: fill,
          borderRadius: `${width / 2}px ${width / 2}px 2px 2px`,
          "--mark-hole": hole,
          "--mark-hole-top": `${Math.round(width / 4)}px`,
        } as React.CSSProperties
      }
    />
  );
}
