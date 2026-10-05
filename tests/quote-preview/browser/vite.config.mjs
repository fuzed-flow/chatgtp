import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const path = value => fileURLToPath(new URL(value, import.meta.url));

export default defineConfig({
  root: path("./"),
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@/api/supabaseClient", replacement: path("./mockDb.js") },
      { find: "@", replacement: path("../../../src") },
    ],
  },
  server: { host: "127.0.0.1", port: 3012, strictPort: true, fs: { allow: [path("../../../")] } },
  css: { postcss: path("../../../") },
});
