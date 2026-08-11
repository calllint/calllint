import { describe, it, expect } from "vitest"
import {
  decideGate,
  measureIdentityConsistency,
  evaluateOneSourceConsistency,
  evaluateLocalBinding,
  evaluateOneTimeSetup,
  evaluateConversion,
  evaluateNoRegression,
  TARGET_MISMATCH_OUTCOME,
  type IdentitySurfaces,
  type MismatchRun,
  type WriteSite,
  type RollbackRun,
  type ConversionObservation,
  type GateRecord,
  type WiredCheck,
  type ServedGuard,
  type AggregatorReach,
} from "../src/phase24Gates.js"

// These tests exist for one reason: a gate that cannot fail proves nothing. Each
// block asserts the happy path AND mutates exactly one fact to prove the gate
// notices. The committed artifacts show the gates green; these show they are green
// because the product is, not because the evaluator is blind.

const DIGEST = "sha256:" + "a".repeat(64)

function identity(over: Partial<IdentitySurfaces> = {}): IdentitySurfaces {
  return {
    canonicalName: "mcp-registry/example",
    surfaces: [
      { surface: "trust.json", artifactDigest: DIGEST, verdict: "SAFE", verdictLabel: "No blockers observed" },
      { surface: "manifest.json", artifactDigest: DIGEST, verdict: "SAFE", verdictLabel: "No blockers observed" },
      { surface: "index.html", artifactDigest: DIGEST, verdict: null, verdictLabel: "No blockers observed" },
    ],
    ...over,
  }
}

describe("decideGate", () => {
  it("PASSES only when every measure passed", () => {
    expect(decideGate([{ id: "a", pass: true, observed: "" }]).status).toBe("PASSED")
    expect(decideGate([{ id: "a", pass: false, observed: "nope" }]).status).toBe("FAILED")
  })

  it("FAILS an empty measure set — nothing to grade is not a pass", () => {
    const r = decideGate([], 1)
    expect(r.status).toBe("FAILED")
    expect(r.blockers[0]).toContain("nothing to grade")
  })
})

describe("Gate 2.4-A · one-source consistency", () => {
  it("passes when every surface that carries a fact agrees", () => {
    expect(measureIdentityConsistency(identity()).pass).toBe(true)
  })

  it("treats a null as 'not published here', not as a mismatch", () => {
    // index.html carries no machine verdict. That must not read as disagreement.
    const m = measureIdentityConsistency(identity())
    expect(m.pass).toBe(true)
    expect(m.observed).toContain("3 surfaces agree")
  })

  it("FAILS when one surface publishes a different digest", () => {
    const bad = identity({
      surfaces: [
        { surface: "trust.json", artifactDigest: DIGEST, verdict: "SAFE", verdictLabel: "L" },
        { surface: "manifest.json", artifactDigest: "sha256:" + "b".repeat(64), verdict: "SAFE", verdictLabel: "L" },
      ],
    })
    const m = measureIdentityConsistency(bad)
    expect(m.pass).toBe(false)
    // The blocker must name both surfaces, or it cannot be acted on.
    expect(m.observed).toContain("trust.json")
    expect(m.observed).toContain("manifest.json")
  })

  it("FAILS when a fact is published by NO surface", () => {
    const m = measureIdentityConsistency(
      identity({ surfaces: [{ surface: "trust.json", artifactDigest: null, verdict: "SAFE", verdictLabel: "L" }] }),
    )
    expect(m.pass).toBe(false)
    expect(m.observed).toContain("not published by ANY surface")
  })

  it("FAILS when a surface silently stopped being emitted", () => {
    // The trap this guards: fewer surfaces would otherwise 'agree' trivially.
    const thin = identity({ surfaces: identity().surfaces.slice(0, 2) })
    const r = evaluateOneSourceConsistency([thin], 1, 3)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("only 2 of 3 surfaces")
  })

  it("FAILS when the cohort shrinks", () => {
    expect(evaluateOneSourceConsistency([identity()], 19, 3).status).toBe("FAILED")
  })
})

