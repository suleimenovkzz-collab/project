import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/uploads": "http://localhost:3000",
    },
    fs: {
      // Only the shared contacts defaults are read from outside client/ — not the whole project (.env, data/).
      allow: [searchForWorkspaceRoot(process.cwd()), path.resolve(here, "../config/contacts.defaults.json")],
    },
  },
});
