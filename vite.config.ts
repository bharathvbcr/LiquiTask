import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { ViteImageOptimizer } from "vite-plugin-image-optimizer";
import { VitePWA } from "vite-plugin-pwa";

const devPort = Number(process.env.PORT) || 4000;
const previewPort = Number(process.env.PORT) || 4173;
// When PORT is assigned (dev-autoport / preview launcher), pin it. Otherwise let
// Vite pick the next free port from the default.
const strictPort = process.env.PORT != null;

export default defineConfig({
  base: "./",
  // Tauri reads the dev server at devUrl; don't let Vite clear the screen (hides
  // Rust compiler output).
  clearScreen: false,
  // Expose TAURI_ env vars to the frontend alongside the default VITE_ prefix.
  envPrefix: ["VITE_", "TAURI_ENV_"],
  server: {
    port: devPort,
    strictPort,
    host: "0.0.0.0",
  },
  preview: {
    port: previewPort,
    strictPort: process.env.PORT != null,
  },
  plugins: [
    react(),
    ViteImageOptimizer({
      png: { quality: 80 },
      jpeg: { quality: 80 },
      webp: { lossless: true },
    }),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: "LiquiTask",
        short_name: "LiquiTask",
        description: "Premium Kanban Task Management",
        theme_color: "#05080f",
        icons: [
          {
            src: "/icon.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
    }),
  ],
  build: {
    target: "chrome105",
    minify: "esbuild",
    sourcemap: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
