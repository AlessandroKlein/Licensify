import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
  platform: "node",
  // Node built-ins must stay external (this is a library).
  external: ["node:crypto", "node:os", "node:fs", "node:path", "node:child_process", "node:perf_hooks", "node:buffer"],
});
