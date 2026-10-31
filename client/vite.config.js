import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(here, ".."), "");
  const api = `http://localhost:${process.env.PORT || rootEnv.PORT || 3000}`;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": api,
        "/uploads": api,
      },
      fs: {
        // Only the shared contacts defaults are read from outside client/ — not the whole project (.env, data/).
        allow: [searchForWorkspaceRoot(process.cwd()), path.resolve(here, "../config/contacts.defaults.json")],
      },
    },
  };
});
