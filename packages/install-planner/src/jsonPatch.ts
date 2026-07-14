/**
 * Minimal, correct RFC-6902 JSON-Patch applier (ADR 0036). PURE: it deep-clones
 * the input and never mutates it, so a failed patch leaves the caller's document
 * untouched. This is the ONLY transform the apply engine runs against a host
 * config — a typed, auditable patch, never a shell string.
 *
 * Scope: the operations an Install Plan can carry (add/remove/replace/move/copy/
 * test) over JSON objects/arrays. Throws `JsonPatchError` on any illegal pointer
 * or precondition failure so apply fails closed (never a partial write).
 */
import type { JsonPatchOp } from "@calllint/types"

export class JsonPatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "JsonPatchError"
  }
}

/** Structured clone via JSON round-trip (documents here are already JSON). */
function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T)
}

/** Parse an RFC-6901 JSON-Pointer into unescaped reference tokens. */
function parsePointer(pointer: string): string[] {
  if (pointer === "") return []
  if (!pointer.startsWith("/")) throw new JsonPatchError(`invalid JSON-Pointer: ${pointer}`)
  return pointer
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"))
}

type Container = Record<string, unknown> | unknown[]

function isContainer(v: unknown): v is Container {
  return v !== null && typeof v === "object"
}

/** Resolve the parent container + final key for a pointer (parent must exist). */
function resolveParent(doc: unknown, tokens: string[]): { parent: Container; key: string } {
  let node: unknown = doc
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!isContainer(node)) throw new JsonPatchError(`path traverses a non-container at "${tokens[i]}"`)
    node = Array.isArray(node) ? node[Number(tokens[i])] : (node as Record<string, unknown>)[tokens[i]!]
  }
  if (!isContainer(node)) throw new JsonPatchError("path parent is not a container")
  return { parent: node, key: tokens[tokens.length - 1]! }
}

function getAt(doc: unknown, tokens: string[]): unknown {
  let node: unknown = doc
  for (const t of tokens) {
    if (!isContainer(node)) throw new JsonPatchError(`cannot read "${t}" of a non-container`)
    node = Array.isArray(node) ? node[t === "-" ? node.length : Number(t)] : (node as Record<string, unknown>)[t]
  }
  return node
}

function addAt(parent: Container, key: string, value: unknown): void {
  if (Array.isArray(parent)) {
    const idx = key === "-" ? parent.length : Number(key)
    if (Number.isNaN(idx) || idx < 0 || idx > parent.length) throw new JsonPatchError(`array index out of range: ${key}`)
    parent.splice(idx, 0, value)
  } else {
    parent[key] = value
  }
}

function removeAt(parent: Container, key: string): void {
  if (Array.isArray(parent)) {
    const idx = Number(key)
    if (Number.isNaN(idx) || idx < 0 || idx >= parent.length) throw new JsonPatchError(`array index out of range: ${key}`)
    parent.splice(idx, 1)
  } else {
    if (!(key in parent)) throw new JsonPatchError(`cannot remove missing key: ${key}`)
    delete parent[key]
  }
}

/**
 * Apply an RFC-6902 patch to a document, returning a NEW document. The input is
 * never mutated. Throws JsonPatchError on any illegal operation so the caller
 * (the apply engine) can fail closed before writing anything.
 */
export function applyJsonPatch(doc: unknown, patch: JsonPatchOp[]): unknown {
  let result = clone(doc)
  for (const op of patch) {
    const tokens = parsePointer(op.path)
    if (op.op === "test") {
      const actual = getAt(result, tokens)
      if (JSON.stringify(actual) !== JSON.stringify(op.value)) {
        throw new JsonPatchError(`test failed at ${op.path}`)
      }
      continue
    }
    if (tokens.length === 0) {
      // Whole-document replace/add (root).
      if (op.op === "add" || op.op === "replace") {
        result = clone(op.value)
        continue
      }
      throw new JsonPatchError(`op "${op.op}" not allowed on document root`)
    }
    switch (op.op) {
      case "add": {
        const { parent, key } = resolveParent(result, tokens)
        addAt(parent, key, clone(op.value))
        break
      }
      case "replace": {
        const { parent, key } = resolveParent(result, tokens)
        if (Array.isArray(parent)) {
          const idx = Number(key)
          if (Number.isNaN(idx) || idx < 0 || idx >= parent.length) throw new JsonPatchError(`replace index out of range: ${key}`)
          parent[idx] = clone(op.value)
        } else {
          if (!(key in parent)) throw new JsonPatchError(`cannot replace missing key: ${key}`)
          parent[key] = clone(op.value)
        }
        break
      }
      case "remove": {
        const { parent, key } = resolveParent(result, tokens)
        removeAt(parent, key)
        break
      }
      case "move":
      case "copy": {
        if (op.from === undefined) throw new JsonPatchError(`"${op.op}" requires "from"`)
        const fromTokens = parsePointer(op.from)
        const moved = clone(getAt(result, fromTokens))
        if (moved === undefined) throw new JsonPatchError(`"${op.op}" source missing: ${op.from}`)
        if (op.op === "move") {
          const src = resolveParent(result, fromTokens)
          removeAt(src.parent, src.key)
        }
        const { parent, key } = resolveParent(result, tokens)
        addAt(parent, key, moved)
        break
      }
      default:
        throw new JsonPatchError(`unsupported op: ${(op as { op: string }).op}`)
    }
  }
  return result
}
