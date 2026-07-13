/**
 * `calllint evidence` command — import a third-party scanner report into a
 * normalized evidence envelope (calllint.evidence-provider.v0).
 *
 * ADR 0034: Evidence Provider Envelope (new7 Phase B / v1.2.0).
 * Aggregate, don't impersonate: external findings/verdict are preserved verbatim;
 * a degraded/failed/malformed scan fails closed (never reads as a pass).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importEvidence, type EvidenceFormat } from '@calllint/evidence'
import type { CommandResult } from './scan.js'
import type { ParsedArgs } from '../args.js'

interface EvidenceDeps {
  cwd: string
}

export function evidenceCommand(args: ParsedArgs, deps: EvidenceDeps): CommandResult {
  const subcommand = args.positionals[0]

  if (!subcommand || subcommand === 'help') {
    return { stdout: evidenceHelp(), stderr: '', exitCode: 0 }
  }

  if (subcommand === 'import') {
    return evidenceImport(args, deps)
  }

  return {
    stdout: '',
    stderr: `Unknown evidence subcommand: ${subcommand}\nRun \`calllint evidence help\`.`,
    exitCode: 2,
  }
}

function evidenceImport(args: ParsedArgs, deps: EvidenceDeps): CommandResult {
  const file = args.positionals[1]
  if (!file) {
    return {
      stdout: '',
      stderr: 'Error: Missing report file\nUsage: calllint evidence import <report.json|.sarif> [--provider <p>] [--format json|sarif]',
      exitCode: 2,
    }
  }

  let rawText: string
  try {
    rawText = readFileSync(resolve(deps.cwd, file), 'utf-8')
  } catch (error) {
    const err = error as Error & { code?: string }
    const stderr = err.code === 'ENOENT' ? `Error: File not found: ${file}` : `Error: ${err.message}`
    return { stdout: '', stderr, exitCode: 2 }
  }

  const provider = args.flags['provider'] as string | undefined
  const formatFlag = args.flags['format'] as string | undefined
  const format: EvidenceFormat | undefined =
    formatFlag === 'sarif' ? 'sarif' : formatFlag === 'json' ? 'json' : undefined

  // importEvidence never throws: bad input yields a fail-closed envelope.
  const envelope = importEvidence(rawText, { provider, format })

  // Exit code reflects completeness (evidence quality), NOT a CallLint verdict:
  //   complete → 0 · partial → 10 (REVIEW-class) · degraded|failed → 20 (UNKNOWN-class, fail-closed)
  const exitCode =
    envelope.completeness === 'complete' ? 0 : envelope.completeness === 'partial' ? 10 : 20

  if (args.flags['json']) {
    return { stdout: JSON.stringify(envelope, null, 2), stderr: '', exitCode }
  }

  const badge =
    envelope.completeness === 'complete' ? '✓' : envelope.completeness === 'partial' ? '~' : '◇'
  let stdout = `\nCallLint evidence import\n`
  stdout += `provider:     ${envelope.provider} (${envelope.providerVersion})\n`
  stdout += `scan mode:    ${envelope.scanMode}\n`
  stdout += `completeness: ${badge} ${envelope.completeness}\n`
  stdout += `findings:     ${envelope.findings.length} (provider-native, not re-scored)\n`
  stdout += `raw digest:   ${envelope.rawReportDigest}\n`
  if (envelope.degradedReasons.length > 0) {
    stdout += `\ndegraded/failed reasons:\n`
    for (const r of envelope.degradedReasons) stdout += `  • ${r}\n`
  }
  stdout += `\nNote: external evidence is recorded, not converted into a CallLint verdict.\n`
  stdout += `A degraded or failed external scan is never treated as a pass.\n`

  return { stdout, stderr: '', exitCode }
}

function evidenceHelp(): string {
  return `
calllint evidence — Import third-party scanner evidence (no re-scoring)

USAGE
  calllint evidence import <report.json|.sarif> [options]

DESCRIPTION
  Parse a third-party scanner report (e.g. NVIDIA SkillSpector) into a normalized
  envelope (calllint.evidence-provider.v0). CallLint records the external evidence
  with provenance — provider, pinned version, scan mode, coverage, completeness,
  raw-report digest — WITHOUT re-scoring or renaming the provider's own findings.

  Aggregate, don't impersonate: an external SAFE never upgrades a CallLint verdict,
  and a degraded / failed / malformed scan fails closed (never reads as a pass).

OPTIONS
  --provider <name>   Force the provider adapter (default: auto-detect). e.g. skillspector
  --format json|sarif Force the input format (default: auto-detect)
  --json              Emit the raw envelope as JSON

EXIT CODES
  0   evidence complete
  10  evidence partial (review the gaps)
  20  evidence degraded/failed/malformed (fail-closed — not a pass)
  2   usage error / file not found

EXAMPLES
  calllint evidence import skillspector-report.json
  calllint evidence import skillspector.sarif --format sarif --json

SEE ALSO
  ADR 0034                        — Evidence Provider Envelope
  docs/new7-packet-a-evidence.md  — file-level execution plan
`
}
