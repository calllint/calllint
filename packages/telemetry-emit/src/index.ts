/**
 * @calllint/telemetry-emit — the emission LAYER on top of @calllint/telemetry-contract.
 *
 * The contract is definition + sanitization only (it never emits). This package adds
 * the emit-time gate (tier policy + consent + env kill-switch), a sink abstraction, and
 * an emitter that routes every event through the contract's sanitizer before a sink can
 * see it. It ships NO network sink — phoning home is a separate, explicitly-authorized
 * decision, and `security-boundary.yml` asserts this package imports no network module.
 * With telemetry gated off (the default for local CLI), the caller's output is unchanged.
 */
export {
  shouldEmit,
  isTelemetryDisabledByEnv,
  type GateState,
} from "./gate.js"
export {
  noopSink,
  jsonlFileSink,
  memorySink,
  type TelemetrySink,
} from "./sink.js"
export {
  createEmitter,
  type Emitter,
  type EmitterConfig,
  type EmitOutcome,
  type RawEmitInput,
} from "./emitter.js"
