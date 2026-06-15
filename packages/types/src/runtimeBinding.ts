export const RUNTIME_KINDS = [
  "npx",
  "node",
  "python",
  "uvx",
  "docker",
  "http",
  "sse",
  "unknown",
] as const
export type RuntimeKind = (typeof RUNTIME_KINDS)[number]

export const TRANSPORTS = ["stdio", "sse", "http", "unknown"] as const
export type Transport = (typeof TRANSPORTS)[number]

/**
 * What a server config will actually run — resolved beyond the surface command.
 * "command = npx" is not enough; the real subject is the resolved package/remote.
 */
export interface RuntimeBinding {
  declaredCommand?: string
  declaredArgs: string[]
  transport: Transport
  runtimeKind: RuntimeKind
  packageName?: string
  packageVersionSpec?: string
  isVersionPinned: boolean
  remoteUrl?: string
  /** True when we can name a concrete package or a known remote. */
  sourceKnown: boolean
  /** True when the runtime may run install scripts (e.g. npx -y / postinstall). */
  installMayRunScripts: boolean
  /** True when the runtime can execute code on the host (vs a fixed remote URL). */
  runtimeExecutable: boolean
}
