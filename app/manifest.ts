import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tidewell",
    short_name: "Tidewell",
    description: "Your place, kept well.",
    start_url: "/app/owner",
    scope: "/",
    display: "standalone",
    background_color: "#F1EBD9",
    theme_color: "#10382F",
    icons: [
      { src: "/pwa-icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
