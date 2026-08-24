/**
 * Vite dev/build config for the console client. Dev ports (console-dev-ports
 * task, moved out of the 51XX/87XX default-collision range into 61XX): Vite
 * on 6173, proxying `/api` to the Hono server on 6187 so the browser only
 * ever talks to one origin in dev. `strictPort: true` makes Vite fail
 * loudly instead of silently relocating to another port when 6173 is busy.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { DEFAULT_CONSOLE_PORT } from "./ports.js";

export const CLIENT_PORT = Number(process.env.YTS_CLIENT_PORT ?? 6173);
export const SERVER_PORT = Number(process.env.YTS_CONSOLE_PORT ?? DEFAULT_CONSOLE_PORT);

export default defineConfig({
  plugins: [react()],
  server: {
    port: CLIENT_PORT,
    strictPort: true,
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
