#!/usr/bin/env bun
/**
 * Relay Connectivity Validator
 *
 * Reads relays from scripts/marketing/relays.json and attempts a WebSocket
 * connection to each one. Reports which relays are reachable and which are not.
 *
 * Usage:
 *   bun run scripts/marketing/validate-relays.ts [--timeout <ms>] [--json]
 *
 * Options:
 *   --timeout <ms>   Connection timeout in milliseconds (default: from relays.json)
 *   --json           Output results as JSON instead of human-readable text
 *
 * Exit codes:
 *   0 - All relays reachable
 *   1 - One or more relays unreachable
 */

import { resolve, dirname } from "path";
import { existsSync, readFileSync } from "fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelayConfig {
  relays: string[];
  timeout_ms: number;
  description?: string;
}

export interface RelayCheckResult {
  url: string;
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
  /** Number of retry attempts before the final result (0 = succeeded on first try). */
  retriesUsed: number;
}

/** Maximum number of retries per relay for transient connection failures. */
export const MAX_RETRIES = 2;

/** Delay in ms between retry attempts. */
export const RETRY_DELAY_MS = 500;

export interface ValidationReport {
  timestamp: string;
  totalRelays: number;
  reachable: number;
  unreachable: number;
  results: RelayCheckResult[];
}

// ---------------------------------------------------------------------------
// Configuration loading
// ---------------------------------------------------------------------------

export function loadRelayConfig(configPath: string): RelayConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Relay config not found at: ${configPath}`);
  }

  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as RelayConfig;

  if (!Array.isArray(config.relays)) {
    throw new Error("Invalid relay config: 'relays' must be an array");
  }

  if (typeof config.timeout_ms !== "number" || config.timeout_ms <= 0) {
    throw new Error("Invalid relay config: 'timeout_ms' must be a positive number");
  }

  for (const relay of config.relays) {
    if (typeof relay !== "string" || !relay.startsWith("wss://")) {
      throw new Error(`Invalid relay URL: ${relay} (must start with wss://)`);
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// Single relay connectivity check (one attempt, no retries)
// ---------------------------------------------------------------------------

export interface SingleCheckResult {
  url: string;
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
}

function checkRelaySingle(url: string, timeoutMs: number): Promise<SingleCheckResult> {
  return new Promise((resolvePromise) => {
    const startTime = Date.now();
    let resolved = false;
    let opened = false;

    const finish = (reachable: boolean, error: string | null) => {
      if (resolved) return;
      resolved = true;
      resolvePromise({
        url,
        reachable,
        latencyMs: reachable ? Date.now() - startTime : null,
        error,
      });
    };

    try {
      const ws = new WebSocket(url);

      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          // ignore
        }
        finish(false, `Timeout after ${timeoutMs}ms`);
      }, timeoutMs);

      ws.addEventListener("open", () => {
        opened = true;
        // Send a minimal Nostr REQ to verify the relay speaks Nostr.
        // We request an impossible filter (limit 0) so we get an EOSE quickly.
        const subId = "relay-check";
        try {
          ws.send(JSON.stringify(["REQ", subId, { limit: 1, since: Math.floor(Date.now() / 1000) + 86400 }]));
        } catch {
          // If send fails the relay is not functional
          clearTimeout(timer);
          finish(false, "Failed to send REQ");
        }
      });

      ws.addEventListener("message", (msgEvent) => {
        // Any valid Nostr message (EOSE, NOTICE, EVENT, etc.) means the relay is alive
        try {
          const data = JSON.parse(
            typeof msgEvent.data === "string"
              ? msgEvent.data
              : msgEvent.data.toString()
          );
          if (Array.isArray(data) && typeof data[0] === "string") {
            clearTimeout(timer);
            try {
              ws.close();
            } catch {
              // ignore
            }
            finish(true, null);
          }
        } catch {
          // Not valid JSON — ignore
        }
      });

      ws.addEventListener("error", (event) => {
        clearTimeout(timer);
        const errorMsg = event instanceof ErrorEvent ? event.message : "Connection failed";
        try {
          ws.close();
        } catch {
          // ignore
        }
        finish(false, errorMsg);
      });

      ws.addEventListener("close", (event) => {
        clearTimeout(timer);
        if (!resolved) {
          // If we opened successfully but closed before getting a message,
          // the relay accepted our connection — consider it reachable.
          if (opened) {
            finish(true, null);
          } else {
            finish(false, `Connection closed before open (code: ${event.code})`);
          }
        }
      });
    } catch (err) {
      finish(false, err instanceof Error ? err.message : String(err));
    }
  });
}

