import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"
import { parse } from "yaml"

// Execute the shipped step, with only curl replaced. jq parses real response files.
// Synthetic credentials never leave this process; an unexpected request fails closed.
const workflow = parse(readFileSync(fileURLToPath(new URL("../../.github/workflows/usage-report.yml", import.meta.url)), "utf8"))
const preflight: string = workflow.jobs.report.steps.find(
  (step: { name?: string }) => step.name === "Verify Cloudflare Pages deploy credentials",
)?.run
if (!preflight) throw new Error("production credential preflight step is missing")
const root = mkdtempSync(join(tmpdir(), "calllint-credentials-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const account = "0123456789abcdef0123456789abcdef"
const userURL = "https://api.cloudflare.com/client/v4/user/tokens/verify"
const accountURL = `https://api.cloudflare.com/client/v4/accounts/${account}/tokens/verify`
const pagesURL = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/calllint-usage-report`
const active = { success: true, result: { status: "active" } }
const denied = { success: false, errors: [{ code: 1000, message: "Invalid API Token" }] }
const pages = { success: true, result: { name: "calllint-usage-report" } }
interface Response { status: string; body: unknown; exit?: number }
const ok = (body: unknown): Response => ({ status: "200", body })

function run(token: string, responses: Response[], accountID = account, body = preflight) {
  const dir = mkdtempSync(join(root, "case-"))
  writeFileSync(join(dir, "count"), "0")
  writeFileSync(join(dir, "requests"), "")
  responses.forEach((response, i) => {
    writeFileSync(join(dir, `body-${i}`), typeof response.body === "string" ? response.body : JSON.stringify(response.body))
    writeFileSync(join(dir, `status-${i}`), response.status)
    writeFileSync(join(dir, `exit-${i}`), String(response.exit ?? 0))
  })
  const script = `
curl() {
  local n output url
  n=$(cat count)
  [ "$n" -lt ${responses.length} ] || { echo "unexpected API request" >&2; return 99; }
  echo $((n + 1)) > count
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -o) output="$2"; shift 2 ;;
      -H|-w|--max-time) shift 2 ;;
      https://*) url="$1"; shift ;;
      *) shift ;;
    esac
  done
  printf '%s\\n' "$url" >> requests
  cat "body-$n" > "$output"
  cat "status-$n"
  return "$(cat "exit-$n")"
}
${body}
`
  writeFileSync(join(dir, "run.sh"), script)
  const r = spawnSync("bash", [join(dir, "run.sh").replace(/\\/g, "/")], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountID },
    timeout: 15_000,
  })
  if (r.error) throw r.error
  return {
    status: r.status,
    output: r.stdout + r.stderr,
    urls: readFileSync(join(dir, "requests"), "utf8").trim().split("\n").filter(Boolean),
  }
}

describe("usage report credential preflight executes the correct Cloudflare API", () => {
  it.each([
    ["cfat_synthetic", [accountURL, pagesURL]],
    ["cfut_synthetic", [userURL, pagesURL]],
    ["legacy-synthetic", [userURL, pagesURL]],
  ])("accepts active %s tokens and checks the actual Pages project", (token, urls) => {
    const r = run(token as string, [ok(active), ok(pages)])
    expect(r.status, r.output).toBe(0)
    expect(r.urls).toEqual(urls)
    expect(r.output).not.toContain(token)
  })

  it("accepts a legacy account token after the user endpoint rejects it", () => {
    const r = run("legacy-synthetic", [{ status: "401", body: denied }, ok(active), ok(pages)])
    expect(r.status, r.output).toBe(0)
    expect(r.urls).toEqual([userURL, accountURL, pagesURL])
  })

  it("regression: the old unconditional user endpoint rejects a valid account token", () => {
    const changed = preflight.replace('cfat_*) token_endpoints=("accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify")', 'cfat_*) token_endpoints=("user/tokens/verify")')
    expect(changed).not.toBe(preflight)
    const r = run("cfat_synthetic", [{ status: "401", body: denied }], account, changed)
    expect(r.status).toBe(1)
    expect(r.urls).toEqual([userURL])
  })

  it.each([
    { status: "401", body: denied },
    { status: "200", body: { success: true, result: { status: "disabled" } } },
    { status: "200", body: { success: true, result: { status: "expired" } } },
    { status: "200", body: "not-json" },
    { status: "503", body: active },
    { status: "000", body: "" },
    { status: "000", body: "", exit: 28 },
  ])("blocks verification failure %# before reading Pages", (response) => {
    const r = run("cfat_synthetic", [response])
    expect(r.status).toBe(1)
    expect(r.urls).toEqual([accountURL])
    expect(r.output).not.toContain("cfat_synthetic")
  })

  it.each([
    { status: "403", body: denied },
    { status: "200", body: "not-json" },
    { status: "503", body: pages },
    { status: "000", body: "" },
    { status: "000", body: "", exit: 28 },
  ])("blocks Pages failure %# after successful token verification", (response) => {
    const r = run("cfat_synthetic", [ok(active), response])
    expect(r.status).toBe(1)
    expect(r.urls).toEqual([accountURL, pagesURL])
  })

  it.each([["", account], ["cfat_synthetic", ""]])("blocks missing credentials before making requests", (token, accountID) => {
    const r = run(token!, [], accountID!)
    expect(r.status).toBe(1)
    expect(r.urls).toEqual([])
    expect(r.output).toContain("deploy credentials are missing")
  })
})
