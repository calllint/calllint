import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import type { RiskClass, RiskSymbol, Verdict } from "@calllint/types"

const here = dirname(fileURLToPath(import.meta.url))
/** packages/fixtures/golden */
export const GOLDEN_DIR = join(here, "..", "golden")
/** packages/fixtures/surfaces — committed document-surface fixtures (ADR 0015). */
export const SURFACES_DIR = join(here, "..", "surfaces")

export function goldenPath(file: string): string {
  return join(GOLDEN_DIR, file)
}

/** Path to a committed surface fixture directory (e.g. "poisoned", "clean"). */
export function surfaceDirPath(name: string): string {
  return join(SURFACES_DIR, name)
}

export function readGolden(file: string): string {
  return readFileSync(goldenPath(file), "utf8")
}

/**
 * The verdict contract. Changing any expected value here requires an ADR
 * (golden-fixtures policy). "parse-error" means the config is
 * not valid JSON and scanning must report a parse error.
 */
export interface GoldenCase {
  file: string
  /** Expected aggregate verdict for the whole config, or a parse error. */
  expect: Verdict | "parse-error"
  /** The server name inside the config (for single-server fixtures). */
  server?: string
  /**
   * Expected risk class for the single server, when it is part of the contract.
   * Pinned for high-stakes fixtures (e.g. MONEY/S5) so a class regression fails
   * the build, not just a verdict regression.
   */
  expectRiskClass?: RiskClass
  /** Risk symbols that MUST appear in the report (subset check, not exact). */
  expectSymbols?: readonly RiskSymbol[]
}

export const GOLDEN_CASES: readonly GoldenCase[] = [
  { file: "safe-time.json", expect: "SAFE", server: "time" },
  { file: "review-github.json", expect: "REVIEW", server: "github" },
  { file: "block-filesystem.json", expect: "BLOCK", server: "filesystem" },
  { file: "unknown-remote.json", expect: "UNKNOWN", server: "custom-remote" },
  {
    // ADR 0010 / RC-BLK-01: a server shape the parser cannot resolve into a
    // recognized runtime (here a nested `server.url`) has no url/command at the
    // recognized depth, so `sourceKnown` is false. It must be UNKNOWN, never the
    // dangerous false-SAFE that "no findings" would otherwise produce.
    file: "unknown-unrecognized-shape.json",
    expect: "UNKNOWN",
    server: "custom-remote",
  },
  { file: "block-prompt-poison.json", expect: "BLOCK", server: "helpful-notes" },
  {
    // ADR 0014 (R4): hidden/obfuscated content in model-visible tool metadata
    // (here an HTML comment hiding a model-directed instruction) → REVIEW via
    // prompt.hidden-instructions (non-blocker, complements prompt.poisoning).
    file: "review-hidden-instructions.json",
    expect: "REVIEW",
    server: "notes",
    expectSymbols: ["PROMPT"],
  },
  {
    // ADR 0014 negative: legitimate non-ASCII text (accented Spanish/German) is
    // not hidden/obfuscated content and must not trigger.
    file: "safe-clean-unicode-metadata.json",
    expect: "SAFE",
    server: "i18n-notes",
  },
  { file: "review-unpinned-package.json", expect: "REVIEW", server: "weather" },
  { file: "block-dangerous-command.json", expect: "BLOCK", server: "shell-runner" },
  { file: "block-powershell-command.json", expect: "BLOCK", server: "ps-runner" },
  { file: "block-windows-user-profile.json", expect: "BLOCK", server: "filesystem" },
  {
    // ADR 0012: a docker bind-mount host path (--mount type=bind,src=/Users/...)
    // is broad host access hidden inside a compound arg → BLOCK.
    file: "block-docker-bind-broad.json",
    expect: "BLOCK",
    server: "filesystem",
    expectSymbols: ["FILES"],
  },
  { file: "safe-filesystem-workspace.json", expect: "SAFE", server: "filesystem" },
  {
    // ADR 0012 negative: a named volume (claude-memory:/app) and a
    // workspace-scoped bind (${workspaceFolder}/data) are not broad host paths.
    file: "safe-docker-volume-scoped.json",
    expect: "SAFE",
    server: "memory",
  },
  { file: "safe-windows-workspace.json", expect: "SAFE", server: "filesystem" },
  {
    // ADR 0011 Direction 2: a bare local interpreter running a local script
    // (node ./dist/server.js) is an observable but unverified source → REVIEW,
    // via exec.unverified-local-source. SAFE stays reachable only for recognized,
    // inspectable sources (packages, pinned images, allowlisted remotes).
    file: "review-unverified-local-source.json",
    expect: "REVIEW",
    server: "local-tool",
    expectSymbols: ["EXEC"],
  },
  {
    file: "review-financial.json",
    expect: "REVIEW",
    server: "payments",
    expectRiskClass: "S5",
    expectSymbols: ["MONEY"],
  },
  {
    file: "block-observed-payment.json",
    expect: "BLOCK",
    server: "merchant",
    expectRiskClass: "S5",
    expectSymbols: ["MONEY"],
  },
  { file: "malformed.json", expect: "parse-error" },
] as const
