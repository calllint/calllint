import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseD1Result, readUsage, sourceSummary } from "../src/report-sources.js"

const rows = [
  [{ day: "2026-10-16", event_name: "preflight_completed", n: 4 }],
  [{ n: 2 }], [{ d: "2026-10-16" }], [{ day: "2026-10-16", n: 2 }],
]
function read(responses: (Record<string, unknown>[] | null)[]) {
  let index = 0
  return readUsage("2026-10-16", () => responses[index++] ?? null)
}

describe("observed D1 data", () => {
  it("reads all real aggregate shapes, including distinct installations", () => {
    expect(read(rows)).toMatchObject({
      recordedPreflights: { cumulative: 4, last30: 4 }, activeInstallationsLast30: 2,
      trend: [{ day: "2026-10-16", preflights: 4, activeInstallations: 2 }],
    })
  })
  it.each([0, 1, 2, 3])("does not invent data when query %i fails", (index) => {
    const responses: (Record<string, unknown>[] | null)[] = [...rows]
    responses[index] = null
    expect(read(responses)).toBeNull()
  })
  it("accepts observed empty tables as real zeros", () => {
    expect(read([[], [{ n: 0 }], [{ d: null }], []])).toMatchObject({
      recordedPreflights: { cumulative: 0, last30: 0 }, activeInstallationsLast30: 0, trend: [],
    })
  })
  it.each([[], [{}], [{ n: null }], [{ n: "wrong" }]])("rejects missing/malformed COUNT result %j", (bad) => {
    expect(read([rows[0]!, bad, rows[2]!, rows[3]!])).toBeNull()
  })
})

