import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset URLs: GitHub Pages serves the game from /ai-assisted-lab-5/, not from the site root.
  base: "./",
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: { include: ["test/**/*.test.ts"], testTimeout: 60_000 },
  build: {
    target: "es2022",
    // Source maps in the production build so F5 on the preview config can hit TS breakpoints too.
    sourcemap: true,
  },
});
