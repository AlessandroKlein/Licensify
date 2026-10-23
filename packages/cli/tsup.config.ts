import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: true,
  clean: true,
  target: "node18",
  platform: "node",
  banner: { js: "#!/usr/bin/env node" },
  esbuildOptions(options) {
    // Bundle @licensify/core from source so the CLI is self-contained.
    options.alias = { "@licensify/core": "../core/src/index.ts" };
  },
});
