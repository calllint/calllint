export interface Fingerprints {
  /** Hash of the raw config object for this server. */
  configHash: string
  /** Hash of the normalized target spec (command + args + envKeys). */
  targetSpecHash: string
  /** Hash of the package spec (name@version) when applicable. */
  packageSpecHash?: string
  /** Hash of provided source text, when applicable. */
  sourceHash?: string
  /** Hash of provided tool metadata, when applicable. */
  toolMetadataHash?: string
  /** Hash of the set of risk symbols + finding ids (the "risk surface"). */
  riskSurfaceHash: string
}

export const REPRODUCIBILITY_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const
export type ReproducibilityLevel = (typeof REPRODUCIBILITY_LEVELS)[number]

export interface Reproducibility {
  level: ReproducibilityLevel
  reasons: string[]
}
