import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "vouch — observe the ALMA world",
        short_name: "vouch",
        description: "Watch a vouch node: a protocol for portable identity and trust.",
        theme_color: "#0b1020",
        background_color: "#0b1020",
        icons: [{ src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
    }),
  ],
  server: {
    proxy: {
      // The observation server sets NO CORS headers, so in dev we proxy /api → :8787.
      // In production, point VITE_NODE_URL at a node whose deployment edge sets CORS.
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