function mismatch(over: Partial<MismatchRun> = {}): MismatchRun {
  return { id: "artifact-digest", outcome: TARGET_MISMATCH_OUTCOME, exitCode: 20, planDigest: null, hostConfigWritten: false, explains: true, ...over }
}
const OK_SITE: WriteSite = { file: "safeInstall.ts", line: 1, destination: "writeFileSync(scratch)", allowed: true, why: "scratch" }

describe("Gate 2.4-D · local binding", () => {
  it("passes a refusal that wrote nothing and explained itself", () => {
    expect(evaluateLocalBinding([mismatch()], [OK_SITE], 1).status).toBe("PASSED")
  })

  it("FAILS if the host config was written — the filesystem is the decisive measure", () => {
    const r = evaluateLocalBinding([mismatch({ hostConfigWritten: true })], [OK_SITE], 1)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("HOST CONFIG WAS WRITTEN")
  })

  it("FAILS if a writable plan digest came back despite the mismatch", () => {
    expect(evaluateLocalBinding([mismatch({ planDigest: DIGEST })], [OK_SITE], 1).status).toBe("FAILED")
  })

  it("FAILS if the refusal exits 0 — a mismatch must not look like success", () => {
    expect(evaluateLocalBinding([mismatch({ exitCode: 0 })], [OK_SITE], 1).status).toBe("FAILED")
  })

  it("FAILS if the refusal does not name the falsified dimension", () => {
    expect(evaluateLocalBinding([mismatch({ explains: false })], [OK_SITE], 1).status).toBe("FAILED")
  })

  it("FAILS on a renamed outcome, so a silent rename cannot pass as plausible", () => {
    expect(evaluateLocalBinding([mismatch({ outcome: "SOMETHING_ELSE" })], [OK_SITE], 1).status).toBe("FAILED")
  })

  it("FAILS on an unclassified write site (INV-2.4-03, one writer)", () => {
    const bad: WriteSite = { file: "safeInstall.ts", line: 9, destination: "writeFileSync(hostConfig)", allowed: false, why: "tainted" }
    const r = evaluateLocalBinding([mismatch()], [OK_SITE, bad], 1)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("safeInstall.ts:9")
  })

  it("FAILS when the matrix is short — a skipped dimension is not a pass", () => {
    expect(evaluateLocalBinding([mismatch()], [OK_SITE], 3).status).toBe("FAILED")
  })
})

const STEP = { fixture: "f", step: "prepare", persistentComponents: [] as string[], workspaceFiles: [] as string[] }
function rollback(over: Partial<RollbackRun> = {}): RollbackRun {
  return { id: "r", digestBefore: DIGEST, digestAfter: DIGEST, outcome: "VERIFICATION_FAILED", rolledBack: true, workspaceFiles: [], ...over }
}

describe("Gate 2.4-E · one-time setup", () => {
  it("passes a clean one-time footprint with a restoring rollback", () => {
    expect(evaluateOneTimeSetup([STEP], [rollback()], 1).status).toBe("PASSED")
  })

  it("FAILS when a persistent component appears in one-time mode (INV-2.4-07)", () => {
    const r = evaluateOneTimeSetup([{ ...STEP, persistentComponents: ["calllint-guard:vscode"] }], [rollback()], 1)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("calllint-guard:vscode")
  })

  it("FAILS when the workspace gained a file", () => {
    expect(evaluateOneTimeSetup([{ ...STEP, workspaceFiles: [".calllint/state.json"] }], [rollback()], 1).status).toBe("FAILED")
  })

  it("FAILS when rollback ran but did NOT restore the pre-image", () => {
    // The distinction the gate exists for: 'rollback happened' ≠ 'config is back'.
    const r = evaluateOneTimeSetup([STEP], [rollback({ digestAfter: "sha256:" + "9".repeat(64) })], 1)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("NOT restored")
  })

  it("FAILS when rollback did not run at all", () => {
    expect(evaluateOneTimeSetup([STEP], [rollback({ rolledBack: false, outcome: "rollback_failed" })], 1).status).toBe("FAILED")
  })

  it("FAILS when no one-time steps were observed", () => {
    expect(evaluateOneTimeSetup([], [rollback()], 1).status).toBe("FAILED")
  })
})

