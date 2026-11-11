import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist" },
  // `npm run dev:client` serves the client with hot reload and forwards /api to `wrangler dev`.
  server: { proxy: { "/api": "http://localhost:8787" } },
});
