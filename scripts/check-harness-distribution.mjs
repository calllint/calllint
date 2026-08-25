#!/usr/bin/env node
/**
 * Harness distribution truth gate.
 *
 * Validates that harness public pages advertise only commands that exist in the shipped
 * product, and that support-class claims match registered extractors. This is the gate
 * that keeps `--agent <id>` on a public page from naming a type the CLI does not have.
 *
 * SUBJECT: `apps/web/data/distribution-surfaces.json` — the single distribution SSOT.
 *
 * It used to read `apps/web/data/harness-surfaces.json`, a second, hand-maintained file
 * with an older ontology (P0/P1 cohorts, `deepSeekIntegrationObserved`, 8 hosts). Two
 * independent files describing one cohort is a forbidden state: nothing compared them, so
 * they drifted silently and this gate audited 8 of 15 hosts while reading green. The
 * seven it never saw included every DISCOVERY_ONLY and DEFERRED host — precisely the
 * classes whose claims most need checking, since those are the ones that must NOT
 * advertise an `--agent` command.
 *
 * Field names differ between the two ontologies and that difference is load-bearing:
 * the legacy file used `calllintSupportClass` (singular) and `truthfulCommand` (a string);
 * the SSOT uses `supportClass` and `truthfulCommands` (an array). Reading the SSOT with
 * the legacy names yields `undefined` for every host, which makes every branch below
 * unreachable and the gate vacuous — it would print "PASSED" having asserted nothing.
 * `assertCohortShape()` exists to make that failure loud instead of silent.
 *
 * Exit codes:
 *   0  all checks pass
 *   1  one or more checks failed
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const DATA_FILE = path.join(repoRoot, "apps/web/data/distribution-surfaces.json")
const TYPES_FILE = path.join(repoRoot, "packages/discovery/src/types.ts")
const BOOTSTRAP_FILE = path.join(repoRoot, "packages/discovery/src/bootstrap.ts")

let failed = false

function fail(msg) {
  console.error(`❌ ${msg}`)
  failed = true
}

function pass(msg) {
  console.log(`✅ ${msg}`)
}

// Read harness data
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
const typesContent = fs.readFileSync(TYPES_FILE, "utf8")
const bootstrapContent = fs.readFileSync(BOOTSTRAP_FILE, "utf8")

// Extract registered agent types from types.ts
const agentTypeMatch = typesContent.match(/export type AgentType =\s*\n([^]*?)\n\s*$/m)
if (!agentTypeMatch) {
  fail("Could not parse AgentType from types.ts")
  process.exit(1)
}

const agentTypeLines = agentTypeMatch[1].split("\n")
const registeredTypes = new Set()
for (const line of agentTypeLines) {
  const match = line.match(/"([^"]+)"/)
  if (match) {
    registeredTypes.add(match[1])
  }
}

/*
 * Extract bootstrapped extractors from bootstrap.ts.
 *
 * WHY THE CLASS NAME IS NOT READ AS THE AGENT TYPE. Class name and agent type do not
 * share one rule: `WorkBuddyExtractor` is `workbuddy` (no hyphen) while
 * `ClaudeCodeExtractor` is `claude-code` (hyphenated), so no mechanical de-camel-casing
 * derives both. This used to be bridged by a hand-written `classToAgentType` table, which
 * failed in the two ways a hand-copied list always fails:
 *
 *   - It omitted `Kiro`, `GeminiCli` and `Codex`. All three ARE registered in bootstrap,
 *     but absent from the table they never entered `bootstrappedExtractors`, so HD-01's
 *     "extractor registered" arm silently could not see them.
 *   - It spelled one key `OpenCode` while the class is `OpencodeExtractor` (lowercase c).
 *     That entry could never match anything. It went unnoticed only because opencode was
 *     not NATIVE at the time, so the arm it disabled was never reached.
 *
 * Both are the same fault as the defect this gate exists to catch: a hand-maintained list
 * standing in for a fact. So the type is now read from where the product itself declares
 * it — the `agentType` field on each extractor class — and the class-name → file mapping
 * comes from bootstrap's own import statements. Nothing is transcribed.
 */
const bootstrappedExtractors = new Set()

/*
 * Scan CODE ONLY — comments are not registrations.
 *
 * Found by negative control: commenting out `registry.register(new KiroExtractor())` left
 * this gate green, because a bare `matchAll` over the raw file text matches the call
 * inside `// registry.register(...)` just as happily. A disabled extractor would have kept
 * satisfying HD-01 for a host still marked NATIVE — the gate would have been blind to
 * exactly the removal it exists to catch.
 *
 * Block comments go first (docblocks here contain `https://` URLs, which would otherwise
 * be truncated mid-comment and leave a stray close-comment fragment), then line comments.
 * No import path or string literal in this file contains a double slash, so cutting at it
 * is safe for both scans below.
 */
const bootstrapCode = bootstrapContent
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => {
    const i = line.indexOf("//")
    return i === -1 ? line : line.slice(0, i)
  })
  .join("\n")

const importedFrom = new Map()
for (const m of bootstrapCode.matchAll(
  /import\s*\{\s*(\w+Extractor)\s*\}\s*from\s*"\.\/extractors\/([\w.-]+)\.js"/g,
)) {
  importedFrom.set(m[1], m[2])
}

const registeredClasses = [
  ...bootstrapCode.matchAll(/registry\.register\(new (\w+Extractor)\(\)\)/g),
].map((m) => m[1])

if (registeredClasses.length === 0) {
  fail(
    "Could not parse any registry.register(new XExtractor()) call out of bootstrap.ts. " +
      "HD-01's extractor arm compares against this set, so an empty parse would make it vacuous.",
  )
  process.exit(1)
}

