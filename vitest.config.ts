import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@mcpguard/types": r("./packages/types/src/index.ts"),
      "@mcpguard/config-parser": r("./packages/config-parser/src/index.ts"),
      "@mcpguard/resolver": r("./packages/resolver/src/index.ts"),
      "@mcpguard/static-analyzer": r("./packages/static-analyzer/src/index.ts"),
      "@mcpguard/risk-engine": r("./packages/risk-engine/src/index.ts"),
      "@mcpguard/policy": r("./packages/policy/src/index.ts"),
      "@mcpguard/fingerprint": r("./packages/fingerprint/src/index.ts"),
      "@mcpguard/report-renderer": r("./packages/report-renderer/src/index.ts"),
      "@mcpguard/core": r("./packages/core/src/index.ts"),
      "@mcpguard/online": r("./packages/online/src/index.ts"),
      "@mcpguard/fixtures": r("./packages/fixtures/src/index.ts"),
    },
  },
  test: {
    globals: false,
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
})
