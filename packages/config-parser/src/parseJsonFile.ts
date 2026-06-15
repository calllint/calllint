export class ConfigParseError extends Error {
  readonly code = "config.parse-error"
  constructor(
    message: string,
    readonly path: string | undefined,
  ) {
    super(message)
    this.name = "ConfigParseError"
  }
}

/** Parse JSON, throwing a ConfigParseError (never a bare SyntaxError). */
export function parseJsonText(text: string, path?: string): unknown {
  try {
    return JSON.parse(text)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new ConfigParseError(`Invalid JSON: ${reason}`, path)
  }
}
