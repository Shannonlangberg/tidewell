import { ImageResponse } from "next/og";

export function tagIcon(size: number, rounded: boolean) {
  const w = size * 0.52;
  const hole = w / 4.5;
  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          background: "#10382F",
          borderRadius: rounded ? size * 0.2237 : 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-end",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: w,
            height: size * 0.78,
            background: "#E2622E",
            borderRadius: `${w / 2}px ${w / 2}px 0 0`,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div style={{ marginTop: hole, width: hole, height: hole, borderRadius: hole, background: "#10382F" }} />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