for (const className of registeredClasses) {
  const file = importedFrom.get(className)
  if (!file) {
    fail(
      `${className} is registered in bootstrap.ts but has no matching import there, so its ` +
        `agentType cannot be read. HD-01 would silently stop checking this extractor.`,
    )
    continue
  }
  const srcPath = path.join(repoRoot, "packages/discovery/src/extractors", `${file}.ts`)
  if (!fs.existsSync(srcPath)) {
    fail(`${className} imports ./extractors/${file}.js but ${file}.ts does not exist`)
    continue
  }
  const src = fs.readFileSync(srcPath, "utf8")
  const declared = src.match(/readonly\s+agentType\s*:\s*AgentType\s*=\s*"([^"]+)"/)
  if (!declared) {
    fail(
      `${file}.ts declares no \`readonly agentType: AgentType = "..."\`, so the gate cannot ` +
        `tell which agent it serves. HD-01 needs this to be readable, not inferred.`,
    )
    continue
  }
  bootstrappedExtractors.add(declared[1])
}

/*
 * Anti-vacuity floor. Every extractor above must have yielded a type; if parsing silently
 * degraded, the set shrinks and HD-01 stops failing rather than starts.
 */
if (bootstrappedExtractors.size !== registeredClasses.length) {
  fail(
    `Parsed ${bootstrappedExtractors.size} agent types from ${registeredClasses.length} ` +
      `registered extractors. Every registration must resolve to exactly one declared type.`,
  )
}

console.log("\n=== Harness Distribution Truth Gate ===\n")

const SUPPORT_CLASSES = new Set(["NATIVE", "CONFIG_SCAN", "DISCOVERY_ONLY", "DEFERRED"])

/*
 * Anti-vacuity. Every assertion below is guarded by `supportClass === "..."`, so if the
 * field is missing or misspelled, no branch runs and the gate exits 0 having checked
 * nothing. A renamed field in the SSOT must red this gate, not silence it.
 */
function assertCohortShape(hosts) {
  if (!Array.isArray(hosts) || hosts.length === 0) {
    fail(`${path.basename(DATA_FILE)}: hosts[] is missing or empty — nothing to audit`)
    process.exit(1)
  }
  const noClass = hosts.filter((h) => !SUPPORT_CLASSES.has(h.supportClass))
  if (noClass.length > 0) {
    fail(
      `${noClass.length}/${hosts.length} hosts have no recognized supportClass ` +
        `(got: ${[...new Set(noClass.map((h) => JSON.stringify(h.supportClass)))].join(", ")}). ` +
        `Every assertion in this gate is keyed on supportClass, so this would make it vacuous.`,
    )
    process.exit(1)
  }
  console.log(
    `Auditing ${hosts.length} hosts from ${path.relative(repoRoot, DATA_FILE)}: ` +
      Object.entries(
        hosts.reduce((a, h) => ((a[h.supportClass] = (a[h.supportClass] || 0) + 1), a), {}),
      )
        .map(([k, v]) => `${v} ${k}`)
        .join(", "),
  )
}

const hosts = data.hosts
assertCohortShape(hosts)

