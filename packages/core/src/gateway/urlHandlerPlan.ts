/**
 * Plan the OS registration of the `calllint://` handler — pure, per platform.
 *
 * WHY THIS IS A SECOND WRITER (and why that needed an ADR). Every live-config write
 * in this repo goes through `applyPlan`, which is JSON-patch over a host config file.
 * A Windows registry key and an XDG `.desktop` + mimeapps association are neither
 * JSON nor patchable, so they cannot reuse that engine. This module plans them under
 * the SAME discipline — plan → digest → explicit `--approve` → verify → rollback —
 * but the writer itself is separate. That is the one architectural addition here, and
 * it is deliberately narrow: it can create exactly the records below and nothing else.
 *
 * macOS is UNSUPPORTED on purpose, not by omission: Launch Services only honours
 * `CFBundleURLTypes` inside an `.app` bundle, and CallLint ships as an npm CLI with no
 * bundle. Planning reports `UNSUPPORTED_PLATFORM` with the reason so the page's
 * visible fallback command is the honest macOS path. A partially-registered handler
 * would be worse than none: the link would appear clickable and do nothing.
 *
 * Pure: no I/O, no environment read. The caller injects platform, paths and the
 * binary location, so every branch is unit-testable on any OS.
 */

/** The platforms this writer can register on. */
export type HandlerPlatform = "win32" | "linux" | "darwin"

/** One record the writer may create. `kind` selects the port method, not a shell verb. */
export type HandlerRecord =
  | {
      readonly kind: "REGISTRY_KEY"
      /** Per-user hive only — registering machine-wide would need admin. */
      readonly path: string
      readonly valueName: string
      readonly value: string
    }
  | {
      readonly kind: "DESKTOP_FILE"
      readonly path: string
      readonly contents: string
    }
  | {
      readonly kind: "MIME_DEFAULT"
      readonly path: string
      readonly scheme: string
      readonly desktopFile: string
    }

export type UrlHandlerPlan =
  | {
      readonly supported: true
      readonly platform: HandlerPlatform
      readonly records: readonly HandlerRecord[]
    }
  | {
      readonly supported: false
      readonly platform: HandlerPlatform
      readonly reason: "UNSUPPORTED_PLATFORM"
      readonly detail: string
    }

export interface PlanInput {
  readonly platform: HandlerPlatform
  /** Absolute path to the `calllint` executable that will receive the URI. */
  readonly binPath: string
  /** Absolute home directory, injected so tests never read the real one. */
  readonly home: string
}

/**
 * The `%1` placeholder Windows substitutes with the invoked URI. It arrives as a
 * single argv element, so it is data — the handler re-parses it with the strict
 * parser and refuses anything malformed.
 */
const WIN_URI_PLACEHOLDER = "%1"

/** The XDG desktop entry. `%u` is the single-URI placeholder, same reasoning as `%1`. */
function desktopEntry(binPath: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=CallLint",
    "Comment=Open a CallLint adoption link and stop at the local authority prompt",
    `Exec=${binPath} url-handler open %u`,
    "Terminal=true",
    "NoDisplay=true",
    "MimeType=x-scheme-handler/calllint;",
    "",
  ].join("\n")
}

/** Plan the records for a platform. Total: every platform returns a decision. */
export function planUrlHandler(input: PlanInput): UrlHandlerPlan {
  const { platform, binPath, home } = input

  if (platform === "darwin") {
    return {
      supported: false,
      platform,
      reason: "UNSUPPORTED_PLATFORM",
      detail:
        "macOS registers URL schemes only via CFBundleURLTypes in an .app bundle; CallLint ships as an npm CLI. Use the fallback command shown on the install page.",
    }
  }

  if (platform === "win32") {
    // HKCU, never HKLM: per-user needs no elevation, and a handler that demanded
    // admin would push users toward running an installer as administrator.
    const base = "HKCU\\Software\\Classes\\calllint"
    return {
      supported: true,
      platform,
      records: [
        { kind: "REGISTRY_KEY", path: base, valueName: "", value: "URL:CallLint adoption link" },
        { kind: "REGISTRY_KEY", path: base, valueName: "URL Protocol", value: "" },
        {
          kind: "REGISTRY_KEY",
          path: `${base}\\shell\\open\\command`,
          valueName: "",
          value: `"${binPath}" url-handler open "${WIN_URI_PLACEHOLDER}"`,
        },
      ],
    }
  }

  const desktopPath = `${home}/.local/share/applications/calllint-url.desktop`
  return {
    supported: true,
    platform,
    records: [
      { kind: "DESKTOP_FILE", path: desktopPath, contents: desktopEntry(binPath) },
      {
        kind: "MIME_DEFAULT",
        path: `${home}/.config/mimeapps.list`,
        scheme: "x-scheme-handler/calllint",
        desktopFile: "calllint-url.desktop",
      },
    ],
  }
}
