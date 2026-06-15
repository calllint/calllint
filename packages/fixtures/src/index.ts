import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import type { Verdict } from "@mcpguard/types"

const here = dirname(fileURLToPath(import.meta.url))
/** packages/fixtures/golden */
export const GOLDEN_DIR = join(here, "..", "golden")

export function goldenPath(file: string): string {
  return join(GOLDEN_DIR, file)
}

export function readGolden(file: string): string {
  return readFileSync(goldenPath(file), "utf8")
}

/**
 * The verdict contract. Changing any expected value here requires an ADR
 * (see docs/adr/0005-golden-fixtures.md). "parse-error" means the config is
 * not valid JSON and scanning must report a parse error.
 */
export interface GoldenCase {
  file: string
  /** Expected aggregate verdict for the whole config, or a parse error. */
  expect: Verdict | "parse-error"
  /** The server name inside the config (for single-server fixtures). */
  server?: string
}

export const GOLDEN_CASES: readonly GoldenCase[] = [
  { file: "safe-time.json", expect: "SAFE", server: "time" },
  { file: "review-github.json", expect: "REVIEW", server: "github" },
  { file: "block-filesystem.json", expect: "BLOCK", server: "filesystem" },
  { file: "unknown-remote.json", expect: "UNKNOWN", server: "custom-remote" },
  { file: "block-prompt-poison.json", expect: "BLOCK", server: "helpful-notes" },
  { file: "review-unpinned-package.json", expect: "REVIEW", server: "weather" },
  { file: "block-dangerous-command.json", expect: "BLOCK", server: "shell-runner" },
  { file: "safe-filesystem-workspace.json", expect: "SAFE", server: "filesystem" },
  { file: "review-financial.json", expect: "REVIEW", server: "payments" },
  { file: "malformed.json", expect: "parse-error" },
] as const