const COMPONENT = { id: "calllint-guard:vscode", label: "VS Code folderOpen guard task", artifactPath: ".vscode/tasks.json", uninstallCommand: "remove it by hand" }
function conversion(over: Partial<ConversionObservation> = {}): ConversionObservation {
  const base = {
    host: "vscode",
    recommendation: "ASK_AFTER_SUCCESS",
    requiresSeparateAuthorization: true,
    declineOption: "Not now",
    disableCommand: "calllint guard disable",
    disclosureDigest: DIGEST,
    components: [COMPONENT],
    // PR P-5 defaults. `copySource: "configured"` mirrors the shipped edge; the sentinel
    // digest defaults to EQUAL, so the invariance measure passes unless a test moves it
    // deliberately — the same convention as every other field here.
    copySource: "configured" as const,
    disclosureDigestUnderSentinelCopy: DIGEST,
  }
  const merged = { ...base, ...over }
  return {
    ...merged,
    // The decline affordance is derived from `merged`, not hardcoded. PR P-5 made the gate
    // check `[${declineOption}]` rather than the literal `[Not now]`, so a fixture that
    // overrode `declineOption` while rendering a fixed `[Not now]` would now be testing the
    // mismatch instead of the case it was written for. Deriving keeps each test's intent
    // exactly what its name says, and the mismatch gets its own named test below.
    renderedText:
      over.renderedText ??
      `${COMPONENT.label} (${COMPONENT.id})\n  creates: ${COMPONENT.artifactPath}\n  remove: ${COMPONENT.uninstallCommand}\n  disable later: ${merged.disableCommand}\n  [${merged.declineOption}]`,
  }
}

