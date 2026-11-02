import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

it("the browser fallback is a valid ICO containing the canonical 32px brand PNG", () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)))
  const ico = read("../public/favicon.ico")
  const png = read("../../../assets/brand/favicon-32.png")
  expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 1, 0])
  expect([...ico.subarray(6, 10)]).toEqual([32, 32, 0, 0])
  expect(ico.readUInt16LE(10)).toBe(1)
  expect(ico.readUInt16LE(12)).toBe(32)
  expect(ico.readUInt32LE(14)).toBe(png.length)
  expect(ico.readUInt32LE(18)).toBe(22)
  expect(ico.subarray(22)).toEqual(png)
  expect(read("../public/favicon.png")).toEqual(png)
})
