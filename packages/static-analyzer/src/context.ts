import type { NormalizedMcpServer, RuntimeBinding } from "@calllint/types"

/** Everything a detector needs about one server. */
export interface DetectorContext {
  server: NormalizedMcpServer
  binding: RuntimeBinding
}
