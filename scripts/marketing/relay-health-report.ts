#!/usr/bin/env bun
/**
 * Relay Health Report
 *
 * Tracks which relays responded, timed out, or errored. Builds on the
 * existing relay validation infrastructure to produce a structured health
 * report with per-relay status classification and aggregate statistics.
 *
 * Usage:
 *   bun run scripts/marketing/relay-health-report.ts [--timeout <ms>] [--json] [--log-dir <path>]
 *
 * Options:
 *   --timeout <ms>    Connection timeout in milliseconds (default: from relays.json)
 *   --json            Output results as JSON to stdout
 *   --log-dir <path>  Directory for log output (default: <repo-root>/logs)
 *
 * Exit codes:
 *   0 - All relays responded
 *   1 - One or more relays timed out or errored
 */

import { resolve, dirname } from "path";
import { mkdirSync, writeFileSync } from "fs";
import {
  loadRelayConfig,
  checkRelay,
  getDefaultConfigPath,
  type RelayCheckResult,
} from "./validate-relays";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Health status classification for a relay. */
export type RelayHealthStatus = "responded" | "timed_out" | "error";

/** Per-relay health result with classified status. */
export interface RelayHealthResult {
  url: string;
  status: RelayHealthStatus;
  latencyMs: number | null;
  error: string | null;
  retriesUsed: number;
}

/** Aggregate health statistics. */
export interface HealthSummary {
  total: number;
  responded: number;
  timedOut: number;
  errored: number;
  avgLatencyMs: number | null;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
}

/** Full health report. */
export interface RelayHealthReport {
  timestamp: string;
  configPath: string;
  timeoutMs: number;
  durationMs: number;
  summary: HealthSummary;
  relays: RelayHealthResult[];
}

// ---------------------------------------------------------------------------
// Status classification
// ---------------------------------------------------------------------------

/**
 * Classifies a relay check result into a health status.
 *
 * - "responded"  — relay was reachable and replied with a valid Nostr message
 * - "timed_out"  — relay did not respond within the timeout period
 * - "error"      — relay connection failed with a non-timeout error
 */
export function classifyHealth(result: RelayCheckResult): RelayHealthStatus {
  if (result.reachable) return "responded";
  const err = result.error ?? "";
  if (err.includes("Timeout") || err.includes("ETIMEDOUT")) return "timed_out";
  return "error";
}

/**
 * Converts a RelayCheckResult into a classified RelayHealthResult.
 */
export function toHealthResult(result: RelayCheckResult): RelayHealthResult {
  return {
    url: result.url,
    status: classifyHealth(result),
    latencyMs: result.latencyMs,
    error: result.error,
    retriesUsed: result.retriesUsed,
  };
}

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

/**
 * Computes aggregate health statistics from an array of health results.
 */
export function computeSummary(results: RelayHealthResult[]): HealthSummary {
  const responded = results.filter((r) => r.status === "responded").length;
  const timedOut = results.filter((r) => r.status === "timed_out").length;
  const errored = results.filter((r) => r.status === "error").length;

  const latencies = results
    .filter((r) => r.latencyMs !== null)
    .map((r) => r.latencyMs!);

  return {
    total: results.length,
    responded,
    timedOut,
    errored,
    avgLatencyMs:
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null,
    minLatencyMs: latencies.length > 0 ? Math.min(...latencies) : null,
    maxLatencyMs: latencies.length > 0 ? Math.max(...latencies) : null,
  };
}

// ---------------------------------------------------------------------------
// Core: generate a full health report
// ---------------------------------------------------------------------------

/**
 * Checks all relays and produces a classified health report.
 */
export async function generateHealthReport(
  relays: string[],
  timeoutMs: number,
  configPath: string
): Promise<RelayHealthReport> {
  const startTime = Date.now();

  const checkResults = await Promise.all(
    relays.map((url) => checkRelay(url, timeoutMs))
  );

  const healthResults = checkResults.map(toHealthResult);
  const durationMs = Date.now() - startTime;

  return {
    timestamp: new Date().toISOString(),
    configPath,
    timeoutMs,
    durationMs,
    summary: computeSummary(healthResults),
    relays: healthResults,
  };
}

// ---------------------------------------------------------------------------
// Markdown report formatting
// ---------------------------------------------------------------------------

/**
 * Formats a health report as Markdown for log output.
 */
