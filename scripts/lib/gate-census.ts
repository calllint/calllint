export interface GateCensus {
  readonly sourceCount: number
  readonly servedCount: number
  readonly sourceNames: readonly string[]
  readonly servedNames: readonly string[]
  readonly requiredS1: number
  readonly requiredS2: number
}

export function assertServedMatchesSource(sourceNames: readonly string[], servedNames: readonly string[]): void {
  const source = new Set(sourceNames)
  const served = new Set(servedNames)
  if (source.size !== sourceNames.length || served.size !== servedNames.length) {
    throw new Error("source and served registry identities must be unique; refusing to write a passing census")
  }
  const missing = sourceNames.filter((name) => !served.has(name))
  const unexpected = servedNames.filter((name) => !source.has(name))
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `served registry identities do not match retained source identities (missing ${missing.length}, unexpected ${unexpected.length}); refusing to write a passing census`,
    )
  }
}

export function renderS1Census(census: GateCensus): string {
  const { sourceCount, servedCount, requiredS1 } = census
  const status = sourceCount >= requiredS1 ? "met" : "not met"
  return [
    "## Current committed census (generated)",
    "",
    "Derived from the retained registry snapshot and served index; dated measurements above are preserved.",
    "",
    `${sourceCount}/${sourceCount} source records reached the served tree.`,
    "",
    `Cohort census: source **${sourceCount} / ${requiredS1} required** (${status}); served **${servedCount} registry pages / ${sourceCount}`,
    "committed**.",
  ].join("\n")
}

export function renderS2Census(census: GateCensus): string {
  const { sourceCount, requiredS2 } = census
  const remaining = Math.max(0, requiredS2 - sourceCount)
  const status = sourceCount >= requiredS2 ? "threshold reached" : `${remaining} records before its threshold`
  return [
    "## Current committed census (generated)",
    "",
    "Derived from the retained registry snapshot and served index; dated measurements above are preserved.",
    "",
    `**Cohort now:** **${sourceCount}** — **${status}**`,
  ].join("\n")
}

export function replaceGeneratedCensus(document: string, rendered: string): string {
  const marker = /<!-- generated-cohort-census:start -->[\s\S]*?<!-- generated-cohort-census:end -->/g
  const matches = document.match(marker)
  if (matches?.length !== 1) {
    throw new Error(
      `expected exactly one generated-cohort-census block, found ${matches?.length ?? 0}`,
    )
  }
  return document.replace(
    marker,
    `<!-- generated-cohort-census:start -->\n${rendered}\n<!-- generated-cohort-census:end -->`,
  )
}
