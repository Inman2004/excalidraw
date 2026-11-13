import path from "path";
import fs from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = (p: string) => path.resolve(__dirname, "../packages", p);

// Builds the editor straight from the monorepo sources (same aliases as excalidraw-app).
const WEB_ONLY = [
  "service-worker.js",
  "_headers",
  "robots.txt",
  "og-image-3.png",
  "screenshots",
  "sidebar-comments-promo-dark.jpg",
  "sidebar-comments-promo-light.jpg",
  "sidebar-presentation-promo-dark.jpg",
  "sidebar-presentation-promo-light.jpg",
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
  "maskable_icon_x192.png",
  "maskable_icon_x512.png",
  "apple-touch-icon.png",
];

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
  plugins: [
    react(),
    {
      // the shared public/ folder also holds web-app-only files the desktop
      // app never loads (PWA worker, promo art, store screenshots)
      name: "drop-web-only-assets",
      apply: "build",
      closeBundle() {
        const out = path.resolve(__dirname, "dist");
        for (const name of WEB_ONLY) {
          fs.rmSync(path.join(out, name), { recursive: true, force: true });
        }
      },
    },
  ],
});
