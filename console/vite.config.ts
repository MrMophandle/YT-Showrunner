/**
 * Vite dev/build config for the console client. Proposed dev ports per the
 * task spec (Phase 1 settled these — MEDIUM confidence, not inherited): Vite
 * on 5173, proxying `/api` to the Hono server on 8787 so the browser only
 * ever talks to one origin in dev.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SERVER_PORT = Number(process.env.YTS_CONSOLE_PORT ?? 8787);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
