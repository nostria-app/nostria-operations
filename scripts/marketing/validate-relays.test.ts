import { describe, expect, test, mock } from "bun:test";
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { tmpdir } from "os";
import {
  loadRelayConfig,
  checkRelay,
  validateRelays,
  getDefaultConfigPath,
  type RelayConfig,
  type RelayCheckResult,
  type ValidationReport,
} from "./validate-relays";

const ROOT = resolve(import.meta.dir, "../..");
const RELAYS_JSON = resolve(import.meta.dir, "relays.json");

// ---------------------------------------------------------------------------
// relays.json structure tests (unit, no network)
// ---------------------------------------------------------------------------

describe("relays.json", () => {
  test("file exists", () => {
    expect(existsSync(RELAYS_JSON)).toBe(true);
  });

  test("is valid JSON", () => {
    const raw = readFileSync(RELAYS_JSON, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test("has required fields", () => {
    const config = JSON.parse(readFileSync(RELAYS_JSON, "utf-8"));
    expect(config).toHaveProperty("relays");
    expect(config).toHaveProperty("timeout_ms");
    expect(Array.isArray(config.relays)).toBe(true);
    expect(typeof config.timeout_ms).toBe("number");
  });

  test("relays array is non-empty", () => {
    const config = JSON.parse(readFileSync(RELAYS_JSON, "utf-8"));
    expect(config.relays.length).toBeGreaterThan(0);
  });

  test("all relay URLs use wss:// protocol", () => {
    const config = JSON.parse(readFileSync(RELAYS_JSON, "utf-8"));
    for (const relay of config.relays) {
      expect(relay).toMatch(/^wss:\/\//);
    }
  });

  test("no duplicate relay URLs", () => {
    const config = JSON.parse(readFileSync(RELAYS_JSON, "utf-8"));
    const unique = new Set(config.relays);
    expect(unique.size).toBe(config.relays.length);
  });

  test("timeout_ms is a reasonable value", () => {
    const config = JSON.parse(readFileSync(RELAYS_JSON, "utf-8"));
    expect(config.timeout_ms).toBeGreaterThanOrEqual(1000);
    expect(config.timeout_ms).toBeLessThanOrEqual(60000);
  });

  test("relay URLs are well-formed", () => {
    const config = JSON.parse(readFileSync(RELAYS_JSON, "utf-8"));
    for (const relay of config.relays) {
      expect(() => new URL(relay)).not.toThrow();
      const url = new URL(relay);
      expect(url.protocol).toBe("wss:");
      expect(url.hostname.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// loadRelayConfig unit tests
// ---------------------------------------------------------------------------

describe("loadRelayConfig", () => {
  const tmpBase = resolve(tmpdir(), "validate-relays-test-" + Date.now());

  test("loads valid config from relays.json", () => {
    const config = loadRelayConfig(RELAYS_JSON);
    expect(config.relays.length).toBeGreaterThan(0);
    expect(config.timeout_ms).toBeGreaterThan(0);
  });

  test("throws on missing file", () => {
    expect(() => loadRelayConfig("/nonexistent/path.json")).toThrow(
      "Relay config not found"
    );
  });

  test("throws on missing relays array", () => {
    const dir = resolve(tmpBase, "no-relays");
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, "bad.json");
    writeFileSync(path, JSON.stringify({ timeout_ms: 5000 }));
    expect(() => loadRelayConfig(path)).toThrow("'relays' must be an array");
    rmSync(dir, { recursive: true, force: true });
  });

  test("throws on invalid timeout_ms", () => {
    const dir = resolve(tmpBase, "bad-timeout");
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, "bad.json");
    writeFileSync(
      path,
      JSON.stringify({ relays: ["wss://example.com"], timeout_ms: -1 })
    );
    expect(() => loadRelayConfig(path)).toThrow(
      "'timeout_ms' must be a positive number"
    );
    rmSync(dir, { recursive: true, force: true });
  });

  test("throws on invalid relay URL (not wss://)", () => {
    const dir = resolve(tmpBase, "bad-url");
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, "bad.json");
    writeFileSync(
      path,
      JSON.stringify({
        relays: ["http://not-a-relay.com"],
        timeout_ms: 5000,
      })
    );
    expect(() => loadRelayConfig(path)).toThrow("must start with wss://");
    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// checkRelay unit tests (using a local mock is impractical for WebSocket,
// so we test with a known-bad URL and verify the failure path)
// ---------------------------------------------------------------------------

describe("checkRelay", () => {
  test("returns failure for unreachable host", async () => {
    const result = await checkRelay("wss://localhost:19999", 2000);
    expect(result.url).toBe("wss://localhost:19999");
    expect(result.reachable).toBe(false);
    expect(result.latencyMs).toBeNull();
    expect(result.error).toBeTruthy();
  }, 5000);

  test("returns failure on timeout for non-responding host", async () => {
    // Use a very short timeout to force a timeout scenario
    const result = await checkRelay("wss://192.0.2.1:443", 500);
    expect(result.reachable).toBe(false);
    expect(result.error).toBeTruthy();
  }, 5000);

  test("result has correct shape", async () => {
    const result = await checkRelay("wss://localhost:19999", 1000);
    expect(result).toHaveProperty("url");
    expect(result).toHaveProperty("reachable");
    expect(result).toHaveProperty("latencyMs");
    expect(result).toHaveProperty("error");
  }, 5000);
});

// ---------------------------------------------------------------------------
// validateRelays unit tests
// ---------------------------------------------------------------------------

describe("validateRelays", () => {
  test("returns report with correct structure", async () => {
    const report = await validateRelays(["wss://localhost:19999"], 1000);
    expect(report).toHaveProperty("timestamp");
    expect(report).toHaveProperty("totalRelays");
    expect(report).toHaveProperty("reachable");
    expect(report).toHaveProperty("unreachable");
    expect(report).toHaveProperty("results");
    expect(report.totalRelays).toBe(1);
    expect(report.results).toHaveLength(1);
  }, 5000);

  test("counts reachable and unreachable correctly", async () => {
    const report = await validateRelays(
      ["wss://localhost:19998", "wss://localhost:19999"],
      1000
    );
    expect(report.totalRelays).toBe(2);
    expect(report.reachable + report.unreachable).toBe(2);
    // Both should be unreachable (localhost ports not listening)
    expect(report.unreachable).toBe(2);
    expect(report.reachable).toBe(0);
  }, 5000);

  test("handles empty relay list", async () => {
    const report = await validateRelays([], 1000);
    expect(report.totalRelays).toBe(0);
    expect(report.reachable).toBe(0);
    expect(report.unreachable).toBe(0);
    expect(report.results).toHaveLength(0);
  });

  test("timestamp is valid ISO string", async () => {
    const report = await validateRelays([], 1000);
    expect(() => new Date(report.timestamp)).not.toThrow();
    expect(new Date(report.timestamp).toISOString()).toBe(report.timestamp);
  });
});

// ---------------------------------------------------------------------------
// Integration: validate the actual relays.json entries are reachable
// ---------------------------------------------------------------------------

describe("relay connectivity (live)", () => {
  const config = loadRelayConfig(RELAYS_JSON);

  test(
    "at least 50% of configured relays are reachable",
    async () => {
      const report = await validateRelays(config.relays, config.timeout_ms);

      console.log(
        `\n  Live check: ${report.reachable}/${report.totalRelays} reachable`
      );
      for (const r of report.results) {
        const status = r.reachable ? "OK" : "FAIL";
        const detail = r.reachable
          ? `${r.latencyMs}ms`
          : r.error || "unknown";
        console.log(`    [${status}] ${r.url} (${detail})`);
      }

      // At least half the relays should be reachable to pass
      const minRequired = Math.ceil(config.relays.length * 0.5);
      expect(report.reachable).toBeGreaterThanOrEqual(minRequired);
    },
    config.timeout_ms + 10000 // test timeout = relay timeout + 10s buffer
  );

  test(
    "each individual relay is checked",
    async () => {
      const report = await validateRelays(config.relays, config.timeout_ms);

      // Every configured relay should have a result entry
      const checkedUrls = report.results.map((r) => r.url);
      for (const relay of config.relays) {
        expect(checkedUrls).toContain(relay);
      }
    },
    config.timeout_ms + 10000
  );
});

// ---------------------------------------------------------------------------
// getDefaultConfigPath
// ---------------------------------------------------------------------------

describe("getDefaultConfigPath", () => {
  test("points to an existing file", () => {
    const configPath = getDefaultConfigPath();
    expect(existsSync(configPath)).toBe(true);
  });

  test("path ends with relays.json", () => {
    const configPath = getDefaultConfigPath();
    expect(configPath).toMatch(/relays\.json$/);
  });
});
