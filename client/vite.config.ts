import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    fs: {
      allow: [path.resolve(root, "..")],
    },
  },
  build: {
    // three.js changes rarely: its own chunk stays cached across game updates.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes("node_modules/three/") ? "three" : undefined),
      },
    },
  },
});