describe("Gate 2.4-F · continuous-protection conversion", () => {
  it("passes a fully disclosed offer", () => {
    expect(evaluateConversion([conversion()], 1).status).toBe("PASSED")
  })

  it("FAILS when the object discloses a component the RENDERER omits", () => {
    // The exact deception the two-sided measurement exists to catch.
    const r = evaluateConversion([conversion({ renderedText: "Enable protection?  [Not now]  calllint guard disable" })], 1)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("not disclosed in the rendered offer")
  })

  it("FAILS when the artifact path is not shown — 'somewhere' is not disclosure", () => {
    const r = evaluateConversion([
      conversion({ renderedText: `${COMPONENT.label} (${COMPONENT.id})\n remove: ${COMPONENT.uninstallCommand}\n disable later: calllint guard disable\n [Not now]` }),
    ], 1)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain(".vscode/tasks.json")
  })

  it("FAILS when [Not now] is missing — consent needs a visible exit", () => {
    expect(evaluateConversion([conversion({ renderedText: "Enabling protection…" })], 1).status).toBe("FAILED")
  })

  it("FAILS when the disable command is never shown to the human", () => {
    const r = evaluateConversion([
      conversion({ renderedText: `${COMPONENT.label} (${COMPONENT.id})\n creates: ${COMPONENT.artifactPath}\n remove: ${COMPONENT.uninstallCommand}\n [Not now]` }),
    ], 1)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("is not shown to the human")
  })

  it("FAILS when a one-time setup would authorize persistent protection", () => {
    expect(evaluateConversion([conversion({ requiresSeparateAuthorization: false })], 1).status).toBe("FAILED")
  })

  it("FAILS when a component has no uninstall command", () => {
    const noUninstall = { ...COMPONENT, uninstallCommand: "" }
    const r = evaluateConversion([conversion({ components: [noUninstall] })], 1)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("no uninstallCommand")
  })

  it("FAILS when a guard host is missing from the cohort", () => {
    expect(evaluateConversion([conversion()], 7).status).toBe("FAILED")
  })

  // --- PR P-5: configuration now sits beside these floors ---------------------

  it("FAILS when configured copy moves the disclosureDigest — wording must never move the approval token", () => {
    // The one measure P-5 added, and the reason it exists. A human approves a COMPONENT SET,
    // and `disclosureDigest` is the token recording what they were shown. Its preimage covers
    // components only (continuousProtection.ts:187-197 — id/artifactPath/posture/install/
    // uninstall, and deliberately NOT `label`), so re-rendering with sentinel copy must
    // reproduce it exactly. If it ever does not, an editorial change could invalidate an
    // approval that a human already gave, which is why this fails the gate rather than
    // warning. The negative control for the preimage: add `label` to it and this goes red.
    const r = evaluateConversion(
      [conversion({ disclosureDigestUnderSentinelCopy: "sha256:" + "b".repeat(64) })],
      1,
    )
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("under sentinel copy")
  })

  it("FAILS when the decline affordance is rendered as a literal instead of derived from declineOption", () => {
    // Why the check is `[${declineOption}]` and not the literal `[Not now]`. This fixture is
    // exactly the shape the old literal check could not see: the offer says the exit is
    // "Later", the render shows "[Not now]". Under the literal form both halves passed — the
    // field equality still held against its own value and the literal was present in the
    // text — so a render could show a button the offer did not offer. Nothing else in this
    // suite fails on it, which is what makes the derivation load-bearing rather than cosmetic.
    const r = evaluateConversion(
      [
        conversion({
          declineOption: "Later",
          renderedText: `${COMPONENT.label} (${COMPONENT.id})\n  creates: ${COMPONENT.artifactPath}\n  remove: ${COMPONENT.uninstallCommand}\n  disable later: calllint guard disable\n  [Not now]`,
        }),
      ],
      1,
    )
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("[Later] is not visible")
  })

  it("PASSES a fully disclosed offer built from configured copy", () => {
    // The positive half: `copySource: "configured"` is an audit field, not a fault. A gate
    // that failed on it would make reading the copy plane look like a regression.
    const r = evaluateConversion([conversion({ copySource: "configured" })], 1)
    expect(r.status).toBe("PASSED")
    expect(r.measures.map((m) => m.id)).toContain("disclosure-digest-invariant-under-configured-copy")
  })
})

// --- Gate 2.4-H · no regression ----------------------------------------------

// Named, not indexed: `noUncheckedIndexedAccess` is on, and naming the two rows
// also makes each mutation below say which gate it is falsifying.
const GATE_A: GateRecord = {
  gate: "2.4-A",
  artifact: "artifacts/phase-2.4/gate-A-consistency.json",
  status: "PASSED",
  machineDecidable: true,
}
const GATE_B_HUMAN: GateRecord = {
  gate: "2.4-B",
  artifact: "artifacts/phase-2.4/human-five-second-test.json",
  status: "PENDING_HUMAN_PANEL",
  machineDecidable: false,
}
const GATES: readonly GateRecord[] = [GATE_A, GATE_B_HUMAN]

function check(over: Partial<WiredCheck> = {}): WiredCheck {
  return {
    id: "eval:phase-2.4",
    script: "tsx scripts/phase-2.4-eval.ts",
    inLocalChain: true,
    workflowBinding: "ci.yml#test",
    bindingFault: null,
    remoteOnly: false,
    role: "check",
    ...over,
  }
}

/** Today's shape: present, and `needs` covers the job every check binds to. */
const AGG: AggregatorReach = {
  workflow: "ci.yml",
  job: "build-and-test",
  present: true,
  needs: ["test"],
  parseError: null,
}

const GUARD: ServedGuard = {
  subtree: "apps/web/public/install/**",
  guardTest: "packages/trust-index/test/safe-install/committed-install-tree.test.ts",
  eolPinned: true,
}

