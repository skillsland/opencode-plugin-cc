import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "scripts/opencode-companion": "src/scripts/opencode-companion.ts",
    "scripts/session-lifecycle-hook": "src/scripts/session-lifecycle-hook.ts",
    "scripts/stop-review-gate-hook": "src/scripts/stop-review-gate-hook.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
});