// Check each host
{
  for (const host of hosts) {
    const { id, displayName, supportClass: calllintSupportClass } = host
    // The SSOT holds an array; every assertion below is about whether ANY advertised
    // command makes a claim, so flatten and test the joined text plus each element.
    const commands = Array.isArray(host.truthfulCommands)
      ? host.truthfulCommands
      : host.truthfulCommands
        ? [host.truthfulCommands]
        : []
    const truthfulCommand = commands.join(" ; ")

    console.log(`\nChecking: ${displayName} (${id}) [${calllintSupportClass}]`)

    // HD-01: NATIVE support must have registered extractor
    if (calllintSupportClass === "NATIVE") {
      if (!registeredTypes.has(id)) {
        fail(`${id}: marked NATIVE but AgentType "${id}" not in types.ts`)
      } else {
        pass(`${id}: AgentType registered`)
      }

      if (!bootstrappedExtractors.has(id)) {
        fail(`${id}: marked NATIVE but extractor not registered in bootstrap.ts`)
      } else {
        pass(`${id}: Extractor bootstrapped`)
      }

      if (!truthfulCommand || !truthfulCommand.includes(`--agent ${id}`)) {
        fail(`${id}: marked NATIVE but truthfulCommand does not match pattern "--agent ${id}"`)
      } else {
        pass(`${id}: Truthful command matches NATIVE support`)
      }
    }

    // HD-02: DISCOVERY_ONLY must not have fake CLI command
    if (calllintSupportClass === "DISCOVERY_ONLY") {
      if (truthfulCommand && truthfulCommand.includes("--agent")) {
        fail(`${id}: marked DISCOVERY_ONLY but advertises --agent command`)
      } else {
        pass(`${id}: DISCOVERY_ONLY correctly shows no auto-discovery command`)
      }
    }

    // HD-03: DEFERRED means no support is claimed yet, so it must advertise no command
    // at all. Previously unreachable: all three DEFERRED hosts live outside the legacy
    // file this gate used to read.
    if (calllintSupportClass === "DEFERRED") {
      if (commands.length > 0) {
        fail(`${id}: marked DEFERRED but advertises ${commands.length} command(s): ${truthfulCommand}`)
      } else {
        pass(`${id}: DEFERRED correctly advertises no command`)
      }
    }

    // HD-04: CONFIG_SCAN scans a path the user names; it must NOT imply auto-detection.
    if (calllintSupportClass === "CONFIG_SCAN") {
      if (truthfulCommand.includes("--agent")) {
        fail(`${id}: marked CONFIG_SCAN but advertises --agent (implies auto-detection)`)
      } else if (commands.length === 0) {
        fail(`${id}: marked CONFIG_SCAN but advertises no command at all`)
      } else {
        pass(`${id}: CONFIG_SCAN advertises an explicit-path command`)
      }
    }

    // Host command must be truthful — every advertised command, not just the first.
    for (const cmd of commands) {
      for (const m of String(cmd).matchAll(/--agent\s+([^\s"';]+)/g)) {
        const agentArg = m[1]
        if (!registeredTypes.has(agentArg)) {
          fail(`${id}: advertises "--agent ${agentArg}" but that type does not exist`)
        }
      }
    }
  }
}

/*
 * HD-05: a recorded blocker and the state label must agree, in BOTH directions.
 *
 * This exists because they once did not. Four channels carried a `blocker` saying
 * submission is impossible or explicitly rejected, while their state said
 * READY_NOT_SUBMITTED / AUDIT_REQUIRED — which the public projections print as
 * "Not yet submitted" / "Listing not yet verified", i.e. as PENDING. The blocker text
 * reached the HTML, so nothing was concealed from a human reading the whole row; but
 * `state` is the field machines consume, and in agent-discovery-index.json the blocker
 * is not carried at all, so an agent saw "unverified" with no way to learn "impossible".
 *
 * Both directions are load-bearing:
 *   blocker ⇒ BLOCKED   stops a known-impossible channel from reading as pending work.
 *   BLOCKED ⇒ blocker   stops BLOCKED from becoming a verdict with no recorded reason,
 *                       which is the same evidence-free claim in the other direction.
 *
 * The denominator is pinned before the claim: this gate must not be able to report
 * agreement because it found no channels to compare.
 */
{
  console.log("\nChecking: distribution channel blocker/state agreement [HD-05]")

  const channels = hosts.flatMap((h) =>
    (Array.isArray(h.distributionPrimitives) ? h.distributionPrimitives : []).map((p) => ({
      host: h.id,
      ...p,
    })),
  )

  if (channels.length === 0) {
    fail(
      `${path.basename(DATA_FILE)}: no distributionPrimitives found across ${hosts.length} hosts — ` +
        `HD-05 compares blocker against state, so this would make it vacuous`,
    )
  } else {
    const contradictions = channels.filter((c) => c.blocker && c.state !== "BLOCKED")
    const unexplained = channels.filter((c) => c.state === "BLOCKED" && !c.blocker)

    for (const c of contradictions) {
      fail(
        `${c.host}/${c.kind}: declares a blocker but state is ${c.state}, not BLOCKED — ` +
          `the public label would read as pending while the blocker says otherwise`,
      )
    }
    for (const c of unexplained) {
      fail(`${c.host}/${c.kind}: state is BLOCKED but records no blocker explaining why`)
    }

    if (contradictions.length === 0 && unexplained.length === 0) {
      const blocked = channels.filter((c) => c.state === "BLOCKED").length
      pass(
        `${channels.length} channels checked; ${blocked} BLOCKED, each with a recorded blocker, ` +
          `and no blocker recorded outside BLOCKED`,
      )
    }
  }
}

/*
 * HD-07: AVAILABLE is the one state that makes a public claim, so it must carry evidence.
 *
 * WHY THIS EXISTS AS A GATE AND NOT ONLY AS A SCHEMA RULE. The schema now conditions
 * evidence on `state` (`definitions.primitive.allOf`), and ajv does enforce it — the SSOT is
 * validated in check-agent-surface-contract.mjs. But ajv reports a failed `anyOf` as
 * "must match a schema in anyOf" against a JSON Pointer like
 * `/hosts/2/distributionPrimitives/1`. That names neither the host, nor the channel, nor
 * what evidence was missing. Whoever trips it is told a shape is wrong, not which claim is
 * unbacked. This gate says the sentence out loud.
 *
 * It also covers a gap the schema structurally cannot. A schema can require that `liveUrl`
 * is PRESENT and well-formed; it cannot require that the URL is the channel's own listing,
 * and nothing here fetches it (new18 §86/§87 keep this repo's watchers from writing outward
 * and this gate offline entirely; §22 was a miscitation, corrected 2026-08-25). So the
 * `liveUrl` arm is checked for shape and for pointing at the
 * channel's own official host, which is the strongest offline statement available.
 *
 * MEASURED HOLE THIS CLOSES (2026-08-23). Flipping cursor/cursor-plugin from AUDIT_REQUIRED
 * to AVAILABLE with no evidence added passed all four of check:distribution-drift,
 * check:agent-surface, check:harness-distribution and check:published-schema. A
 * never-submitted shelf could advertise itself as shipping today. That is new20 NC1
 * ("missing marketplace submission must NOT claim available") and §15 ("AVAILABLE requires
 * evidence"), and Truth Gate v2's "marketplace LIVE → actual live evidence".
 *
 * TWO ARMS, NOT ONE, and the asymmetry is forced by the data rather than chosen:
 *   upstream: officialMcpRegistry   all 17 mcp-stdio channels; liveness is read back against
 *                                   the live API by verify-registry-presence.mjs, which fails
 *                                   closed when the API is unreachable.
 *   liveUrl                         the only arm a shelf can satisfy — 0 of the 14 shelf
 *                                   channels carry `upstream`, so demanding it of them would
 *                                   be unsatisfiable rather than strict.
 * Requiring `liveUrl` universally would have redded the three true AVAILABLE records, since
 * no channel in the SSOT carries a non-null liveUrl today. A one-armed rule here is either
 * vacuous or wrong.
 *
 * ANTI-VACUITY. The denominator is pinned before the claim, and the arms are read out of the
 * schema rather than restated: if `definitions.primitive` stops conditioning evidence on
 * state, this gate fails instead of quietly agreeing with a schema that no longer constrains
 * anything. Same reason the leak guards derive their state vocabulary from the enum.
 */
{
  console.log("\nChecking: AVAILABLE channels carry evidence [HD-07]")

  const schemaPath = path.join(repoRoot, "apps/web/data/distribution-surfaces.schema.json")
  const primitiveSchema = fs.existsSync(schemaPath)
    ? JSON.parse(fs.readFileSync(schemaPath, "utf8"))?.definitions?.primitive
    : undefined
  const conditions = Array.isArray(primitiveSchema?.allOf) ? primitiveSchema.allOf : []
  const guardsAvailable = conditions.some(
    (c) => c?.if?.properties?.state?.const === "AVAILABLE" && Array.isArray(c?.then?.anyOf),
  )

  if (!guardsAvailable) {
    fail(
      "the SSOT schema no longer conditions evidence on state === AVAILABLE " +
        "(definitions.primitive.allOf). HD-07 restates that rule with a readable message; " +
        "with the schema arm gone, ajv would accept an unbacked AVAILABLE and only this " +
        "gate would object — so the disagreement is the defect, not a detail.",
    )
  }

  const channels = hosts.flatMap((h) =>
    (Array.isArray(h.distributionPrimitives) ? h.distributionPrimitives : []).map((p) => ({
      host: h.id,
      officialSources: Array.isArray(h.officialSources) ? h.officialSources : [],
      ...p,
    })),
  )
  const available = channels.filter((c) => c.state === "AVAILABLE")

  if (channels.length === 0) {
    fail(
      `${path.basename(DATA_FILE)}: no distributionPrimitives across ${hosts.length} hosts — ` +
        `HD-07 has no denominator and would report agreement having compared nothing`,
    )
  } else {
    const hostOf = (u) => {
      try {
        return new URL(u).host.replace(/^www\./, "")
      } catch {
        return undefined
      }
    }

    let unbacked = 0
    for (const c of available) {
      const hasUpstream = typeof c.upstream === "string" && c.upstream.length > 0
      const hasLive = typeof c.liveUrl === "string" && c.liveUrl.startsWith("https://")
      if (!hasUpstream && !hasLive) {
        unbacked++
        fail(
          `${c.host}/${c.kind}: state is AVAILABLE but records no evidence. AVAILABLE means ` +
            `CallLint ships through this channel today, which is a public claim. Carry ` +
            `upstream: "officialMcpRegistry" (verified live by check:registry-presence), or a ` +
            `liveUrl naming this channel's own listing. If the channel is real but unverified, ` +
            `AUDIT_REQUIRED is the honest state; if submission is impossible, BLOCKED with a blocker.`,
        )
        continue
      }
      // The liveUrl arm, tightened as far as an offline gate can: a listing URL that points
      // at neither the channel's officialSource nor the host's own vendor surfaces is not
      // evidence about THIS channel. Advisory-free — it fails, because a wrong URL under
      // AVAILABLE reads as verified to every consumer of the projections.
      if (hasLive) {
        const target = hostOf(c.liveUrl)
        const anchors = [c.officialSource, ...c.officialSources].filter(Boolean).map(hostOf)
        if (target && anchors.length > 0 && !anchors.some((a) => a && (a === target || target.endsWith(`.${a}`) || a.endsWith(`.${target}`)))) {
          unbacked++
          fail(
            `${c.host}/${c.kind}: liveUrl host "${target}" matches none of this channel's ` +
              `official surfaces (${[...new Set(anchors)].join(", ")}). A listing URL on an ` +
              `unrelated domain is not evidence that THIS channel carries CallLint.`,
          )
        }
      }
    }

    // The converse. Vacuous today by construction (no channel carries a non-null liveUrl),
    // which is why it is stated: it constrains the first one written, not the current set.
    const pendingWithLive = channels.filter(
      (c) => typeof c.liveUrl === "string" && c.liveUrl.length > 0 && c.state !== "AVAILABLE",
    )
    for (const c of pendingWithLive) {
      fail(
        `${c.host}/${c.kind}: records liveUrl ${c.liveUrl} but state is ${c.state}, not ` +
          `AVAILABLE — the public projection would print this channel as not yet shipping ` +
          `while its own record names where it is listed`,
      )
    }

    if (unbacked === 0 && pendingWithLive.length === 0) {
      const byArm = {
        upstream: available.filter((c) => typeof c.upstream === "string").length,
        liveUrl: available.filter((c) => typeof c.liveUrl === "string" && c.liveUrl).length,
      }
      pass(
        `${available.length}/${channels.length} channels are AVAILABLE, each with evidence ` +
          `(${byArm.upstream} via upstream registry record, ${byArm.liveUrl} via liveUrl); ` +
          `no liveUrl recorded outside AVAILABLE`,
      )
    }
  }
}

/*
 * HD-06: every flag in an advertised command must be a flag the CLI actually reads.
 *
 * WHY THIS GATE'S SUBJECT IS THE SSOT AND NOT `help.ts`. `calllint scan --config <path>`
 * was published on eight surfaces and printed by `calllint inventory` for months. No
 * command ever read `--config`, and `parseArgs` consumes `--k v` as a flag/value pair, so
 * the path never became a positional: with no default config present the run exited 2
 * claiming no config was given, and WITH one present it scanned `.cursor/mcp.json` instead
 * and exited 0. A verdict describing a file the user never named is the "evidence must
 * belong to the thing it claims" rule broken by CallLint itself.
 *
 * The flag was never in `help.ts` — measured 2026-08-23, the documented set and the read
 * set agree exactly in that direction (35 documented, 0 of them unread). So a gate that
 * checked help against the code would have been green throughout. The lie lived only in
 * the SSOT, which is why the SSOT is what gets audited here.
 *
 * THE ASSERTION IS ONE-DIRECTIONAL, deliberately. Advertised ⇒ read. The converse
 * (read ⇒ advertised, or read ⇒ documented) is NOT a defect and must not be a gate: 15
 * flags are read but undocumented on purpose (`--verbose`, `--no-color`, `--format`,
 * `--surface-dir`, signing internals), and forcing them into public copy would widen the
 * user-facing surface this repo's rules forbid widening as a side effect.
 *
 * ANTI-VACUITY. The denominator is the set of flags read anywhere under `apps/cli/src`.
 * If that set comes back empty or implausibly small the gate fails instead of passing: a
 * moved directory, a renamed helper, or a regex that stops matching would otherwise make
 * every advertised flag look unread — no, worse, it would make the SET empty and every
 * comparison below trivially satisfiable in the "found nothing to object to" direction.
 * This is the failure mode that let the pre-SSOT version of this whole file audit 8 of 15
 * hosts while printing PASSED.
 *
 * Four read patterns exist and all four are matched. Missing one under-reports, which
 * would fail a truthful command and push somebody toward deleting a real claim:
 *   flagStr(args.flags, "x") / flagBool(flags, "x")   the common case
 *   flags["x"]                                        subscript
 *   flags.x                                           property access (inventory.ts:28)
 *   helpers taking `flags` as a parameter             indirection (clock.ts reads
 *                                                     "generated-at" from a passed-in bag)
 * The last is covered because the scan is over file TEXT, not over call sites reachable
 * from a command — `clock.ts` matches on its own `flagStr(flags, "generated-at")`.
 */
{
  console.log("\nChecking: advertised flags exist in the shipped CLI [HD-06]")

  const CLI_SRC = path.join(repoRoot, "apps", "cli", "src")

  /** Every flag name read anywhere in the CLI source, by any of the four patterns. */
  const readFlags = (() => {
    const found = new Set()
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (entry.name.endsWith(".ts")) {
          const src = fs.readFileSync(p, "utf8")
          for (const m of src.matchAll(/flag(?:Str|Bool)\(\s*[A-Za-z_.]*flags?\s*,\s*"([^"]+)"/g))
            found.add(m[1])
          for (const m of src.matchAll(/flags\s*\[\s*"([^"]+)"\s*\]/g)) found.add(m[1])
          for (const m of src.matchAll(/\bflags\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) found.add(m[1])
        }
      }
    }
    if (!fs.existsSync(CLI_SRC)) {
      fail(`HD-06 cannot find the CLI source at ${path.relative(repoRoot, CLI_SRC)} — the gate has no denominator`)
      return found
    }
    walk(CLI_SRC)

    /*
     * SUBTRACT THE REJECTION LIST. `resolveConfigInput` names the flags it exists to
     * REFUSE — `TARGET_LOOKALIKE_FLAGS` = config/file/path/target, the spellings that look
     * like they name the scan target but are not options this CLI has. It reads them via
     * `args.flags[alias]`, which is indistinguishable, to a text scan, from reading a real
     * flag. Left in, they enter the denominator as "flags the CLI reads" and HD-06 goes
     * blind to exactly the defect it was written for: verified 2026-08-23 by reinjecting
     * `calllint scan --config <path>` into the opencode record, which passed.
     *
     * Parsed out of the source rather than restated here. A second hand-copy of the list
     * would drift the moment somebody adds a fifth lookalike, and it would drift in the
     * silent direction — under-reporting, never failing loudly. Same reasoning the two leak
     * guards derive the state vocabulary from the schema instead of hardcoding it.
     */
    const resolveSrc = path.join(CLI_SRC, "commands", "resolveInput.ts")
    if (!fs.existsSync(resolveSrc)) {
      fail(
        `HD-06 cannot find ${path.relative(repoRoot, resolveSrc)}, which declares the ` +
          `target-lookalike rejection list. Without subtracting it, refused flags count as ` +
          `supported and this gate loses its teeth.`,
      )
      return found
    }
    const listMatch = fs
      .readFileSync(resolveSrc, "utf8")
      .match(/TARGET_LOOKALIKE_FLAGS\s*=\s*\[([^\]]*)\]/)
    if (!listMatch) {
      fail(
        `HD-06 could not parse TARGET_LOOKALIKE_FLAGS out of ` +
          `${path.relative(repoRoot, resolveSrc)}. It was renamed or restructured; the ` +
          `subtraction below is what keeps a REFUSED flag from reading as a supported one.`,
      )
      return found
    }
    const refused = [...listMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
    if (refused.length === 0) {
      fail(`HD-06 parsed an EMPTY TARGET_LOOKALIKE_FLAGS — subtracting nothing is the vacuous case`)
      return found
    }
    for (const r of refused) found.delete(r)

    return found
  })()

  /*
   * A floor, not an exact count. 40 is well under the 50 measured on 2026-08-23, so
   * ordinary flag churn never trips it, while a regex or layout change that collapses the
   * scan does. An exact count would make this a maintenance tax that gets "fixed" by
   * bumping the number, which teaches nothing.
   */
  const DENOMINATOR_FLOOR = 40
  if (readFlags.size < DENOMINATOR_FLOOR) {
    fail(
      `HD-06 read only ${readFlags.size} flags from the CLI source (expected >= ${DENOMINATOR_FLOOR}). ` +
        `The scan, not the product, is most likely broken — every advertised flag would read as unread.`,
    )
  } else {
    const advertised = []
    for (const h of hosts) {
      for (const cmd of Array.isArray(h.truthfulCommands) ? h.truthfulCommands : []) {
        for (const m of String(cmd).matchAll(/--([a-z][a-z0-9-]*)/g)) {
          advertised.push({ host: h.id, flag: m[1], cmd: String(cmd) })
        }
      }
    }

    const unread = advertised.filter((a) => !readFlags.has(a.flag))
    for (const a of unread) {
      fail(
        `${a.host}: advertises "${a.cmd}" but --${a.flag} is not read anywhere in the CLI. ` +
          `An advertised flag the product ignores does not fail — it silently does something else.`,
      )
    }

    if (unread.length === 0) {
      const distinct = new Set(advertised.map((a) => a.flag))
      pass(
        `${advertised.length} advertised flag use(s) across ${hosts.length} hosts ` +
          `(${distinct.size} distinct: ${[...distinct].sort().map((f) => `--${f}`).join(", ")}), ` +
          `each read by the CLI; denominator ${readFlags.size} flags`,
      )
    }
  }
}

/*
 * HD-08: a recorded submission date must be a real day in the past, and must not sit under a
 * state that says nobody has submitted.
 *
 * WHY THIS IS NOT ONLY A SCHEMA RULE. `submission.date` carries a `pattern` of
 * ^\d{4}-\d{2}-\d{2}$, which is the most a JSON Schema regex can say. Two wrong values pass
 * it. `2026-02-31` is well-formed and is not a day — `new Date()` rolls it silently to March 3
 * rather than throwing, so nothing downstream would object either. And a date in the FUTURE
 * passes every structural check while asserting an act that has not happened: the whole point
 * of this field is to distinguish "a human submitted this" from "nobody has touched it", and a
 * future date makes the claim in the wrong tense. Neither is expressible in the schema
 * (`format: date` is advisory, and ajv is compiled here with `strict: false` and no formats
 * package, so it is not even checked), which is exactly the schema/gate split HD-05 and HD-07
 * already follow.
 *
 * THE THIRD ARM IS THE ORTHOGONALITY, restated with a readable message. The schema forbids
 * `submission` under `READY_NOT_SUBMITTED`; ajv reports it as `must NOT be valid` against a
 * JSON Pointer, which names neither the host nor the contradiction. Same argument HD-07's
 * docblock makes about the AVAILABLE arms: the schema makes it unrepresentable, this gate says
 * the sentence out loud.
 *
 * ANTI-VACUITY, AND WHY THE FLOOR IS 1 RATHER THAN 0. Exactly one channel carries a
 * `submission` today. A gate over an empty cohort would print a checkmark having compared
 * nothing, which is this repo's dominant fault class; but a floor is also a claim that can go
 * stale in the other direction, so it is derived, not typed: the cohort must be non-empty
 * BECAUSE the schema requires `submission` wherever `submissionUrl` appears, and at least one
 * channel carries `submissionUrl`. If that stops being true the gate fails and says which
 * premise broke, rather than shrinking to nothing.
 */
{
  console.log("\nChecking: recorded submission dates [HD-08]")

  const channels = hosts.flatMap((h) =>
    (Array.isArray(h.distributionPrimitives) ? h.distributionPrimitives : []).map((p) => ({
      host: h.id,
      ...p,
    })),
  )
  const withSubmission = channels.filter((c) => c.submission)
  const withUrl = channels.filter((c) => typeof c.submissionUrl === "string" && c.submissionUrl)

  if (channels.length === 0) {
    fail(
      `${path.basename(DATA_FILE)}: no distributionPrimitives across ${hosts.length} hosts — ` +
        `HD-08 would report agreement having examined nothing`,
    )
  } else if (withUrl.length > 0 && withSubmission.length === 0) {
    fail(
      `${withUrl.length} channel(s) record a submissionUrl but none records a submission date ` +
        `(${withUrl.map((c) => `${c.host}/${c.kind}`).join(", ")}). The schema requires ` +
        `\`submission\` wherever \`submissionUrl\` appears, so either that arm was removed from ` +
        `definitions.primitive.allOf or the SSOT is not being validated — HD-08 has no cohort ` +
        `left to check either way.`,
    )
  } else {
    let bad = 0

    for (const c of withSubmission) {
      const raw = c.submission?.date
      if (typeof raw !== "string") {
        bad++
        fail(`${c.host}/${c.kind}: submission records no date — the act has no time`)
        continue
      }

      /* Real-day check by round-trip, not by `new Date(raw)` alone: that constructor accepts
       * 2026-02-31 and rolls it to 2026-03-03 without complaint, so the only way to learn the
       * input was not a day is to re-serialise and compare. */
      const parsed = new Date(`${raw}T00:00:00Z`)
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
        bad++
        fail(
          `${c.host}/${c.kind}: submission.date "${raw}" is not a real calendar day ` +
            `(it round-trips to "${Number.isNaN(parsed.getTime()) ? "Invalid Date" : parsed.toISOString().slice(0, 10)}"). ` +
            `The schema pattern accepts it; a day that does not exist cannot be when someone acted.`,
        )
        continue
      }

      const today = new Date().toISOString().slice(0, 10)
      if (raw > today) {
        bad++
        fail(
          `${c.host}/${c.kind}: submission.date "${raw}" is in the future (today is ${today}). ` +
            `This field records an act that HAS happened; a future date claims one that has not.`,
        )
      }

      if (c.state === "READY_NOT_SUBMITTED") {
        bad++
        fail(
          `${c.host}/${c.kind}: records a submission on ${raw} but state is READY_NOT_SUBMITTED, ` +
            `which asserts nobody has acted. \`state\` is the field machines consume, so the ` +
            `projections would queue this work again.`,
        )
      }
    }

    if (bad === 0) {
      pass(
        `${withSubmission.length}/${channels.length} channels record a submission date, each a ` +
          `real past day and none under READY_NOT_SUBMITTED; ${withUrl.length} channel(s) carry ` +
          `a submissionUrl and all of them record a date`,
      )
    }
  }
}

/*
 * HD-10: a channel with a recorded submission must not be presented as an action to take.
 *
 * WHAT THIS CAUGHT, AND WHY HD-08 DID NOT. `claude-code/claude-plugin` carries
 * `submission.date: 2026-07-20` and the install lines have been live in the README since
 * `5bed4b6`. HD-08 checked that date's shape and tense and passed — correctly, it is a real
 * past day under a legal state. `CHANNEL-COUNTS.md`, generated from the same SSOT, filed the
 * row under "submitted, listing not yet verified" and excluded it from the actionable set —
 * also correct. And `ROI.md` still ranked it **#1**, with `HUMAN-STEPS.md` heading it "the one
 * to do first".
 *
 * So every machine-checked surface agreed, and the two pages a human actually opens told them
 * to redo a completed external submission. ADR 0002's rule ("a recorded submission date ends
 * actionability regardless of `state`") was written down and enforced on the generated
 * projection only. The hand-maintained pages were outside every gate.
 *
 * WHY A GATE RATHER THAN A GENERATED PAGE. These two files are judgment — an ROI ordering and
 * per-channel prose no generator can write. They should stay hand-maintained. What must not
 * stay hand-maintained is the *actionability* claim inside them, because that is derivable and
 * it is the claim that costs a human a duplicate external write — the one act new18 §87 treats
 * as the real harm.
 *
 * HOW IT READS THE PAGES. Not by parsing the ROI table as data: a scraped rank would break on a
 * reordering, which is legitimate. It polices only **directive lines** — the `## ` heading that
 * introduces a channel's section, and the `|`-delimited table row that ranks it. Those are the
 * two places these pages order someone to act. Body prose is left free, because both pages must
 * be able to narrate the history ("this row said *ready to submit*, and it was already done")
 * without the gate reading the quoted mistake as a fresh instruction.
 *
 * WHY NOT "QUEUEING PHRASE AND NO RETIREMENT PHRASE ANYWHERE". That was the first
 * implementation and its negative control **did not red it**: restoring the stale heading
 * `(P0, the one to do first)` still passed, because the correction blockquote three lines below
 * contains "already been done" and satisfied the exemption. A page can narrate a retirement and
 * still issue the instruction — that is precisely the defect — so a document-scoped exemption
 * cannot see it. Scoping both claims to the directive line is what makes the control fail.
 *
 * Both directions matter: a directive line that still queues a submitted channel re-queues an
 * external write, and one that never says the act is made lets a reader infer it is still owed.
 *
 * ANTI-VACUITY. The cohort is the channels carrying `submission`, derived from the SSOT, and the
 * gate fails if it is empty, if either page is missing, or if no directive line was found for any
 * submitted channel across either page — a checkmark over zero lines compared is this repo's
 * dominant fault class.
 */
{
  console.log("\nChecking: submitted channels are not queued as actions [HD-10]")

  const PAGES = ["artifacts/submissions/ROI.md", "artifacts/submissions/HUMAN-STEPS.md"]

  /* Phrases that QUEUE work. About priority-to-act, not mere mention. */
  const QUEUEING = [
    /the one to do first/i,
    /the first unmade action/i,
    /start at step 1/i,
    /ready to submit/i,
    /do this first/i,
  ]

  /* Phrases that RETIRE it. One must appear on the directive line itself. */
  const RETIRING = [/already (?:done|made|submitted|published)/i, /not actionable/i, /do not redo/i]

  const submitted = hosts.flatMap((h) =>
    (Array.isArray(h.distributionPrimitives) ? h.distributionPrimitives : [])
      .filter((p) => p.submission)
      .map((p) => ({ host: h.id, kind: p.kind, date: p.submission?.date })),
  )

  const missingPages = PAGES.filter((p) => !fs.existsSync(path.join(repoRoot, p)))

  if (submitted.length === 0) {
    fail(
      `${path.basename(DATA_FILE)}: no channel records a \`submission\`, so HD-10 has no cohort. ` +
        `At least one is expected (ADR 0002 exists because submissions get recorded); either the ` +
        `field was renamed or the records were dropped.`,
    )
  } else if (missingPages.length > 0) {
    fail(
      `HD-10 audits ${missingPages.join(", ")} and ${missingPages.length === 1 ? "it does" : "they do"} not exist. ` +
        `A gate that skips a missing page reports agreement having read nothing.`,
    )
  } else {
    let bad = 0
    let directivesChecked = 0

    for (const page of PAGES) {
      const lines = fs.readFileSync(path.join(repoRoot, page), "utf8").split("\n")

      for (const c of submitted) {
        /* A directive line names the channel AND is structurally an instruction: a section
         * heading, or a ranked table row. Blockquotes and paragraphs are narration. */
        const directives = lines.filter(
          (l) => l.includes(c.kind) && (/^#{2,4}\s/.test(l) || /^\s*\|/.test(l)),
        )
        if (directives.length === 0) continue // this page does not rank or head this channel

        for (const line of directives) {
          directivesChecked++
          const queued = QUEUEING.filter((re) => re.test(line))
          const retired = RETIRING.some((re) => re.test(line))

          if (queued.length > 0) {
            bad++
            fail(
              `${page}: ${c.host}/${c.kind} records a submission on ${c.date}, but a directive ` +
                `line still orders the work (matched ${queued.map((re) => re.source).join(", ")}):\n` +
                `      ${line.trim().slice(0, 160)}\n` +
                `    Per ADR 0002 a recorded submission date ends actionability regardless of ` +
                `\`state\` — this is how a human gets sent to duplicate an external write.`,
            )
          } else if (!retired) {
            bad++
            fail(
              `${page}: ${c.host}/${c.kind} records a submission on ${c.date}, but its directive ` +
                `line does not say so:\n      ${line.trim().slice(0, 160)}\n` +
                `    State it on the line itself (e.g. "already made", "not actionable", ` +
                `"do not redo") — a reader scanning headings and table rows never reaches the prose.`,
            )
          }
        }
      }
    }

    if (directivesChecked === 0) {
      fail(
        `HD-10 found no heading or table row naming any of ${submitted.length} submitted channel(s) ` +
          `(${submitted.map((c) => c.kind).join(", ")}) across ${PAGES.join(", ")}. Either the pages ` +
          `stopped listing them or the directive-line shapes changed; the check compared nothing.`,
      )
    } else if (bad === 0) {
      pass(
        `${directivesChecked} directive line(s) naming ${submitted.length} submitted channel(s) ` +
          `(${submitted.map((c) => `${c.host}/${c.kind}`).join(", ")}) each mark the act already made, ` +
          `and none queues it as work`,
      )
    }
  }
}

/*
 * HD-09: `--agent` in CLI help must name exactly the extractors that exist.
 *
 * THE THIRD PARTY. HD-01 ties SSOT ↔ types.ts ↔ bootstrap, so a public page cannot
 * advertise `--agent x` without an extractor. Nothing tied the CLI's OWN help text to that
 * same set, and help.ts carries a hand-typed list of agent names. It drifted exactly as a
 * hand-typed list does: it named 9 while bootstrap registered 13, and the `--auto`
 * description named 8 display names while `--auto` iterates all 13 via
 * `getAllSortedByPriority()`. A user reading `--help` saw a shorter product than shipped.
 *
 * WHY BOTH DIRECTIONS. Missing names understate the product; extra names are worse — they
 * promise a command that exits "No config found for agent 'x'" no matter what the user
 * installs, which reads as CallLint failing to find a config rather than never having
 * supported it. Set equality is the only claim that catches both.
 *
 * The denominator is `bootstrappedExtractors`, derived above from each extractor's own
 * `agentType` declaration — not from help.ts. A gate that read its expectation out of the
 * text it audits would pass for any text.
 */
{
  console.log("\nChecking: CLI help --agent list matches registered extractors [HD-09]")

  const HELP_SRC = path.join(repoRoot, "apps/cli/src/commands/help.ts")
  if (!fs.existsSync(HELP_SRC)) {
    fail(`HD-09 cannot find ${path.relative(repoRoot, HELP_SRC)} — the gate has no subject`)
  } else {
    const helpText = fs.readFileSync(HELP_SRC, "utf8")

    // The `--agent <type>` line enumerates the supported types in parentheses.
    const agentLine = helpText.match(/--agent <type>[^\n(]*\(([^)]*)\)/)
    if (!agentLine) {
      fail(
        `HD-09 could not find a "--agent <type> ... (a, b, c)" enumeration in help.ts. ` +
          `Without it the gate has nothing to compare and would pass vacuously.`,
      )
    } else {
      const listed = new Set(
        agentLine[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )

      if (listed.size === 0) {
        fail(`HD-09 parsed an EMPTY --agent list out of help.ts — comparing against nothing`)
      }

      const missing = [...bootstrappedExtractors].filter((t) => !listed.has(t)).sort()
      const extra = [...listed].filter((t) => !bootstrappedExtractors.has(t)).sort()

      if (missing.length > 0) {
        fail(
          `HD-09: help.ts omits ${missing.length} registered extractor(s) from its --agent ` +
            `list: ${missing.join(", ")}. Users cannot discover a command the help does not name.`,
        )
      }
      if (extra.length > 0) {
        fail(
          `HD-09: help.ts advertises ${extra.length} --agent value(s) with no registered ` +
            `extractor: ${extra.join(", ")}. Each would exit "No config found for agent", ` +
            `which reads as a failed lookup rather than an unsupported host.`,
        )
      }
      if (missing.length === 0 && extra.length === 0) {
        pass(
          `help.ts --agent list matches all ${bootstrappedExtractors.size} registered ` +
            `extractors exactly (no omissions, no phantoms)`,
        )
      }
    }

    /*
     * The `--auto` blurb must not carry its own copy of the roster. It ran all 13 while
     * naming 8, and a second list is a second thing to drift; deferring to `--agent` is
     * the only spelling that cannot disagree with it.
     */
    const autoLine = helpText.match(/^\s*--auto\s+(.*)$/m)
    if (!autoLine) {
      fail(`HD-09 could not find the --auto line in help.ts`)
    } else {
      const named = [...bootstrappedExtractors].filter((t) => autoLine[1].includes(t))
      if (named.length > 0 && named.length < bootstrappedExtractors.size) {
        fail(
          `HD-09: the --auto description names ${named.length} of ` +
            `${bootstrappedExtractors.size} agents (${named.sort().join(", ")}), but --auto ` +
            `runs every registered extractor. Either name all of them or refer to --agent's ` +
            `list; a partial roster understates what --auto scans.`,
        )
      } else {
        pass(`--auto description carries no partial agent roster`)
      }
    }
  }
}

console.log("\n=== Summary ===\n")

if (failed) {
  console.error("❌ Harness distribution truth gate FAILED")
  process.exit(1)
} else {
  console.log("✅ All harness distribution checks PASSED")
  process.exit(0)
}
