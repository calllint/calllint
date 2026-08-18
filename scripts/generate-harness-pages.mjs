#!/usr/bin/env node
/**
 * Generate harness distribution public pages.
 *
 * Reads harness-surfaces.json and generates individual host pages
 * under apps/web/public/harnesses/deepseek/<host-id>.html
 *
 * Each page includes:
 * - Host-specific authority facts
 * - CallLint coverage status
 * - Truthful CLI command (or explicit "not supported")
 * - Coverage boundary for partial-support hosts
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DATA_FILE = join(__dirname, "../apps/web/data/harness-surfaces.json")
const OUTPUT_DIR = join(__dirname, "../apps/web/public/harnesses/deepseek")

// Read harness surfaces data
const data = JSON.parse(readFileSync(DATA_FILE, "utf8"))

// Ensure output directory exists
mkdirSync(OUTPUT_DIR, { recursive: true })

// Generate page for each host
for (const cohort of Object.values(data.cohorts)) {
  for (const host of cohort) {
    generateHostPage(host)
  }
}

console.log(`✅ Generated ${Object.values(data.cohorts).flat().length} harness pages in ${OUTPUT_DIR}`)

function generateHostPage(host) {
  const { id, displayName, vendor, authoritySurfaces, calllintSupportClass, truthfulCommand, coverageBoundary, configEvidence } = host

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${displayName} + DeepSeek Authority Review — CallLint</title>
    <meta
      name="description"
      content="Inspect MCP and tool authority when using DeepSeek with ${displayName}. ${getMetaDescription(host)}"
    />
    <link rel="canonical" href="https://calllint.com/harnesses/deepseek/${id}" />
    <link rel="icon" href="/favicon.png" type="image/png" />
    <link rel="apple-touch-icon" href="/logo-mark-256.png" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="https://calllint.com/harnesses/deepseek/${id}" />
    <meta property="og:title" content="${displayName} + DeepSeek Authority Review — CallLint" />
    <meta property="og:description" content="Review ${displayName} MCP and tool configuration before enabling DeepSeek." />
    <meta property="og:image" content="https://calllint.com/og-image.png" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <header class="site-header">
      <a class="brand-lockup" href="/" aria-label="CallLint home">
        <img class="brand-mark" src="/logo-mark-128.png" width="40" height="40" alt="" />
        <span class="brand-name">CallLint</span>
      </a>
      <nav class="nav-links" aria-label="Primary">
        <a href="/#how">How</a>
        <a href="/#checks">Checks</a>
        <a href="/#trust">Trust</a>
        <a href="/agents">For agents</a>
        <a href="/mcp-security">MCP security</a>
        <a href="https://github.com/calllint/calllint">GitHub</a>
      </nav>
    </header>
    <main>
      <section class="section section-narrow topic">
        <p class="lede"><a href="/harnesses/deepseek/">DeepSeek Harness Authority</a></p>
        <h1>${displayName} + DeepSeek</h1>

        <p class="prose">${displayName} (${vendor}) can grant authority through ${formatAuthoritySurfaces(authoritySurfaces)}. Using DeepSeek as the model does not change these permissions — the harness configuration controls what the agent can access.</p>

        <h2>Authority Surfaces</h2>
        <ul>
${authoritySurfaces.map(s => `          <li><strong>${formatSurfaceName(s)}:</strong> ${describeSurface(s, host)}</li>`).join("\n")}
        </ul>

        ${generateCallLintSection(host)}

        ${coverageBoundary ? `<div class="callout"><strong>Coverage boundary:</strong> ${coverageBoundary}</div>\n` : ""}

        <h2>What Changes When Using DeepSeek?</h2>
        <p class="prose">The model identity changes. The authority surfaces do not. ${displayName} grants the same filesystem, shell, network, and API permissions regardless of which model you select.</p>

        <h2>What CallLint Inspects</h2>
        <ul>
          <li>Filesystem access patterns (read, write, delete)</li>
          <li>Shell command execution capabilities</li>
          <li>Network endpoints (HTTP, WebSocket, SSE)</li>
          <li>Environment variable access</li>
          <li>Package install and supply-chain surfaces</li>
        </ul>

        <p class="prose"><strong>CallLint does not:</strong></p>
        <ul>
          <li>Evaluate model safety or capabilities</li>
          <li>Certify ${displayName} as "safe" or "secure"</li>
          <li>Execute or install the servers it inspects</li>
          <li>Make recommendations based on popularity or model choice</li>
        </ul>

        <div class="callout">UNKNOWN is not SAFE. It means the surface could not be verified statically. Review manually or use a published Trust Page.</div>

        <p class="prose"><a href="/harnesses/deepseek/">All harnesses</a> · <a href="/">CallLint home</a> · <a href="https://github.com/calllint/calllint">GitHub</a></p>
      </section>
    </main>
    <footer class="site-footer">
      <div class="footer-brand">
        <img src="/logo-mark-128.png" width="28" height="28" alt="" />
        <span>CallLint · evidence-backed verdicts for agent tools</span>
      </div>
      <div class="footer-links">
        <a href="/">Home</a> ·
        <a href="/mcp-security">MCP security</a> ·
        <a href="/agent-tool-risk">Agent tool risk</a> ·
        <a href="/agents">For agents</a> ·
        <a href="https://github.com/calllint/calllint">GitHub</a>
      </div>
    </footer>
  </body>
</html>
`

  const outputPath = join(OUTPUT_DIR, `${id}.html`)
  writeFileSync(outputPath, html, "utf8")
  console.log(`  Generated: ${id}.html`)
}

function getMetaDescription(host) {
  if (host.calllintSupportClass === "NATIVE") {
    return `CallLint can auto-discover and scan ${host.displayName} MCP configuration.`
  }
  if (host.calllintSupportClass === "CONFIG_SCAN") {
    return `CallLint can scan ${host.displayName} configuration with an explicit path.`
  }
  return `Review ${host.displayName} tool authority before enabling DeepSeek.`
}

function formatAuthoritySurfaces(surfaces) {
  if (surfaces.length === 1) return surfaces[0]
  if (surfaces.length === 2) return `${surfaces[0]} and ${surfaces[1]}`
  const last = surfaces[surfaces.length - 1]
  const rest = surfaces.slice(0, -1).join(", ")
  return `${rest}, and ${last}`
}

function formatSurfaceName(surface) {
  const names = {
    mcp: "MCP servers",
    extensions: "Extensions",
    filesystem: "Filesystem",
    shell: "Shell",
    skills: "Skills",
    exec: "Exec",
    tools: "Tools",
    "code-generation": "Code generation",
    api: "API",
    cli: "CLI",
    "vscode-extensions": "VS Code extensions",
  }
  return names[surface] || surface
}

function describeSurface(surface, host) {
  const descriptions = {
    mcp: "Model Context Protocol servers with filesystem, shell, network, and API capabilities",
    extensions: "Custom tool extensions with configurable authority",
    filesystem: "Direct filesystem read/write access",
    shell: "Shell command execution",
    skills: "Skill-based permission system (separate from MCP)",
    exec: "Executable launch and process control",
    tools: "Agent tool plugins",
    "code-generation": "Code generation and modification",
    api: "External API access",
    cli: "Command-line interface tools",
    "vscode-extensions": "VS Code extension API access",
  }
  return descriptions[surface] || `${surface} authority surface`
}

function generateCallLintSection(host) {
  const { calllintSupportClass, truthfulCommand, configEvidence } = host

  if (calllintSupportClass === "NATIVE") {
    return `<h2>Scan with CallLint</h2>
        <p class="prose">CallLint can automatically discover and scan ${host.displayName} configuration:</p>
        <pre><code>npx ${truthfulCommand}</code></pre>
        <p class="prose">Or scan all detected agent configs:</p>
        <pre><code>npx calllint scan --auto</code></pre>
        <p class="prose">Expected config paths:</p>
        <ul>
${configEvidence.map(p => `          <li><code>${p}</code></li>`).join("\n")}
        </ul>`
  }

  if (calllintSupportClass === "CONFIG_SCAN") {
    return `<h2>Scan with CallLint</h2>
        <p class="prose">CallLint can scan ${host.displayName} configuration with an explicit path:</p>
        <pre><code>npx ${truthfulCommand}</code></pre>
        <p class="prose">Expected config paths:</p>
        <ul>
${configEvidence.map(p => `          <li><code>${p}</code></li>`).join("\n")}
        </ul>
        <p class="prose">Auto-discovery is not yet supported for this host.</p>`
  }

  // DISCOVERY_ONLY
  return `<h2>CallLint Coverage</h2>
        <p class="prose">CallLint does not yet auto-discover ${host.displayName} configuration. You can still:</p>
        <ul>
          <li>Look up published MCP servers on the <a href="/trust/">Trust Index</a></li>
          <li>Scan inline MCP configuration: <code>npx calllint scan &lt;config.json&gt;</code></li>
          <li>Review general <a href="/mcp-security">MCP security guidance</a></li>
        </ul>
        <p class="prose">Config mechanism: ${configEvidence.join(", ")}</p>`
}