describe("real generator entry and CI source reporting", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  let fixture: string
  beforeAll(() => {
    fixture = mkdtempSync(join(tmpdir(), "usage-source-entry-"))
    for (const file of ["scripts/generate-usage-report.mjs", "apps/usage-worker/src/report.ts",
      "apps/usage-worker/src/npm-history.ts", "apps/usage-worker/src/wrangler-failure.ts",
      "apps/usage-worker/src/report-sources.ts", "apps/usage-worker/src/pages-entry.js",
      "apps/usage-worker/src/usage.css"]) {
      mkdirSync(dirname(join(fixture, file)), { recursive: true })
      copyFileSync(join(root, file), join(fixture, file))
    }
    mkdirSync(join(fixture, "apps/web/public/install/mcp-registry/example"), { recursive: true })
    writeFileSync(join(fixture, "apps/web/public/install/mcp-registry/example/index.json"), "{}")
    // Controlled npm transport and wrangler executable; production generator, parser,
    // renderer and output writers run unchanged. No real credentials or network.
    writeFileSync(join(fixture, "transport.mjs"), `
      globalThis.fetch = async (url) => {
        if (!String(url).startsWith('https://api.npmjs.org/downloads/range/')) throw Error('unexpected network');
        if (process.env.TEST_NPM_FAILURE === 'true') return new Response('', {status: 503});
        const [start, end] = new URL(url).pathname.split('/')[3].split(':');
        const downloads = [];
        for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000)
          downloads.push({day: new Date(t).toISOString().slice(0,10), downloads: 1});
        return new Response(JSON.stringify({downloads}));
      };
    `)
    mkdirSync(join(fixture, "node_modules/wrangler/bin"), { recursive: true })
    writeFileSync(join(fixture, "node_modules/wrangler/bin/wrangler.js"), `
      const sql = process.argv[process.argv.indexOf('--command') + 1];
      const day = new Date(Date.now() - 86400000).toISOString().slice(0,10);
      const kind = sql.includes('event_name') ? 'counts' : sql.includes('MIN(day)') ? 'firstDay' :
        sql.includes('GROUP BY day') ? 'perDay' : 'installations';
      if (process.env.TEST_D1_FAILURE === kind) {
        console.log(JSON.stringify({error:{text:'Authentication error',notes:[{text:'code: 7403'}]}}));
        process.exit(1);
      }
      const rows = kind === 'counts' ? [{day,event_name:'preflight_completed',n:4}] :
        kind === 'firstDay' ? [{d:day}] : kind === 'perDay' ? [{day,n:2}] : [{n:2}];
      console.log(JSON.stringify([{success:true,results:rows}]));
    `)
  })
  afterAll(() => rmSync(fixture, { recursive: true, force: true }))

  function generate(name: string, extraEnv: Record<string, string> = {}, offline = false) {
    const out = join(fixture, name)
    const summary = join(fixture, `${name}-summary.md`)
    const outputs = join(fixture, `${name}-outputs.txt`)
    const log = execFileSync(process.execPath, [
      "--import", pathToFileURL(join(root, "node_modules/tsx/dist/loader.mjs")).href,
      "--import", pathToFileURL(join(fixture, "transport.mjs")).href,
      join(fixture, "scripts/generate-usage-report.mjs"), "--out", out,
      ...(offline ? ["--offline"] : []),
    ], {
      encoding: "utf8", timeout: 20_000,
      env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: tmpdir(), TMP: tmpdir(),
        GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: outputs,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { log, html: readFileSync(join(out, "index.html"), "utf8"),
      summary: readFileSync(summary, "utf8"), outputs: readFileSync(outputs, "utf8") }
  }

  it("publishes complete source evidence through the real entry", () => {
    const result = generate("healthy")
    expect(result.log).toContain("✓ D1: 4 preflights, 2 active installations")
    expect(result.outputs).toContain("source_status=complete")
    expect(result.summary).toContain("| D1 aggregates | available |")
    expect(result.log).not.toContain("::warning")
  })
  it.each(["counts", "installations", "firstDay", "perDay"])("keeps a failed %s read unavailable through HTML, warning and summary", (query) => {
    const result = generate(query, { TEST_D1_FAILURE: query })
    expect(result.html).toContain('<td class="na">—</td>')
    expect(result.log).not.toContain("✓ D1:")
    expect(result.log).toContain("::warning title=Usage report data incomplete::")
    expect(result.summary).toContain("| D1 aggregates | unavailable |")
    expect(result.outputs).toContain("source_status=degraded")
  })
  it("names npm degradation while preserving available D1", () => {
    const result = generate("npm-failed", { TEST_NPM_FAILURE: "true" })
    expect(result.summary).toContain("| npm calllint | unavailable |")
    expect(result.summary).toContain("| D1 aggregates | available |")
    expect(result.outputs).toContain("source_status=degraded")
  })
  it("keeps offline mode usable and explicitly skipped", () => {
    const result = generate("offline", {}, true)
    expect(result.summary).toContain("| D1 aggregates | skipped |")
    expect(result.outputs).toContain("source_status=degraded")
  })
  it("the shipped workflow runs these entry tests and consumes source status", () => {
    const workflow = readFileSync(join(root, ".github/workflows/usage-report.yml"), "utf8")
    expect(workflow).toContain("run: pnpm vitest run apps/usage-worker")
    expect(workflow).toContain("id: generate")
    expect(workflow).toContain("steps.generate.outputs.source_status")
    expect(workflow).not.toContain("credentials present — observed-usage rows will be populated")
  })
})

describe("wrangler D1 result envelope", () => {
  it("accepts explicit success with rows or an observed empty result", () => {
    expect(parseD1Result(JSON.stringify([{ success: true, results: rows[0] }]))).toEqual(rows[0])
    expect(parseD1Result('[{"success":true,"results":[]}]')).toEqual([])
  })
  it.each(["{}", "[]", "null", '{"success":false,"results":[]}',
    '{"success":true}', '{"success":true,"results":{}}',
    '{"error":{"text":"Authentication error"}}',
  ])("rejects an unavailable or malformed result rather than reporting zero: %s", (stdout) => {
    expect(() => parseD1Result(stdout)).toThrow()
  })
})

describe("source completeness is separate from deployment success", () => {
  const healthy = { cli: "available", mcp: "available", d1: "available", registry: "available" } as const
  it("reports complete only when every source is available", () => {
    expect(sourceSummary(healthy)).toMatchObject({ complete: true, warning: "" })
  })
  it.each(["cli", "mcp", "d1", "registry"] as const)("names the unavailable %s source", (source) => {
    const summary = sourceSummary({ ...healthy, [source]: "unavailable" })
    expect(summary.complete).toBe(false)
    expect(summary.markdown).toContain("DEGRADED")
    expect(summary.markdown).toContain("unavailable")
    expect(summary.warning).not.toBe("")
  })
  it("keeps offline/skipped sources distinct from observed zeros", () => {
    expect(sourceSummary({ ...healthy, d1: "skipped" }).markdown).toContain("| D1 aggregates | skipped |")
  })
})
