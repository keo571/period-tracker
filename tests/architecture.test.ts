import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const coreDir = fileURLToPath(new URL("../src/core", import.meta.url));

describe("architecture", () => {
  it("keeps core/ free of OpenClaw and adapter imports", () => {
    const files = readdirSync(coreDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(coreDir, file), "utf8");
      expect(source, file).not.toMatch(/from\s+["']openclaw/);
      expect(source, file).not.toMatch(/from\s+["']\.\.\/adapters/);
    }
  });
});
