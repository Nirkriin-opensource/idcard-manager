import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: [
    "argon2",
    "sharp",
    "jsfeat",
    "pg",
    "pg-boss",
    "@bwip-js/node",
    "exceljs",
    "yauzl",
    "pdfkit",
    "fontkit",
    "archiver",
  ],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/verify/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
