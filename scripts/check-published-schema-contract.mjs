#!/usr/bin/env node
/**
 * Asserts that the PUBLISHED schemas under `apps/web/public/schemas/` still carry the
 * contract properties an external consumer relies on.
 *
 * new19 §19 lists "schema changes" among the five things the distribution watcher must
 * check. This is the local half of that requirement, and it is the half that can fail the
 * job: a schema under our own `public/` is our artifact, so a change to its identity is
 * our bug until somebody records otherwise.
 *
 * WHAT IS ASSERTED, and why each one is a contract and not a detail:
 *
 *   1. `$id` — the URL a consumer resolves. Changing it silently orphans every document
 *      that points at the old one. A version bump is legitimate; it must be deliberate,
 *      so it reds here and the operator moves the pin.
 *   2. `schemaVersion.const` — the contract identifier a consumer switches on. The index's
 *      value (`agent.discovery.v1`) is deliberately DISTINCT from the Safe-install bake's
 *      `calllint.discovery.v1`. Un-pinning the const makes the two documents confusable,
 *      which is exactly the collision that already dropped `resources[]` once on this
 *      workstream. That history is why this is asserted and not assumed.
 *   3. `additionalProperties: false` — the only reason validation catches a typo'd or
 *      invented field at all. Flipping it to `true` turns every downstream validator into
 *      a no-op while every test still passes, so nothing else would observe it.
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED: the schema's field set. Adding an optional field
 * is a normal, backward-compatible act, and a gate that reds on it would be renamed
 * "check-nobody-touched-the-schema" within a month and then deleted. Only the three
 * properties above are load-bearing for a consumer that already parses the document.
 *
 * ANTI-VACUITY: the manifest below is asserted to be non-empty AND every named file is
 * asserted to exist before any property is read. A checker whose file list silently
 * becomes empty reports health while observing nothing — the dominant fault class in this
 * repo, and one that has bitten this workstream twice.
 *
 * Exit 1 on any violation. Read-only; contacts nothing.
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * One entry per published schema. `id` and `versionConst` are the pins; `versionConst` is
 * null for a schema that legitimately has no such field, which is recorded explicitly
 * rather than by omission so a missing pin cannot be mistaken for "not applicable".
 */
const PUBLISHED = [
  {
    file: 'apps/web/public/schemas/agent-discovery-index.v1.json',
    id: 'https://calllint.com/schemas/agent-discovery-index.v1.json',
    versionConst: 'agent.discovery.v1',
    // Nested under `definitions.surface` rather than at the root, so the closed-world
    // check has to walk. Both levels matter: the root guards the envelope, the definition
    // guards each record.
    closedWorldPaths: [[], ['definitions', 'surface']],
  },
  {
    file: 'apps/web/public/schemas/agent-surfaces.v1.json',
    id: 'https://calllint.com/schemas/agent-surfaces.v1.json',
    versionConst: null,
    closedWorldPaths: [[]],
  },
]

const problems = []

if (PUBLISHED.length === 0) {
  console.error('✗ the published-schema manifest is empty; this checker would observe nothing.')
  process.exit(1)
}

const at = (doc, segments) => segments.reduce((node, key) => (node == null ? node : node[key]), doc)

for (const entry of PUBLISHED) {
  const abs = path.join(repoRoot, entry.file)
  if (!existsSync(abs)) {
    problems.push(`${entry.file}: named in the manifest but absent from the working tree`)
    continue
  }

  let doc
  try {
    doc = JSON.parse(readFileSync(abs, 'utf8'))
  } catch (error) {
    problems.push(`${entry.file}: not parseable as JSON — ${error.message}`)
    continue
  }

  if (doc.$id !== entry.id) {
    problems.push(`${entry.file}: $id is ${JSON.stringify(doc.$id)}, pinned as ${JSON.stringify(entry.id)}`)
  }

  if (entry.versionConst === null) {
    if (doc.properties?.schemaVersion?.const !== undefined) {
      problems.push(
        `${entry.file}: gained a schemaVersion.const (${JSON.stringify(doc.properties.schemaVersion.const)}) ` +
          'that the manifest records as absent — pin it here or drop it there',
      )
    }
  } else if (doc.properties?.schemaVersion?.const !== entry.versionConst) {
    problems.push(
      `${entry.file}: schemaVersion.const is ${JSON.stringify(doc.properties?.schemaVersion?.const)}, ` +
        `pinned as ${JSON.stringify(entry.versionConst)}`,
    )
  }

  for (const segments of entry.closedWorldPaths) {
    const label = segments.length === 0 ? 'root' : segments.join('.')
    const node = at(doc, segments)
    if (node === undefined || node === null) {
      problems.push(`${entry.file}: ${label} is absent, so its closed-world guarantee cannot be read`)
      continue
    }
    if (node.additionalProperties !== false) {
      problems.push(
        `${entry.file}: ${label}.additionalProperties is ${JSON.stringify(node.additionalProperties)} — ` +
          'an open schema accepts invented fields and every downstream validator becomes a no-op',
      )
    }
  }
}

if (problems.length > 0) {
  console.error('✗ published schema contract violated:')
  for (const p of problems) console.error(`    ${p}`)
  console.error('')
  console.error('  These are the properties an external consumer resolves and switches on. If a')
  console.error('  change here is intended, move the pin in scripts/check-published-schema-contract.mjs')
  console.error('  in the same commit, so the new contract is recorded rather than inferred.')
  process.exit(1)
}

console.log(`✓ published schema contract holds for ${PUBLISHED.length} schema(s):`)
for (const entry of PUBLISHED) {
  const version = entry.versionConst === null ? 'no schemaVersion const (recorded)' : entry.versionConst
  console.log(`    ${entry.file} — $id pinned, ${version}, closed-world at ${entry.closedWorldPaths.length} level(s)`)
}
