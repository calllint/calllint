// new5 R3 — Local Receipt Core (ADR 0028). A reporting layer over an existing
// ScanReport: it records a verdict, it never re-judges or re-scans one.
export type {
  CallLintReceipt,
  CreateReceiptInput,
} from "./types.js"
export { createReceipt } from "./createReceipt.js"
export { verifyReceipt, type VerifyReceiptResult } from "./verifyReceipt.js"
