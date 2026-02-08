import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import {
  classifyHealth,
  toHealthResult,
  computeSummary,
  generateHealthReport,
  formatHealthMarkdown,
  getHealthLogFileName,
  writeHealthLogFile,
  getDefaultLogDir,
  type RelayHealthStatus,
  type RelayHealthResult,
  type RelayHealthReport,
  type HealthSummary,
} from "./relay-health-report";
import { loadRelayConfig, type RelayCheckResult } from "./validate-relays";

const RELAYS_JSON = resolve(import.meta.dir, "relays.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCheckResult(overrides?: Partial<RelayCheckResult>): RelayCheckResult {
  return {
    url: "wss://relay.example.com",
    reachable: true,
    latencyMs: 42,
    error: null,
    retriesUsed: 0,
    ...overrides,
  };
}

function makeHealthResult(overrides?: Partial<RelayHealthResult>): RelayHealthResult {
  return {
    url: "wss://relay.example.com",
    status: "responded",
    latencyMs: 42,
    error: null,
    retriesUsed: 0,
    ...overrides,
  };
}

function makeReport(overrides?: Partial<RelayHealthReport>): RelayHealthReport {
  const relays: RelayHealthResult[] = [
    makeHealthResult({ url: "wss://good.example.com", status: "responded", latencyMs: 50 }),
    makeHealthResult({ url: "wss://slow.example.com", status: "timed_out", latencyMs: null, error: "Timeout after 5000ms", retriesUsed: 2 }),
    makeHealthResult({ url: "wss://bad.example.com", status: "error", latencyMs: null, error: "Connection failed", retriesUsed: 1 }),
  ];
  return {
    timestamp: "2026-02-08T12:00:00.000Z",
    configPath: "/fake/relays.json",
    timeoutMs: 5000,
    durationMs: 1234,
    summary: computeSummary(relays),
    relays,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifyHealth unit tests
// ---------------------------------------------------------------------------

describe("classifyHealth", () => {
  test("returns 'responded' for reachable relay", () => {
    const result = makeCheckResult({ reachable: true });
    expect(classifyHealth(result)).toBe("responded");
  });

  test("returns 'timed_out' for timeout error", () => {
    const result = makeCheckResult({
      reachable: false,
      latencyMs: null,
      error: "Timeout after 5000ms",
    });
    expect(classifyHealth(result)).toBe("timed_out");
  });

  test("returns 'timed_out' for ETIMEDOUT error", () => {
    const result = makeCheckResult({
      reachable: false,
      latencyMs: null,
      error: "ETIMEDOUT",
    });
    expect(classifyHealth(result)).toBe("timed_out");
  });

  test("returns 'error' for connection failure", () => {
    const result = makeCheckResult({
      reachable: false,
      latencyMs: null,
      error: "Connection failed",
    });
    expect(classifyHealth(result)).toBe("error");
  });

  test("returns 'error' for ECONNREFUSED", () => {
    const result = makeCheckResult({
      reachable: false,
      latencyMs: null,
      error: "ECONNREFUSED",
    });
    expect(classifyHealth(result)).toBe("error");
  });

  test("returns 'error' for ECONNRESET", () => {
    const result = makeCheckResult({
      reachable: false,
      latencyMs: null,
      error: "ECONNRESET",
    });
    expect(classifyHealth(result)).toBe("error");
  });

  test("returns 'error' for DNS failure", () => {
    const result = makeCheckResult({
      reachable: false,
      latencyMs: null,
      error: "EAI_AGAIN",
    });
    expect(classifyHealth(result)).toBe("error");
  });

  test("returns 'error' for null error on unreachable relay", () => {
    const result = makeCheckResult({
      reachable: false,
      latencyMs: null,
      error: null,
    });
    expect(classifyHealth(result)).toBe("error");
  });

  test("returns 'error' for unexpected close", () => {
    const result = makeCheckResult({
      reachable: false,
      latencyMs: null,
      error: "Connection closed before open (code: 1006)",
    });
    expect(classifyHealth(result)).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// toHealthResult unit tests
// ---------------------------------------------------------------------------

describe("toHealthResult", () => {
  test("converts reachable check result to health result", () => {
    const check = makeCheckResult({ url: "wss://ok.com", reachable: true, latencyMs: 100, retriesUsed: 0 });
    const health = toHealthResult(check);
    expect(health.url).toBe("wss://ok.com");
    expect(health.status).toBe("responded");
    expect(health.latencyMs).toBe(100);
    expect(health.error).toBeNull();
    expect(health.retriesUsed).toBe(0);
  });

  test("converts timed out check result to health result", () => {
    const check = makeCheckResult({
      url: "wss://slow.com",
      reachable: false,
      latencyMs: null,
      error: "Timeout after 5000ms",
      retriesUsed: 2,
    });
    const health = toHealthResult(check);
    expect(health.status).toBe("timed_out");
    expect(health.error).toBe("Timeout after 5000ms");
    expect(health.retriesUsed).toBe(2);
  });

  test("converts errored check result to health result", () => {
    const check = makeCheckResult({
      url: "wss://bad.com",
      reachable: false,
      latencyMs: null,
      error: "ECONNREFUSED",
      retriesUsed: 1,
    });
    const health = toHealthResult(check);
    expect(health.status).toBe("error");
    expect(health.error).toBe("ECONNREFUSED");
  });

  test("preserves all fields from check result", () => {
    const check = makeCheckResult({
      url: "wss://test.com",
      reachable: true,
      latencyMs: 77,
      error: null,
      retriesUsed: 1,
    });
    const health = toHealthResult(check);
    expect(health).toEqual({
      url: "wss://test.com",
      status: "responded",
      latencyMs: 77,
      error: null,
      retriesUsed: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// computeSummary unit tests
// ---------------------------------------------------------------------------

describe("computeSummary", () => {
  test("counts responded, timedOut, errored correctly", () => {
    const results: RelayHealthResult[] = [
      makeHealthResult({ status: "responded" }),
      makeHealthResult({ status: "responded" }),
      makeHealthResult({ status: "timed_out", latencyMs: null }),
      makeHealthResult({ status: "error", latencyMs: null }),
    ];
    const summary = computeSummary(results);
    expect(summary.total).toBe(4);
    expect(summary.responded).toBe(2);
    expect(summary.timedOut).toBe(1);
    expect(summary.errored).toBe(1);
  });

  test("computes latency stats for responded relays", () => {
    const results: RelayHealthResult[] = [
      makeHealthResult({ status: "responded", latencyMs: 100 }),
      makeHealthResult({ status: "responded", latencyMs: 200 }),
      makeHealthResult({ status: "responded", latencyMs: 300 }),
    ];
    const summary = computeSummary(results);
    expect(summary.avgLatencyMs).toBe(200);
    expect(summary.minLatencyMs).toBe(100);
    expect(summary.maxLatencyMs).toBe(300);
  });

  test("returns null latency stats when no relays responded", () => {
    const results: RelayHealthResult[] = [
      makeHealthResult({ status: "timed_out", latencyMs: null }),
      makeHealthResult({ status: "error", latencyMs: null }),
    ];
    const summary = computeSummary(results);
    expect(summary.avgLatencyMs).toBeNull();
    expect(summary.minLatencyMs).toBeNull();
    expect(summary.maxLatencyMs).toBeNull();
  });

  test("handles empty results array", () => {
    const summary = computeSummary([]);
    expect(summary.total).toBe(0);
    expect(summary.responded).toBe(0);
    expect(summary.timedOut).toBe(0);
    expect(summary.errored).toBe(0);
    expect(summary.avgLatencyMs).toBeNull();
    expect(summary.minLatencyMs).toBeNull();
    expect(summary.maxLatencyMs).toBeNull();
  });

  test("rounds average latency to nearest integer", () => {
    const results: RelayHealthResult[] = [
      makeHealthResult({ status: "responded", latencyMs: 10 }),
      makeHealthResult({ status: "responded", latencyMs: 15 }),
    ];
    const summary = computeSummary(results);
    // (10 + 15) / 2 = 12.5, rounded to 13
    expect(summary.avgLatencyMs).toBe(13);
  });

  test("handles single relay", () => {
    const results: RelayHealthResult[] = [
      makeHealthResult({ status: "responded", latencyMs: 42 }),
    ];
    const summary = computeSummary(results);
    expect(summary.total).toBe(1);
    expect(summary.responded).toBe(1);
    expect(summary.timedOut).toBe(0);
    expect(summary.errored).toBe(0);
    expect(summary.avgLatencyMs).toBe(42);
    expect(summary.minLatencyMs).toBe(42);
    expect(summary.maxLatencyMs).toBe(42);
  });

  test("all timed out produces correct counts", () => {
    const results: RelayHealthResult[] = [
      makeHealthResult({ status: "timed_out", latencyMs: null }),
      makeHealthResult({ status: "timed_out", latencyMs: null }),
    ];
    const summary = computeSummary(results);
    expect(summary.total).toBe(2);
    expect(summary.responded).toBe(0);
    expect(summary.timedOut).toBe(2);
    expect(summary.errored).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateHealthReport unit tests
// ---------------------------------------------------------------------------

describe("generateHealthReport", () => {
  test("returns report with correct structure", async () => {
    const report = await generateHealthReport(
      ["wss://localhost:19999"],
      1000,
      "/test/relays.json"
    );
    expect(report).toHaveProperty("timestamp");
    expect(report).toHaveProperty("configPath");
    expect(report).toHaveProperty("timeoutMs");
    expect(report).toHaveProperty("durationMs");
    expect(report).toHaveProperty("summary");
    expect(report).toHaveProperty("relays");
  }, 15000);

  test("summary has all required fields", async () => {
    const report = await generateHealthReport([], 1000, "/test.json");
    const { summary } = report;
    expect(summary).toHaveProperty("total");
    expect(summary).toHaveProperty("responded");
    expect(summary).toHaveProperty("timedOut");
    expect(summary).toHaveProperty("errored");
    expect(summary).toHaveProperty("avgLatencyMs");
    expect(summary).toHaveProperty("minLatencyMs");
    expect(summary).toHaveProperty("maxLatencyMs");
  });

  test("classifies unreachable relays as error or timed_out", async () => {
    const report = await generateHealthReport(
      ["wss://localhost:19999"],
      1000,
      "/test.json"
    );
    expect(report.relays).toHaveLength(1);
    expect(report.relays[0].status).not.toBe("responded");
    // Should be either "timed_out" or "error" depending on local port behavior
    expect(["timed_out", "error"]).toContain(report.relays[0].status);
  }, 15000);

  test("configPath and timeoutMs are passed through", async () => {
    const report = await generateHealthReport([], 7500, "/my/config.json");
    expect(report.configPath).toBe("/my/config.json");
    expect(report.timeoutMs).toBe(7500);
  });

  test("durationMs is non-negative", async () => {
    const report = await generateHealthReport([], 1000, "/test.json");
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("handles empty relay list", async () => {
    const report = await generateHealthReport([], 1000, "/test.json");
    expect(report.summary.total).toBe(0);
    expect(report.relays).toHaveLength(0);
  });

  test("timestamp is valid ISO string", async () => {
    const report = await generateHealthReport([], 1000, "/test.json");
    expect(() => new Date(report.timestamp)).not.toThrow();
    expect(new Date(report.timestamp).toISOString()).toBe(report.timestamp);
  });

  test("each relay result has a valid status", async () => {
    const report = await generateHealthReport(
      ["wss://localhost:19998", "wss://localhost:19999"],
      1000,
      "/test.json"
    );
    const validStatuses: RelayHealthStatus[] = ["responded", "timed_out", "error"];
    for (const r of report.relays) {
      expect(validStatuses).toContain(r.status);
    }
  }, 15000);
});

// ---------------------------------------------------------------------------
// formatHealthMarkdown unit tests
// ---------------------------------------------------------------------------

describe("formatHealthMarkdown", () => {
  test("includes report header with date", () => {
    const md = formatHealthMarkdown(makeReport());
    expect(md).toContain("# Relay Health Report — 2026-02-08");
  });

  test("includes configuration section", () => {
    const md = formatHealthMarkdown(makeReport());
    expect(md).toContain("## Configuration");
    expect(md).toContain("`/fake/relays.json`");
    expect(md).toContain("5000ms");
  });

  test("includes summary table", () => {
    const md = formatHealthMarkdown(makeReport());
    expect(md).toContain("## Summary");
    expect(md).toContain("| Responded | 1 |");
    expect(md).toContain("| Timed Out | 1 |");
    expect(md).toContain("| Errored | 1 |");
  });

  test("includes success rate", () => {
    const md = formatHealthMarkdown(makeReport());
    expect(md).toContain("Success Rate");
    expect(md).toContain("33%");
  });

  test("includes relay details table with all relays", () => {
    const md = formatHealthMarkdown(makeReport());
    expect(md).toContain("## Relay Details");
    expect(md).toContain("wss://good.example.com");
    expect(md).toContain("wss://slow.example.com");
    expect(md).toContain("wss://bad.example.com");
    expect(md).toContain("| OK |");
    expect(md).toContain("| TIMEOUT |");
    expect(md).toContain("| ERROR |");
  });

  test("includes latency stats when available", () => {
    const md = formatHealthMarkdown(makeReport());
    expect(md).toContain("Avg Latency");
    expect(md).toContain("50ms");
  });

  test("includes timed out relays in issues section", () => {
    const md = formatHealthMarkdown(makeReport());
    expect(md).toContain("### Timed Out");
    expect(md).toContain("wss://slow.example.com");
  });

  test("includes errored relays in issues section", () => {
    const md = formatHealthMarkdown(makeReport());
    expect(md).toContain("### Errors");
    expect(md).toContain("wss://bad.example.com: Connection failed");
  });

  test("shows no issues when all responded", () => {
    const relays = [
      makeHealthResult({ url: "wss://a.com", status: "responded", latencyMs: 10 }),
      makeHealthResult({ url: "wss://b.com", status: "responded", latencyMs: 20 }),
    ];
    const report = makeReport({
      relays,
      summary: computeSummary(relays),
    });
    const md = formatHealthMarkdown(report);
    expect(md).toContain("No issues — all relays responded successfully.");
  });

  test("includes duration", () => {
    const md = formatHealthMarkdown(makeReport());
    expect(md).toContain("## Duration");
    expect(md).toContain("1234ms");
  });

  test("handles zero relays without dividing by zero", () => {
    const report = makeReport({
      relays: [],
      summary: computeSummary([]),
    });
    const md = formatHealthMarkdown(report);
    expect(md).toContain("Success Rate | 0%");
  });

  test("does not include latency stats when no relays responded", () => {
    const relays = [
      makeHealthResult({ status: "error", latencyMs: null }),
    ];
    const report = makeReport({
      relays,
      summary: computeSummary(relays),
    });
    const md = formatHealthMarkdown(report);
    expect(md).not.toContain("Avg Latency");
  });
});

// ---------------------------------------------------------------------------
// getHealthLogFileName unit tests
// ---------------------------------------------------------------------------

describe("getHealthLogFileName", () => {
  test("generates correct file name from ISO timestamp", () => {
    expect(getHealthLogFileName("2026-02-08T12:00:00.000Z")).toBe(
      "2026-02-08-devops-relay-health-report.md"
    );
  });

  test("uses date portion only", () => {
    const name = getHealthLogFileName("2026-12-25T23:59:59.999Z");
    expect(name).toBe("2026-12-25-devops-relay-health-report.md");
    expect(name).not.toContain("T");
    expect(name).not.toContain("23:59");
  });

  test("ends with .md extension", () => {
    expect(getHealthLogFileName("2026-01-01T00:00:00.000Z")).toMatch(/\.md$/);
  });
});

// ---------------------------------------------------------------------------
// writeHealthLogFile unit tests
// ---------------------------------------------------------------------------

describe("writeHealthLogFile", () => {
  const tmpBase = resolve(tmpdir(), "relay-health-test-" + Date.now());

  test("creates log directory if missing", () => {
    const logDir = resolve(tmpBase, "new-dir");
    expect(existsSync(logDir)).toBe(false);
    writeHealthLogFile(logDir, makeReport());
    expect(existsSync(logDir)).toBe(true);
    rmSync(logDir, { recursive: true, force: true });
  });

  test("writes a markdown file with correct name", () => {
    const logDir = resolve(tmpBase, "write-test");
    const filePath = writeHealthLogFile(logDir, makeReport());
    expect(filePath).toMatch(/2026-02-08-devops-relay-health-report\.md$/);
    expect(existsSync(filePath)).toBe(true);
    rmSync(logDir, { recursive: true, force: true });
  });

  test("file contains valid markdown content", () => {
    const logDir = resolve(tmpBase, "content-test");
    const filePath = writeHealthLogFile(logDir, makeReport());
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("# Relay Health Report");
    expect(content).toContain("## Configuration");
    expect(content).toContain("## Summary");
    expect(content).toContain("## Relay Details");
    expect(content).toContain("## Issues");
    expect(content).toContain("## Duration");
    rmSync(logDir, { recursive: true, force: true });
  });

  test("returns absolute path to log file", () => {
    const logDir = resolve(tmpBase, "path-test");
    const filePath = writeHealthLogFile(logDir, makeReport());
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
// Integration: test actual relay health reporting
// ---------------------------------------------------------------------------

describe("relay health report (live)", () => {
  const config = loadRelayConfig(RELAYS_JSON);

  test(
    "at least 50% of configured relays respond",
    async () => {
      const report = await generateHealthReport(
        config.relays,
        config.timeout_ms,
        RELAYS_JSON
      );

      console.log(
        `\n  Live health: ${report.summary.responded} responded, ` +
          `${report.summary.timedOut} timed out, ` +
          `${report.summary.errored} errored ` +
          `(${report.durationMs}ms)`
      );
      for (const r of report.relays) {
        const detail =
          r.status === "responded"
            ? `${r.latencyMs}ms`
            : r.error || "unknown";
        console.log(`    [${r.status.toUpperCase()}] ${r.url} (${detail})`);
      }

      const minRequired = Math.ceil(config.relays.length * 0.5);
      expect(report.summary.responded).toBeGreaterThanOrEqual(minRequired);
    },
    config.timeout_ms + 10000
  );

  test(
    "every relay has a classified status",
    async () => {
      const report = await generateHealthReport(
        config.relays,
        config.timeout_ms,
        RELAYS_JSON
      );

      const validStatuses: RelayHealthStatus[] = ["responded", "timed_out", "error"];
      for (const r of report.relays) {
        expect(validStatuses).toContain(r.status);
      }

      // Counts should add up
      const { summary } = report;
      expect(summary.responded + summary.timedOut + summary.errored).toBe(summary.total);
    },
    config.timeout_ms + 10000
  );

  test(
    "log file can be generated from live results",
    async () => {
      const report = await generateHealthReport(
        config.relays,
        config.timeout_ms,
        RELAYS_JSON
      );

      const tmpDir = resolve(tmpdir(), "relay-health-live-" + Date.now());
      const logPath = writeHealthLogFile(tmpDir, report);

      expect(existsSync(logPath)).toBe(true);
      const content = readFileSync(logPath, "utf-8");
      expect(content).toContain("# Relay Health Report");

      // Every relay should appear in the log
      for (const relay of config.relays) {
        expect(content).toContain(relay);
      }

      rmSync(tmpDir, { recursive: true, force: true });
    },
    config.timeout_ms + 10000
  );
});
