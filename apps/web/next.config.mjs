import { createVanillaExtractPlugin } from "@vanilla-extract/next-plugin";

const withVanillaExtract = createVanillaExtractPlugin();

/** @type {import("next").NextConfig} */
const nextConfig = {
  // The observation server sets no CORS headers, so proxy /api → it (dev + prod-same-origin).
  // Override the target with OBSERVATION_URL (e.g. a deployed node).
  async rewrites() {
    const target = process.env.OBSERVATION_URL ?? "http://localhost:8787";
    return [{ source: "/api/:path*", destination: `${target}/:path*` }];
  },
};

export default withVanillaExtract(nextConfig);
