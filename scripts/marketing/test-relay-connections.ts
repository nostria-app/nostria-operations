#!/usr/bin/env bun
/**
 * WebSocket Relay Connection Tester
 *
 * Tests WebSocket connections to every relay in relays.json and writes
 * structured results to a log file in the /logs/ directory.
 *
 * Usage:
 *   bun run scripts/marketing/test-relay-connections.ts [--timeout <ms>] [--json] [--log-dir <path>]
 *
 * Options:
 *   --timeout <ms>    Connection timeout in milliseconds (default: from relays.json)
 *   --json            Output results as JSON to stdout
 *   --log-dir <path>  Directory for log output (default: <repo-root>/logs)
 *
 * Exit codes:
 *   0 - All relays reachable
 *   1 - One or more relays unreachable
 */

import { resolve, dirname } from "path";
import { mkdirSync, writeFileSync } from "fs";
import {
  loadRelayConfig,
  checkRelay,
  getDefaultConfigPath,
  type RelayCheckResult,
  type ValidationReport,
} from "./validate-relays";
import { NoticeCollector } from "./relay-notice";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectionTestReport extends ValidationReport {
  configPath: string;
  timeoutMs: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Core: test all relay connections
// ---------------------------------------------------------------------------

export async function testRelayConnections(
  relays: string[],
  timeoutMs: number,
  configPath: string
): Promise<ConnectionTestReport> {
  const startTime = Date.now();

  const noticeCollector = new NoticeCollector();
  const results = await Promise.all(
    relays.map((url) => checkRelay(url, timeoutMs, undefined, undefined, noticeCollector))
  );

  const reachable = results.filter((r) => r.reachable).length;
  const durationMs = Date.now() - startTime;

  return {
    timestamp: new Date().toISOString(),
    totalRelays: relays.length,
    reachable,
    unreachable: relays.length - reachable,
    results,
    notices: noticeCollector.getAll(),
    configPath,
    timeoutMs,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Log file generation
// ---------------------------------------------------------------------------

export function formatLogMarkdown(report: ConnectionTestReport): string {
  const date = report.timestamp.split("T")[0];
  const lines: string[] = [
    `# Agent Log: DevOps — ${date}`,
    "",
    "## Task",
    "Test WebSocket connections to every relay in relays.json",
    "",
    "## Actions Taken",
    `1. Loaded ${report.totalRelays} relays from \`${report.configPath}\``,
    `2. Tested each relay with a ${report.timeoutMs}ms timeout`,
    `3. Sent Nostr REQ to verify protocol compliance`,
    "",
    "## Results",
    "",
    `| Relay | Status | Latency | Retries | Detail |`,
    `|-------|--------|---------|---------|--------|`,
  ];

  for (const r of report.results) {
    const status = r.reachable ? "OK" : "FAIL";
    const latency = r.latencyMs !== null ? `${r.latencyMs}ms` : "—";
    const retries = r.retriesUsed > 0 ? String(r.retriesUsed) : "0";
    const detail = r.error ?? "—";
    lines.push(`| ${r.url} | ${status} | ${latency} | ${retries} | ${detail} |`);
  }

  lines.push(
    "",
    "## Summary",
    "",
    `- **Total:** ${report.totalRelays}`,
    `- **Reachable:** ${report.reachable}`,
    `- **Unreachable:** ${report.unreachable}`,
    `- **Success rate:** ${report.totalRelays > 0 ? Math.round((report.reachable / report.totalRelays) * 100) : 0}%`,
    "",
    "## Issues Found",
    ""
  );

  const failed = report.results.filter((r) => !r.reachable);
  if (failed.length > 0) {
    for (const r of failed) {
      lines.push(`- ${r.url}: ${r.error ?? "unknown error"}`);
    }
  } else {
    lines.push("- None — all relays responded successfully");
  }

  lines.push(
    "",
    "## Duration",
    `${report.durationMs}ms`,
    ""
  );

  return lines.join("\n");
}

export function getLogFileName(timestamp: string): string {
  const date = timestamp.split("T")[0];
  return `${date}-devops-relay-connection-test.md`;
}

export function writeLogFile(logDir: string, report: ConnectionTestReport): string {
  mkdirSync(logDir, { recursive: true });
  const fileName = getLogFileName(report.timestamp);
  const filePath = resolve(logDir, fileName);
  const content = formatLogMarkdown(report);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// CLI output
// ---------------------------------------------------------------------------

function printReport(report: ConnectionTestReport): void {
  console.log("=== WebSocket Relay Connection Test ===\n");
  console.log(`Timestamp:  ${report.timestamp}`);
  console.log(`Total:      ${report.totalRelays}`);
  console.log(`Reachable:  ${report.reachable}`);
  console.log(`Failed:     ${report.unreachable}`);
  console.log(`Duration:   ${report.durationMs}ms\n`);

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
      `WARNING: ${report.unreachable} relay(s) unreachable.`
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

export function getDefaultLogDir(): string {
  return resolve(
    dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
    "../../logs"
  );
}

async function main() {
  const { timeoutOverride, jsonOutput, logDir } = parseArgs();

  const configPath = getDefaultConfigPath();
  const config = loadRelayConfig(configPath);
  const timeoutMs = timeoutOverride ?? config.timeout_ms;

  if (!jsonOutput) {
    console.log(`Loaded ${config.relays.length} relays from ${configPath}`);
    console.log(`Timeout: ${timeoutMs}ms\n`);
    console.log("Testing WebSocket connections...\n");
  }

  const report = await testRelayConnections(config.relays, timeoutMs, configPath);

  // Write log file
  const targetLogDir = logDir ?? getDefaultLogDir();
  const logPath = writeLogFile(targetLogDir, report);

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
    console.log(`\nLog written to: ${logPath}`);
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