// ---------------------------------------------------------------------------
// Retry-aware relay connectivity check
// ---------------------------------------------------------------------------

/**
 * Determines whether a failed check result represents a transient error
 * that is worth retrying (timeouts, connection failures, unexpected closes).
 */
export function isTransientError(result: SingleCheckResult): boolean {
  if (result.reachable) return false;
  const err = result.error ?? "";
  // Transient: timeouts, generic connection failures, unexpected close
  return (
    err.includes("Timeout") ||
    err.includes("Connection failed") ||
    err.includes("Failed to connect") ||
    err.includes("Connection closed before open") ||
    err.includes("ECONNREFUSED") ||
    err.includes("ECONNRESET") ||
    err.includes("ETIMEDOUT") ||
    err.includes("EAI_AGAIN")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Checks a relay with automatic retries for transient failures.
 * Retries up to MAX_RETRIES times (default 2) before returning the final result.
 */
export async function checkRelay(
  url: string,
  timeoutMs: number,
  maxRetries: number = MAX_RETRIES,
  retryDelayMs: number = RETRY_DELAY_MS
): Promise<RelayCheckResult> {
  let lastResult: SingleCheckResult | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await delay(retryDelayMs);
    }

    lastResult = await checkRelaySingle(url, timeoutMs);

    if (lastResult.reachable || !isTransientError(lastResult)) {
      return { ...lastResult, retriesUsed: attempt };
    }
  }

  // All retries exhausted — return the last failure
  return { ...lastResult!, retriesUsed: maxRetries };
}

// ---------------------------------------------------------------------------
// Validate all relays
// ---------------------------------------------------------------------------

export async function validateRelays(
  relays: string[],
  timeoutMs: number
): Promise<ValidationReport> {
  const results = await Promise.all(
    relays.map((url) => checkRelay(url, timeoutMs))
  );

  const reachable = results.filter((r) => r.reachable).length;

  return {
    timestamp: new Date().toISOString(),
    totalRelays: relays.length,
    reachable,
    unreachable: relays.length - reachable,
    results,
  };
}

// ---------------------------------------------------------------------------
// CLI output
// ---------------------------------------------------------------------------

function printReport(report: ValidationReport): void {
  console.log("=== Relay Connectivity Report ===\n");
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Total:     ${report.totalRelays}`);
  console.log(`Reachable: ${report.reachable}`);
  console.log(`Failed:    ${report.unreachable}\n`);

  for (const result of report.results) {
    const status = result.reachable ? "OK" : "FAIL";
    const detail = result.reachable
      ? `${result.latencyMs}ms`
      : result.error || "unknown error";
    console.log(`  [${status}] ${result.url} (${detail})`);
  }

  console.log("");
  if (report.unreachable > 0) {
    console.log(
      `WARNING: ${report.unreachable} relay(s) unreachable. Consider removing or replacing them.`
    );
  } else {
    console.log("All relays are reachable.");
  }
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let timeoutOverride: number | undefined;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--timeout" && args[i + 1]) {
      timeoutOverride = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--json") {
      jsonOutput = true;
    }
  }

  return { timeoutOverride, jsonOutput };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function getDefaultConfigPath(): string {
  return resolve(
    dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
    "relays.json"
  );
}

async function main() {
  const { timeoutOverride, jsonOutput } = parseArgs();

  const configPath = getDefaultConfigPath();
  const config = loadRelayConfig(configPath);

  const timeoutMs = timeoutOverride ?? config.timeout_ms;

  if (!jsonOutput) {
    console.log(`Loaded ${config.relays.length} relays from ${configPath}`);
    console.log(`Timeout: ${timeoutMs}ms\n`);
    console.log("Checking connectivity...\n");
  }

  const report = await validateRelays(config.relays, timeoutMs);

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  process.exit(report.unreachable > 0 ? 1 : 0);
}

// Only run main when executed directly (not imported)
const scriptPath = import.meta.url.replace("file:///", "").replace(/\//g, "\\");
const isMainModule =
  typeof Bun !== "undefined" &&
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(scriptPath);

if (isMainModule) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
