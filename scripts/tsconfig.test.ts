import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";

const ROOT = resolve(import.meta.dir, "..");
const tsconfigPath = resolve(ROOT, "tsconfig.json");

interface TsConfig {
  compilerOptions: Record<string, unknown>;
  include?: string[];
  exclude?: string[];
}

function loadTsConfig(): TsConfig {
  const raw = readFileSync(tsconfigPath, "utf-8");
  return JSON.parse(raw) as TsConfig;
}

describe("tsconfig.json", () => {
  test("exists at project root", () => {
    expect(existsSync(tsconfigPath)).toBe(true);
  });

  test("is valid JSON", () => {
    const raw = readFileSync(tsconfigPath, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  describe("compilerOptions", () => {
    const config = loadTsConfig();
    const opts = config.compilerOptions;

    test("strict mode is enabled", () => {
      expect(opts.strict).toBe(true);
    });

    test("targets ESNext", () => {
      expect(opts.target).toBe("ESNext");
    });

    test("uses ESNext module system", () => {
      expect(opts.module).toBe("ESNext");
    });

    test("uses bundler module resolution", () => {
      expect(opts.moduleResolution).toBe("bundler");
    });

    test("enables esModuleInterop", () => {
      expect(opts.esModuleInterop).toBe(true);
    });

    test("enables resolveJsonModule", () => {
      expect(opts.resolveJsonModule).toBe(true);
    });

    test("has noEmit set (type-check only)", () => {
      expect(opts.noEmit).toBe(true);
    });

    test("includes bun-types", () => {
      expect(opts.types).toContain("bun-types");
    });

    test("enforces consistent casing in file names", () => {
      expect(opts.forceConsistentCasingInFileNames).toBe(true);
    });
  });

  describe("include pattern", () => {
    const config = loadTsConfig();

    test("includes scripts TypeScript files", () => {
      expect(config.include).toBeDefined();
      expect(config.include).toContainEqual("scripts/**/*.ts");
    });
  });

  describe("type-checking", () => {
    test("tsc --noEmit succeeds without errors", () => {
      // Run tsc and verify it exits cleanly
      expect(() => {
        execSync("npx tsc --noEmit", { cwd: ROOT, stdio: "pipe" });
      }).not.toThrow();
    });
  });
});
