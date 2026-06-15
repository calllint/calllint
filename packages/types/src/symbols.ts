export const RISK_SYMBOLS = [
  "SECRETS",
  "FILES",
  "NETWORK",
  "PROMPT",
  "EXEC",
  "ACTION",
  "MONEY",
  "SUPPLY",
  "RUGPULL",
] as const

export type RiskSymbol = (typeof RISK_SYMBOLS)[number]

/** Emoji + label for default CLI rendering. */
export const RISK_SYMBOL_EMOJI: Record<RiskSymbol, string> = {
  SECRETS: "🔐",
  FILES: "📁",
  NETWORK: "🌐",
  PROMPT: "🧠",
  EXEC: "⚙️",
  ACTION: "✉️",
  MONEY: "💸",
  SUPPLY: "🧩",
  RUGPULL: "🔁",
}

export const RISK_SYMBOL_LABEL: Record<RiskSymbol, string> = {
  SECRETS: "Secrets",
  FILES: "Files",
  NETWORK: "Network",
  PROMPT: "Prompt",
  EXEC: "Exec",
  ACTION: "Action",
  MONEY: "Money",
  SUPPLY: "Supply Chain",
  RUGPULL: "Rug Pull",
}

/** Risk classes S0–S5. */
export const RISK_CLASSES = ["S0", "S1", "S2", "S3", "S4", "S5"] as const

export type RiskClass = (typeof RISK_CLASSES)[number]

export const RISK_CLASS_LABEL: Record<RiskClass, string> = {
  S0: "Metadata only",
  S1: "Read-only utility",
  S2: "Sensitive read",
  S3: "External mutation",
  S4: "Execution / automation",
  S5: "Financial / irreversible",
}

/** Numeric ordering so we can take the highest risk class observed. */
export const RISK_CLASS_RANK: Record<RiskClass, number> = {
  S0: 0,
  S1: 1,
  S2: 2,
  S3: 3,
  S4: 4,
  S5: 5,
}

export function highestRiskClass(classes: readonly RiskClass[]): RiskClass {
  let worst: RiskClass = "S0"
  for (const c of classes) {
    if (RISK_CLASS_RANK[c] > RISK_CLASS_RANK[worst]) worst = c
  }
  return worst
}
