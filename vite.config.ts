import type { UserConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { visualizer } from "rollup-plugin-visualizer";
import checker from "vite-plugin-checker";
const path = require("path");

const config: UserConfig = {
  root: "src/",
  base: "/systems/lancer/",
  publicDir: path.resolve(__dirname, "public"),
  server: {
    port: 30001,
    open: true,
    proxy: {
      "^(?!/systems/lancer)": "http://localhost:30000/",
      "/socket.io": {
        target: "ws://localhost:30000",
        ws: true,
      },
    },
  },
  resolve: {
    alias: [
      {
        find: "./runtimeConfig",
        replacement: "./runtimeConfig.browser",
      },
    ],
  },
  optimizeDeps: {
    include: ["@massif/lancer-data", "jszip" /* "axios" */], // machine-mind's cjs dependencies
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: false,
    sourcemap: true,
    brotliSize: true,
    lib: {
      name: "lancer",
      entry: path.resolve(__dirname, "src/lancer.ts"),
      formats: ["es"],
      fileName: "lancer",
    },
  },
  plugins: [
    svelte({
      configFile: "../svelte.config.cjs", // relative to src/
    }),
    checker({
      typescript: true,
      // svelte: { root: __dirname },
    }),
    visualizer({
      gzipSize: true,
      template: "treemap",
    }),
  ],
};

export default config;
