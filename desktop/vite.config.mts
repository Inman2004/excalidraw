import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = (p: string) => path.resolve(__dirname, "../packages", p);

// Builds the editor straight from the monorepo sources (same aliases as excalidraw-app).
export default defineConfig({
  clearScreen: false,
  envDir: "../",
  publicDir: "../public",
  server: { port: 1420, strictPort: true },
  resolve: {
    alias: [
      { find: /^@excalidraw\/common$/, replacement: pkg("common/src/index.ts") },
      { find: /^@excalidraw\/common\/(.*?)/, replacement: pkg("common/src/$1") },
      { find: /^@excalidraw\/element$/, replacement: pkg("element/src/index.ts") },
      { find: /^@excalidraw\/element\/(.*?)/, replacement: pkg("element/src/$1") },
      { find: /^@excalidraw\/excalidraw$/, replacement: pkg("excalidraw/index.tsx") },
      { find: /^@excalidraw\/excalidraw\/(.*?)/, replacement: pkg("excalidraw/$1") },
      { find: /^@excalidraw\/math$/, replacement: pkg("math/src/index.ts") },
      { find: /^@excalidraw\/math\/(.*?)/, replacement: pkg("math/src/$1") },
      { find: /^@excalidraw\/utils$/, replacement: pkg("utils/src/index.ts") },
      { find: /^@excalidraw\/utils\/(.*?)/, replacement: pkg("utils/src/$1") },
      { find: /^@excalidraw\/fractional-indexing$/, replacement: pkg("fractional-indexing/src/index.ts") },
      { find: /^@excalidraw\/laser-pointer$/, replacement: pkg("laser-pointer/src/index.ts") },
    ],
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        shell: path.resolve(__dirname, "index.html"),
        editor: path.resolve(__dirname, "editor.html"),
      },
    },
    target: "es2022",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 5000,
  },
  plugins: [react()],
});