export function formatHealthMarkdown(report: RelayHealthReport): string {
  const date = report.timestamp.split("T")[0];
  const { summary } = report;

  const statusIcon = (s: RelayHealthStatus): string => {
    switch (s) {
      case "responded":
        return "OK";
      case "timed_out":
        return "TIMEOUT";
      case "error":
        return "ERROR";
    }
  };

  const lines: string[] = [
    `# Relay Health Report — ${date}`,
    "",
    "## Configuration",
    "",
    `- **Config:** \`${report.configPath}\``,
    `- **Timeout:** ${report.timeoutMs}ms`,
    `- **Relays checked:** ${summary.total}`,
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Responded | ${summary.responded} |`,
    `| Timed Out | ${summary.timedOut} |`,
    `| Errored | ${summary.errored} |`,
    `| Success Rate | ${summary.total > 0 ? Math.round((summary.responded / summary.total) * 100) : 0}% |`,
  ];

  if (summary.avgLatencyMs !== null) {
    lines.push(
      `| Avg Latency | ${summary.avgLatencyMs}ms |`,
      `| Min Latency | ${summary.minLatencyMs}ms |`,
      `| Max Latency | ${summary.maxLatencyMs}ms |`
    );
  }

  lines.push(
    "",
    "## Relay Details",
    "",
    "| Relay | Status | Latency | Retries | Error |",
    "|-------|--------|---------|---------|-------|"
  );

  for (const r of report.relays) {
    const latency = r.latencyMs !== null ? `${r.latencyMs}ms` : "—";
    const error = r.error ?? "—";
    lines.push(
      `| ${r.url} | ${statusIcon(r.status)} | ${latency} | ${r.retriesUsed} | ${error} |`
    );
  }

  // Timed-out relays section
  const timedOut = report.relays.filter((r) => r.status === "timed_out");
  const errored = report.relays.filter((r) => r.status === "error");

  lines.push("", "## Issues", "");

  if (timedOut.length > 0) {
    lines.push("### Timed Out", "");
    for (const r of timedOut) {
      lines.push(`- ${r.url} (${r.retriesUsed} retries)`);
    }
    lines.push("");
  }

  if (errored.length > 0) {
    lines.push("### Errors", "");
    for (const r of errored) {
      lines.push(`- ${r.url}: ${r.error ?? "unknown error"}`);
    }
    lines.push("");
  }

  if (timedOut.length === 0 && errored.length === 0) {
    lines.push("No issues — all relays responded successfully.", "");
  }

  lines.push("## Duration", `${report.durationMs}ms`, "");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Log file output
// ---------------------------------------------------------------------------

export function getHealthLogFileName(timestamp: string): string {
  const date = timestamp.split("T")[0];
  return `${date}-devops-relay-health-report.md`;
}

export function writeHealthLogFile(
  logDir: string,
  report: RelayHealthReport
): string {
  mkdirSync(logDir, { recursive: true });
  const fileName = getHealthLogFileName(report.timestamp);
  const filePath = resolve(logDir, fileName);
  const content = formatHealthMarkdown(report);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

export function getDefaultLogDir(): string {
  return resolve(
    dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
    "../../logs"
  );
}

// ---------------------------------------------------------------------------
// CLI output
// ---------------------------------------------------------------------------

function printReport(report: RelayHealthReport): void {
  const { summary } = report;

  console.log("=== Relay Health Report ===\n");
  console.log(`Timestamp:  ${report.timestamp}`);
  console.log(`Responded:  ${summary.responded}`);
  console.log(`Timed Out:  ${summary.timedOut}`);
  console.log(`Errored:    ${summary.errored}`);
  console.log(`Duration:   ${report.durationMs}ms`);

  if (summary.avgLatencyMs !== null) {
    console.log(
      `Latency:    avg=${summary.avgLatencyMs}ms min=${summary.minLatencyMs}ms max=${summary.maxLatencyMs}ms`
    );
  }

  console.log("");

  for (const r of report.relays) {
    const tag =
      r.status === "responded"
        ? "OK"
        : r.status === "timed_out"
          ? "TIMEOUT"
          : "ERROR";
    const detail =
      r.status === "responded"
        ? `${r.latencyMs}ms`
        : r.error || "unknown";
    const retryNote = r.retriesUsed > 0 ? ` [${r.retriesUsed} retries]` : "";
    console.log(`  [${tag}] ${r.url} (${detail})${retryNote}`);
  }

  console.log("");
  if (summary.timedOut > 0 || summary.errored > 0) {
    console.log(
      `WARNING: ${summary.timedOut} timed out, ${summary.errored} errored.`
    );
  } else {
    console.log("All relays responded successfully.");
  }
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let timeoutOverride: number | undefined;
  let jsonOutput = false;
  let logDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--timeout" && args[i + 1]) {
      timeoutOverride = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--json") {
      jsonOutput = true;
    } else if (args[i] === "--log-dir" && args[i + 1]) {
      logDir = args[i + 1];
      i++;
    }
  }

  return { timeoutOverride, jsonOutput, logDir };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { timeoutOverride, jsonOutput, logDir } = parseArgs();

  const configPath = getDefaultConfigPath();
  const config = loadRelayConfig(configPath);
  const timeoutMs = timeoutOverride ?? config.timeout_ms;

  if (!jsonOutput) {
    console.log(`Loaded ${config.relays.length} relays from ${configPath}`);
    console.log(`Timeout: ${timeoutMs}ms\n`);
    console.log("Checking relay health...\n");
  }

  const report = await generateHealthReport(config.relays, timeoutMs, configPath);

  // Write log file
  const targetLogDir = logDir ?? getDefaultLogDir();
  const logPath = writeHealthLogFile(targetLogDir, report);

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
    console.log(`\nLog written to: ${logPath}`);
  }

  process.exit(summary(report) > 0 ? 1 : 0);
}

function summary(report: RelayHealthReport): number {
  return report.summary.timedOut + report.summary.errored;
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
