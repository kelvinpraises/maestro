import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

import { resolve } from "node:path";

// The node-polyfills plugin rewrites bare `buffer`/`global`/`process` imports to
// `vite-plugin-node-polyfills/shims/<name>` specifiers. For our own source these
// resolve via `resolve.alias`, but when the rewrite happens inside an external
// `file:`-linked package (the generated Soroban bindings, symlinked out of the
// project root) the alias isn't applied and rollup fails to load the bare shim
// specifier. This tiny pre-resolver maps those specifiers to their concrete
// dist files for every importer, in-project or not.
const SHIM_ROOT = resolve(__dirname, "node_modules/vite-plugin-node-polyfills/shims");
const shimResolver = {
  name: "maestro-node-polyfill-shim-resolver",
  enforce: "pre" as const,
  resolveId(id: string) {
    const match = id.match(/^vite-plugin-node-polyfills\/shims\/(buffer|global|process)$/);
    if (match) return resolve(SHIM_ROOT, match[1], "dist/index.js");
    return null;
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    shimResolver,
    tanstackRouter({
      routesDirectory: "./src/app",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    viteReact(),
    tailwindcss(),
    nodePolyfills({
      include: ["buffer", "crypto", "stream", "assert", "process", "util", "events"],
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
      overrides: {
        fs: "empty",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      // The generated Soroban bindings (linked from ../packages via
      // `file:` deps) `import { Buffer } from "buffer"`. Point bare `buffer` at
      // the real installed polyfill package so those external modules resolve.
      buffer: resolve(__dirname, "node_modules/buffer"),
      // Point the shim specifiers at explicit dist entry files (not the shim
      // package directories) so they also resolve when the rewritten import
      // originates from an external `file:`-linked package (the bindings).
      "vite-plugin-node-polyfills/shims/buffer": resolve(__dirname, "node_modules/vite-plugin-node-polyfills/shims/buffer/dist/index.js"),
      "vite-plugin-node-polyfills/shims/global": resolve(__dirname, "node_modules/vite-plugin-node-polyfills/shims/global/dist/index.js"),
      "vite-plugin-node-polyfills/shims/process": resolve(__dirname, "node_modules/vite-plugin-node-polyfills/shims/process/dist/index.js"),
    },
  },
  optimizeDeps: {
    exclude: ["snarkjs"],
  },
});
