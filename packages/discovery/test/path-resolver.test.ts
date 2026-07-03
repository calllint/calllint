import { describe, it, expect } from "vitest"
import { resolvePath, isRegularFile, isReasonableSize, validateConfigPath } from "../src/path-resolver.js"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("path-resolver", () => {
  describe("resolvePath", () => {
    it("resolves absolute paths unchanged", () => {
      const absolute = "/absolute/path/to/config.json"
      const resolved = resolvePath(absolute, "/some/cwd")
      expect(resolved).toBe(absolute)
    })

    it("resolves relative paths from CWD", () => {
      const resolved = resolvePath("./config.json", "/project")
      // On Windows, this becomes D:\project\config.json; on Unix, /project/config.json
      expect(resolved).toContain("config.json")
      expect(resolved).toContain("project")
    })

    it("resolves ~ to home directory", () => {
      const home = process.env.HOME || process.env.USERPROFILE
      if (!home) throw new Error("Cannot test ~ without HOME set")

      const resolved = resolvePath("~/.config/settings.json", "/any/cwd")
      expect(resolved).toBe(join(home, ".config/settings.json"))
    })

    it("resolves ~/ to home directory", () => {
      const home = process.env.HOME || process.env.USERPROFILE
      if (!home) throw new Error("Cannot test ~ without HOME set")

      const resolved = resolvePath("~/Documents/file.txt", "/any/cwd")
      expect(resolved).toBe(join(home, "Documents/file.txt"))
    })

    it("throws if ~ cannot be resolved (HOME not set)", () => {
      const originalHome = process.env.HOME
      const originalUserProfile = process.env.USERPROFILE
      delete process.env.HOME
      delete process.env.USERPROFILE

      try {
        expect(() => resolvePath("~/config.json", "/cwd")).toThrow(/home directory/)
      } finally {
        if (originalHome) process.env.HOME = originalHome
        if (originalUserProfile) process.env.USERPROFILE = originalUserProfile
      }
    })
  })

  describe("isRegularFile", () => {
    it("returns true for regular files", () => {
      const tempFile = join(tmpdir(), `test-${Date.now()}.txt`)
      writeFileSync(tempFile, "test content")

      try {
        expect(isRegularFile(tempFile)).toBe(true)
      } finally {
        if (existsSync(tempFile)) rmSync(tempFile)
      }
    })

    it("returns false for directories", () => {
      const tempDir = join(tmpdir(), `test-dir-${Date.now()}`)
      mkdirSync(tempDir, { recursive: true })

      try {
        expect(isRegularFile(tempDir)).toBe(false)
      } finally {
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true })
      }
    })

    it("returns false for non-existent paths", () => {
      const nonExistent = join(tmpdir(), `non-existent-${Date.now()}.txt`)
      expect(isRegularFile(nonExistent)).toBe(false)
    })
  })

  describe("isReasonableSize", () => {
    it("returns true for small files (< 10MB)", () => {
      const tempFile = join(tmpdir(), `test-small-${Date.now()}.txt`)
      writeFileSync(tempFile, "small content")

      try {
        expect(isReasonableSize(tempFile)).toBe(true)
      } finally {
        if (existsSync(tempFile)) rmSync(tempFile)
      }
    })

    it("returns false for files >= 10MB", () => {
      const tempFile = join(tmpdir(), `test-large-${Date.now()}.bin`)
      const largeContent = Buffer.alloc(11 * 1024 * 1024, 0) // 11MB

      writeFileSync(tempFile, largeContent)

      try {
        expect(isReasonableSize(tempFile)).toBe(false)
      } finally {
        if (existsSync(tempFile)) rmSync(tempFile)
      }
    })

    it("returns false for non-existent files", () => {
      const nonExistent = join(tmpdir(), `non-existent-${Date.now()}.txt`)
      expect(isReasonableSize(nonExistent)).toBe(false)
    })
  })

  describe("validateConfigPath", () => {
    it("returns true for valid small regular files", () => {
      const tempFile = join(tmpdir(), `test-valid-${Date.now()}.json`)
      writeFileSync(tempFile, '{"valid": "json"}')

      try {
        expect(validateConfigPath(tempFile)).toBe(true)
      } finally {
        if (existsSync(tempFile)) rmSync(tempFile)
      }
    })

    it("returns false for directories", () => {
      const tempDir = join(tmpdir(), `test-dir-${Date.now()}`)
      mkdirSync(tempDir, { recursive: true })

      try {
        expect(validateConfigPath(tempDir)).toBe(false)
      } finally {
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true })
      }
    })

    it("returns false for non-existent files", () => {
      const nonExistent = join(tmpdir(), `non-existent-${Date.now()}.json`)
      expect(validateConfigPath(nonExistent)).toBe(false)
    })

    it("returns false for files >= 10MB", () => {
      const tempFile = join(tmpdir(), `test-huge-${Date.now()}.bin`)
      const largeContent = Buffer.alloc(11 * 1024 * 1024, 0)

      writeFileSync(tempFile, largeContent)

      try {
        expect(validateConfigPath(tempFile)).toBe(false)
      } finally {
        if (existsSync(tempFile)) rmSync(tempFile)
      }
    })
  })
})