const COUNT_PRODUCER = { source: "tools.ts", count: 13 }
const COUNT_ASSERTION = { source: "mcp-pack-smoke.mjs", count: 13 }
const COUNTS = [COUNT_PRODUCER, COUNT_ASSERTION]

describe("Gate 2.4-H — no regression", () => {
  it("PASSES when every gate row, check binding and served guard is in place", () => {
    const r = evaluateNoRegression(GATES, [check()], [GUARD], COUNTS, 2, AGG)
    expect(r.status).toBe("PASSED")
    expect(r.blockers).toEqual([])
  })

  it("a PENDING_HUMAN_PANEL gate does NOT regress the gate — unfinished human work is not a regression", () => {
    expect(evaluateNoRegression(GATES, [check()], [GUARD], COUNTS, 2, AGG).status).toBe("PASSED")
  })

  it("but a human gate is never counted as passed — it stays declared as human-blocked", () => {
    const r = evaluateNoRegression(GATES, [check()], [GUARD], COUNTS, 2, AGG)
    const declared = r.measures.find((m) => m.id === "human-gates-declared")!
    expect(declared.observed).toContain("human panel required")
    // The machine roll-up must not silently absorb it into the passing set.
    expect(r.measures.find((m) => m.id === "machine-gates-passed")!.observed).not.toContain("2.4-B")
  })

  it("FAILS when a gate artifact was deleted — removing evidence must not make the gate greener", () => {
    const missing: GateRecord[] = [GATE_A, { ...GATE_B_HUMAN, artifact: null, status: "MISSING" }]
    const r = evaluateNoRegression(missing, [check()], [GUARD], COUNTS, 2, AGG)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("MISSING: 2.4-B")
  })

  it("FAILS when a gate row is dropped from the roll-up entirely", () => {
    const r = evaluateNoRegression([GATE_A], [check()], [GUARD], COUNTS, 2, AGG)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("1/2 gate rows")
  })

  it("FAILS when a machine-decidable gate went red", () => {
    const red: GateRecord[] = [{ ...GATE_A, status: "FAILED" }, GATE_B_HUMAN]
    const r = evaluateNoRegression(red, [check()], [GUARD], COUNTS, 2, AGG)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("2.4-A=FAILED")
  })

  it("FAILS when the MCP tool count drifts between producer and assertion", () => {
    const drifted = [{ ...COUNT_PRODUCER, count: 14 }, COUNT_ASSERTION]
    const r = evaluateNoRegression(GATES, [check()], [GUARD], drifted, 2, AGG)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("tools.ts=14 vs mcp-pack-smoke.mjs=13")
  })

  it("FAILS when only one source states the tool count — agreement needs two", () => {
    const r = evaluateNoRegression(GATES, [check()], [GUARD], [COUNT_PRODUCER], 2, AGG)
    expect(r.status).toBe("FAILED")
  })

  it("FAILS when a check script was deleted from package.json", () => {
    const r = evaluateNoRegression(GATES, [check({ script: null })], [GUARD], COUNTS, 2, AGG)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("a gate mechanism was removed")
  })

  it("FAILS when a check runs only in ci:local — a local-only check blocks no merge", () => {
    const r = evaluateNoRegression(GATES, [check({ workflowBinding: null })], [GUARD], COUNTS, 2, AGG)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("nothing blocks a merge on it")
  })

  it("FAILS when a locally-provable check is absent from ci:local", () => {
    const r = evaluateNoRegression(GATES, [check({ inLocalChain: false })], [GUARD], COUNTS, 2, AGG)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("cannot reproduce this gate before pushing")
  })

  it("a remote-only check is NOT required to be in ci:local, but IS required to be bound", () => {
    const ok = evaluateNoRegression(GATES, [check({ id: "pack:smoke:mcp", inLocalChain: false, remoteOnly: true })], [GUARD], COUNTS, 2, AGG)
    expect(ok.status).toBe("PASSED")
    expect(ok.measures.find((m) => m.id === "wired/pack:smoke:mcp")!.observed).toContain("REMOTE-ONLY")

    const unbound = evaluateNoRegression(GATES, [check({ id: "pack:smoke:mcp", inLocalChain: false, remoteOnly: true, workflowBinding: null })], [GUARD], COUNTS, 2, AGG)
    expect(unbound.status).toBe("FAILED")
  })

  it("the ci:local chain itself is graded on existing, not on being inside itself", () => {
    const chain = check({ id: "ci:local", role: "local-chain", workflowBinding: null })
    expect(evaluateNoRegression(GATES, [chain], [GUARD], COUNTS, 2, AGG).status).toBe("PASSED")
    expect(evaluateNoRegression(GATES, [{ ...chain, script: null }], [GUARD], COUNTS, 2, AGG).status).toBe("FAILED")
  })

  it("FAILS when a served subtree has no reproducibility guard test", () => {
    const r = evaluateNoRegression(GATES, [check()], [{ ...GUARD, guardTest: null }], COUNTS, 2, AGG)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("no reproducibility guard test")
  })

  it("FAILS when a served subtree is not eol=lf pinned — the windows-only CRLF trap", () => {
    const r = evaluateNoRegression(GATES, [check()], [{ ...GUARD, eolPinned: false }], COUNTS, 2, AGG)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("windows-latest only")
  })

  it("FAILS when the observation step hands over nothing to grade", () => {
    expect(evaluateNoRegression([], [], [], [], 0, AGG).status).toBe("FAILED")
  })

  // --- the aggregator's reach (S0-OPEN-5, ADR 0071) ------------------------------
  //
  // Every `wired/*` measure above asks whether a script is reachable from SOME job.
  // None asks whether that job is reachable from the check the branch ruleset
  // requires. These cover that gap, and they are separate tests because the three
  // ways it breaks are three different sentences.

  it("FAILS, NAMING THE PARSE ERROR, when the workflow does not parse at all", () => {
    // The exact failure that fired on `d825330`: an unquoted `: ` in a step name made
    // `ci.yml` unparseable, GitHub started ZERO jobs, and `build-and-test` STOPPED
    // EXISTING rather than going red. The old text-match binding reported all 18
    // checks wired on those bytes. What makes this control valid is not that the gate
    // is red — an unbound check reds it too — but that the parse failure is NAMED.
    const broken: AggregatorReach = {
      ...AGG,
      present: false,
      needs: [],
      parseError: "Nested mappings are not allowed in compact mappings at line 150, column 15",
    }
    const r = evaluateNoRegression(GATES, [check()], [GUARD], COUNTS, 2, broken)
    expect(r.status).toBe("FAILED")
    const m = r.measures.find((x) => x.id === "wired/aggregator-reachable")!
    expect(m.pass).toBe(false)
    // The message must carry the parser's own words through to the blocker, or the
    // operator reads "not present" and goes looking for a deleted job.
    expect(r.blockers.join(" ")).toContain("Nested mappings are not allowed")
    expect(m.observed).toContain("contributes no job at all")
    // And it must NOT be reported as a missing job: the job is declared, the FILE is
    // broken. Naming the wrong cause is the defect S0-OPEN-5 was filed for.
    expect(m.observed).not.toContain("declares no")
  })

  it("FAILS when the required aggregator job is gone", () => {
    const r = evaluateNoRegression(GATES, [check()], [GUARD], COUNTS, 2, { ...AGG, present: false, needs: [] })
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("can never report")
  })

  it("FAILS when the aggregator no longer NEEDS the job the checks bind to", () => {
    // The measure this gate lacked entirely. `build-and-test` carries `if: always()`
    // on purpose — it runs even when `test` is red, then fails itself by reading
    // `needs.test.result`. So "does it run?" is the wrong question; "does it wait on
    // the job that runs our checks?" is the one that decides whether a red check
    // blocks a merge. Drop the `needs` and every `wired/*` row still passes while
    // nothing is gated.
    const r = evaluateNoRegression(GATES, [check()], [GUARD], COUNTS, 2, { ...AGG, needs: [] })
    expect(r.status).toBe("FAILED")
    const m = r.measures.find((x) => x.id === "wired/aggregator-reachable")!
    expect(m.pass).toBe(false)
    expect(m.observed).toContain("does NOT cover bound job(s) test")
    expect(m.observed).toContain("would not fail the required check")
  })

  it("does not demand the aggregator need ITSELF", () => {
    // A check bound directly to `build-and-test` is reachable by definition. Without
    // this carve-out the measure would fail on a correct wiring, which is
    // [[a-gate-that-cannot-pass-on-success]].
    const r = evaluateNoRegression(
      GATES,
      [check({ workflowBinding: "ci.yml#build-and-test" })],
      [GUARD],
      COUNTS,
      2,
      { ...AGG, needs: [] },
    )
    expect(r.status).toBe("PASSED")
  })

  it("names the CAUSE of an unbound check, not just the consequence", () => {
    // 18 rows once read "bound to no workflow job — only `ci:local` runs it". Every
    // word true; the cause — the file did not parse — appeared nowhere. `bindingFault`
    // is required rather than optional precisely so no producer can stay silent here.
    const r = evaluateNoRegression(
      GATES,
      [check({ workflowBinding: null, bindingFault: "ci.yml does not parse, so no runner will start a job from it — Nested mappings are not allowed in compact mappings at line 150, column 15" })],
      [GUARD],
      COUNTS,
      2,
      AGG,
    )
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("does not parse")
    expect(r.blockers.join(" ")).toContain("line 150")
  })

  it("still reports the generic consequence when no cause was observed", () => {
    // A null fault is legitimate — `ci:local` is unbound by design. The generic
    // sentence must survive for producers that genuinely have nothing to add.
    const r = evaluateNoRegression(GATES, [check({ workflowBinding: null, bindingFault: null })], [GUARD], COUNTS, 2, AGG)
    expect(r.status).toBe("FAILED")
    expect(r.blockers.join(" ")).toContain("nothing blocks a merge on it")
  })

  it("counts 5 roll-up measures, so a sixth cannot be added without moving the denominator", () => {
    // Pins the arity the denominator encodes. This is HALF the guard: it reds when a
    // measure is added or dropped, but it says nothing about whether the denominator
    // itself was synced — see the next test for that half.
    const r = evaluateNoRegression(GATES, [check()], [GUARD], COUNTS, 2, AGG)
    expect(r.status).toBe("PASSED")
    expect(r.measures).toHaveLength(5 + 1 + 1)
    expect(r.measures.map((m) => m.id)).toContain("wired/aggregator-reachable")
  })

  it("refuses a SHORT measure list, which is the only thing the denominator does", () => {
    // Measured, not assumed: the denominator feeds exactly one comparison,
    // `measures.length < requireAtLeast`. So reverting `5 +` to `4 +` on today's full
    // list changes NOTHING — 31 < 30 is false either way. Negative control #189 was
    // written expecting that revert to red, and it stayed green; this is the shape that
    // actually discriminates ([[miscounted-denominator-is-a-false-green]]).
    //
    // `decideGate` is called directly because the point is the floor, not the
    // observation: `evaluateNoRegression` cannot be made to emit a short list without
    // editing the very code under test.
    const full = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, pass: true, observed: "ok" }))
    expect(decideGate(full, 5 + 1 + 1).status).toBe("PASSED")
    // Drop one. At the synced floor this is refused; at `4 +` it would pass silently,
    // and the gate would grade an observation step that produced too little.
    const short = full.slice(0, 6)
    const refused = decideGate(short, 5 + 1 + 1)
    expect(refused.status).toBe("FAILED")
    expect(refused.blockers.join(" ")).toContain("expected at least 7 measures, got 6")
    expect(decideGate(short, 4 + 1 + 1).status, "the off-by-one the control could not catch from outside").toBe("PASSED")
  })
})
