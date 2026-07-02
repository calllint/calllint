import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@calllint/types": r("./packages/types/src/index.ts"),
      "@calllint/config-parser": r("./packages/config-parser/src/index.ts"),
      "@calllint/resolver": r("./packages/resolver/src/index.ts"),
      "@calllint/static-analyzer": r("./packages/static-analyzer/src/index.ts"),
      "@calllint/risk-engine": r("./packages/risk-engine/src/index.ts"),
      "@calllint/policy": r("./packages/policy/src/index.ts"),
      "@calllint/fingerprint": r("./packages/fingerprint/src/index.ts"),
      "@calllint/report-renderer": r("./packages/report-renderer/src/index.ts"),
      "@calllint/core": r("./packages/core/src/index.ts"),
      "@calllint/online": r("./packages/online/src/index.ts"),
      "@calllint/fixtures": r("./packages/fixtures/src/index.ts"),
      "@calllint/signature": r("./packages/signature/src/index.ts"),
    },
  },
  test: {
    globals: false,
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
})
