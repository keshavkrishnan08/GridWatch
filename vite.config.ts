import { defineConfig } from "vite";

// Relative base so the static build runs from any host or sub-path
// (Vercel, Netlify, GitHub Pages project sites, plain file server).
export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
    outDir: "dist",
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 2000,
    sourcemap: false,
  },
  server: {
    port: 5173,
    host: true,
  },
});
