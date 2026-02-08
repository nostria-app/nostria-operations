import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import {
  testRelayConnections,
  formatLogMarkdown,
  getLogFileName,
  writeLogFile,
  getDefaultLogDir,
  type ConnectionTestReport,
} from "./test-relay-connections";
import { loadRelayConfig } from "./validate-relays";

const RELAYS_JSON = resolve(import.meta.dir, "relays.json");

// ---------------------------------------------------------------------------
// Helper: create a minimal report for unit tests (no network)
// ---------------------------------------------------------------------------

function makeReport(overrides?: Partial<ConnectionTestReport>): ConnectionTestReport {
  return {
    timestamp: "2026-02-08T12:00:00.000Z",
    totalRelays: 2,
    reachable: 1,
    unreachable: 1,
    results: [
      { url: "wss://relay.example.com", reachable: true, latencyMs: 42, error: null },
      { url: "wss://bad.example.com", reachable: false, latencyMs: null, error: "Connection failed" },
    ],
    configPath: "/fake/relays.json",
    timeoutMs: 5000,
    durationMs: 1234,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// testRelayConnections unit tests
// ---------------------------------------------------------------------------

describe("testRelayConnections", () => {
  test("returns report with correct structure", async () => {
    const report = await testRelayConnections(
      ["wss://localhost:19999"],
      1000,
      "/test/relays.json"
    );
    expect(report).toHaveProperty("timestamp");
    expect(report).toHaveProperty("totalRelays");
    expect(report).toHaveProperty("reachable");
    expect(report).toHaveProperty("unreachable");
    expect(report).toHaveProperty("results");
    expect(report).toHaveProperty("configPath");
    expect(report).toHaveProperty("timeoutMs");
    expect(report).toHaveProperty("durationMs");
  }, 5000);

  test("configPath and timeoutMs are passed through", async () => {
    const report = await testRelayConnections([], 7500, "/my/config.json");
    expect(report.configPath).toBe("/my/config.json");
    expect(report.timeoutMs).toBe(7500);
  });

  test("durationMs is non-negative", async () => {
    const report = await testRelayConnections([], 1000, "/test.json");
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("handles empty relay list", async () => {
    const report = await testRelayConnections([], 1000, "/test.json");
    expect(report.totalRelays).toBe(0);
    expect(report.reachable).toBe(0);
    expect(report.unreachable).toBe(0);
    expect(report.results).toHaveLength(0);
  });

  test("counts unreachable relays correctly", async () => {
    const report = await testRelayConnections(
      ["wss://localhost:19998", "wss://localhost:19999"],
      1000,
      "/test.json"
    );
    expect(report.totalRelays).toBe(2);
    expect(report.unreachable).toBe(2);
    expect(report.reachable).toBe(0);
  }, 5000);

  test("timestamp is valid ISO string", async () => {
    const report = await testRelayConnections([], 1000, "/test.json");
    expect(() => new Date(report.timestamp)).not.toThrow();
    expect(new Date(report.timestamp).toISOString()).toBe(report.timestamp);
  });
});

// ---------------------------------------------------------------------------
// formatLogMarkdown unit tests
// ---------------------------------------------------------------------------

describe("formatLogMarkdown", () => {
  test("includes agent log header with date", () => {
    const report = makeReport();
    const md = formatLogMarkdown(report);
    expect(md).toContain("# Agent Log: DevOps — 2026-02-08");
  });

  test("includes task description", () => {
    const md = formatLogMarkdown(makeReport());
    expect(md).toContain("## Task");
    expect(md).toContain("Test WebSocket connections");
  });

  test("includes results table with all relays", () => {
    const md = formatLogMarkdown(makeReport());
    expect(md).toContain("| Relay | Status | Latency | Detail |");
    expect(md).toContain("wss://relay.example.com");
    expect(md).toContain("wss://bad.example.com");
    expect(md).toContain("| OK |");
    expect(md).toContain("| FAIL |");
  });

  test("includes summary counts", () => {
    const md = formatLogMarkdown(makeReport());
    expect(md).toContain("**Total:** 2");
    expect(md).toContain("**Reachable:** 1");
    expect(md).toContain("**Unreachable:** 1");
    expect(md).toContain("**Success rate:** 50%");
  });

  test("lists failed relays in issues section", () => {
    const md = formatLogMarkdown(makeReport());
    expect(md).toContain("## Issues Found");
    expect(md).toContain("wss://bad.example.com: Connection failed");
  });

  test("shows no issues when all reachable", () => {
    const report = makeReport({
      unreachable: 0,
      reachable: 2,
      results: [
        { url: "wss://a.com", reachable: true, latencyMs: 10, error: null },
        { url: "wss://b.com", reachable: true, latencyMs: 20, error: null },
      ],
    });
    const md = formatLogMarkdown(report);
    expect(md).toContain("None — all relays responded successfully");
  });

  test("includes duration", () => {
    const md = formatLogMarkdown(makeReport());
    expect(md).toContain("## Duration");
    expect(md).toContain("1234ms");
  });

  test("handles zero relays without dividing by zero", () => {
    const report = makeReport({
      totalRelays: 0,
      reachable: 0,
      unreachable: 0,
      results: [],
    });
    const md = formatLogMarkdown(report);
    expect(md).toContain("**Success rate:** 0%");
  });

  test("includes latency for reachable relays", () => {
    const md = formatLogMarkdown(makeReport());
    expect(md).toContain("42ms");
  });
});

// ---------------------------------------------------------------------------
// getLogFileName unit tests
// ---------------------------------------------------------------------------

describe("getLogFileName", () => {
  test("generates correct file name from ISO timestamp", () => {
    expect(getLogFileName("2026-02-08T12:00:00.000Z")).toBe(
      "2026-02-08-devops-relay-connection-test.md"
    );
  });

  test("uses date portion only", () => {
    const name = getLogFileName("2026-12-25T23:59:59.999Z");
    expect(name).toBe("2026-12-25-devops-relay-connection-test.md");
    expect(name).not.toContain("T");
    expect(name).not.toContain("23:59");
  });

  test("ends with .md extension", () => {
    expect(getLogFileName("2026-01-01T00:00:00.000Z")).toMatch(/\.md$/);
  });
});

// ---------------------------------------------------------------------------
// writeLogFile unit tests
// ---------------------------------------------------------------------------

describe("writeLogFile", () => {
  const tmpBase = resolve(tmpdir(), "test-relay-conn-" + Date.now());

  test("creates log directory if missing", () => {
    const logDir = resolve(tmpBase, "new-dir");
    expect(existsSync(logDir)).toBe(false);
    writeLogFile(logDir, makeReport());
    expect(existsSync(logDir)).toBe(true);
    rmSync(logDir, { recursive: true, force: true });
  });

  test("writes a markdown file with correct name", () => {
    const logDir = resolve(tmpBase, "write-test");
    const filePath = writeLogFile(logDir, makeReport());
    expect(filePath).toMatch(/2026-02-08-devops-relay-connection-test\.md$/);
    expect(existsSync(filePath)).toBe(true);
    rmSync(logDir, { recursive: true, force: true });
  });

  test("file contains valid markdown content", () => {
    const logDir = resolve(tmpBase, "content-test");
    const filePath = writeLogFile(logDir, makeReport());
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("# Agent Log:");
    expect(content).toContain("## Task");
    expect(content).toContain("## Results");
    expect(content).toContain("## Summary");
    expect(content).toContain("## Issues Found");
    expect(content).toContain("## Duration");
    rmSync(logDir, { recursive: true, force: true });
  });

  test("returns absolute path to log file", () => {
    const logDir = resolve(tmpBase, "path-test");
    const filePath = writeLogFile(logDir, makeReport());
    expect(resolve(filePath)).toBe(filePath);
    rmSync(logDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// getDefaultLogDir unit tests
// ---------------------------------------------------------------------------

describe("getDefaultLogDir", () => {
  test("resolves to a path ending with /logs", () => {
    const logDir = getDefaultLogDir();
    expect(logDir).toMatch(/logs$/);
  });

  test("path is within the repo root", () => {
    const logDir = getDefaultLogDir();
    const repoRoot = resolve(import.meta.dir, "../..");
    expect(logDir.startsWith(repoRoot)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: test actual relay connections and log output
// ---------------------------------------------------------------------------

describe("relay connection test (live)", () => {
  const config = loadRelayConfig(RELAYS_JSON);

  test(
    "at least 50% of configured relays are reachable",
    async () => {
      const report = await testRelayConnections(
        config.relays,
        config.timeout_ms,
        RELAYS_JSON
      );

      console.log(
        `\n  Live test: ${report.reachable}/${report.totalRelays} reachable (${report.durationMs}ms)`
      );
      for (const r of report.results) {
        const status = r.reachable ? "OK" : "FAIL";
        const detail = r.reachable
          ? `${r.latencyMs}ms`
          : r.error || "unknown";
        console.log(`    [${status}] ${r.url} (${detail})`);
      }

      const minRequired = Math.ceil(config.relays.length * 0.5);
      expect(report.reachable).toBeGreaterThanOrEqual(minRequired);
    },
    config.timeout_ms + 10000
  );

  test(
    "log file can be generated from live results",
    async () => {
      const report = await testRelayConnections(
        config.relays,
        config.timeout_ms,
        RELAYS_JSON
      );

      const tmpDir = resolve(tmpdir(), "relay-live-log-" + Date.now());
      const logPath = writeLogFile(tmpDir, report);

      expect(existsSync(logPath)).toBe(true);
      const content = readFileSync(logPath, "utf-8");
      expect(content).toContain("# Agent Log:");

      // Every relay should appear in the log
      for (const relay of config.relays) {
        expect(content).toContain(relay);
      }

      rmSync(tmpDir, { recursive: true, force: true });
    },
    config.timeout_ms + 10000
  );
});
