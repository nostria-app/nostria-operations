#!/usr/bin/env bun
/**
 * Nostr Mention Scanner for Nostria Marketing Agent
 *
 * Connects to multiple Nostr relays, retrieves events where:
 *   1. "nostria" appears as a tag (t-tag / hashtag)
 *   2. The official Nostria account is tagged (p-tag)
 *
 * Results are deduplicated, saved as JSON + Markdown to marketing/mentions/
 *
 * Usage:
 *   bun run scripts/marketing/nostr-mention-scanner.ts [--since <days>] [--limit <n>]
 *
 * Options:
 *   --since <days>   How many days back to search (default: 30)
 *   --limit <n>      Max events per relay per filter (default: 500)
 *   --output <dir>   Output directory (default: marketing/mentions)
 */

import { resolve, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { NoticeCollector, handleNotice } from "./relay-notice";

// ---------------------------------------------------------------------------
// Nostr npub -> hex conversion (bech32 decode)
// ---------------------------------------------------------------------------

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Decode(str: string): { prefix: string; words: number[] } {
  const lower = str.toLowerCase();
  const sepIdx = lower.lastIndexOf("1");
  if (sepIdx < 1) throw new Error("Invalid bech32: no separator");

  const prefix = lower.slice(0, sepIdx);
  const dataPart = lower.slice(sepIdx + 1);

  const words: number[] = [];
  for (const ch of dataPart.slice(0, -6)) {
    const idx = BECH32_CHARSET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid bech32 character: ${ch}`);
    words.push(idx);
  }
  return { prefix, words };
}

function convertBits(
  data: number[],
  fromBits: number,
  toBits: number,
  pad: boolean
): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;

  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }

  if (pad && bits > 0) {
    ret.push((acc << (toBits - bits)) & maxv);
  }

  return ret;
}

export function npubToHex(npub: string): string {
  const { prefix, words } = bech32Decode(npub);
  if (prefix !== "npub") throw new Error(`Expected npub prefix, got: ${prefix}`);
  const bytes = convertBits(words, 5, 8, false);
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const NOSTRIA_NPUB =
  "npub16x7nxvehx0wvgy0sa6ynkw9c2ghuph3z0ll5t8veq3xwm8n9tqds6ka44x";
export const NOSTRIA_HEX = npubToHex(NOSTRIA_NPUB);

interface RelayConfig {
  relays: string[];
  timeout_ms: number;
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface ScanResult {
  event: NostrEvent;
  relay: string;
  match_type: ("t-tag" | "p-tag" | "content")[];
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let sinceDays = 30;
  let limit = 500;
  let outputDir = "marketing/mentions";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" && args[i + 1]) {
      sinceDays = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--output" && args[i + 1]) {
      outputDir = args[i + 1];
      i++;
    }
  }

  return { sinceDays, limit, outputDir };
}

// ---------------------------------------------------------------------------
// Relay communication
// ---------------------------------------------------------------------------

function queryRelay(
  relayUrl: string,
  filters: Record<string, unknown>[],
  timeoutMs: number,
  noticeCollector?: NoticeCollector
): Promise<NostrEvent[]> {
  return new Promise((resolvePromise) => {
    const events: NostrEvent[] = [];
    let resolved = false;

    const done = () => {
      if (!resolved) {
        resolved = true;
        resolvePromise(events);
      }
    };

    try {
      const ws = new WebSocket(relayUrl);

      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          // ignore
        }
        done();
      }, timeoutMs);

      let eoseCount = 0;
      const totalSubs = filters.length;

      ws.addEventListener("open", () => {
        for (let i = 0; i < filters.length; i++) {
          const subId = `nostria-scan-${i}`;
          const req = JSON.stringify(["REQ", subId, filters[i]]);
          ws.send(req);
        }
      });

      ws.addEventListener("message", (msgEvent) => {
        try {
          const data = JSON.parse(
            typeof msgEvent.data === "string"
              ? msgEvent.data
              : msgEvent.data.toString()
          );
          if (Array.isArray(data)) {
            // Log NOTICE messages for debugging
            if (noticeCollector) {
              handleNotice(data, relayUrl, noticeCollector);
            }
            if (data[0] === "EVENT" && data[2]) {
              events.push(data[2] as NostrEvent);
            } else if (data[0] === "EOSE") {
              eoseCount++;
              if (eoseCount >= totalSubs) {
                clearTimeout(timer);
                try {
                  ws.close();
                } catch {
                  // ignore
                }
                done();
              }
            }
          }
        } catch {
          // ignore parse errors
        }
      });

      ws.addEventListener("error", () => {
        clearTimeout(timer);
        done();
      });

      ws.addEventListener("close", () => {
        clearTimeout(timer);
        done();
      });
    } catch {
      done();
    }
  });
}

// ---------------------------------------------------------------------------
// Filter construction
// ---------------------------------------------------------------------------

/**
 * Build NIP-01 REQ filters for scanning Nostria mentions.
 *
 * Filter 1: Events with t-tag matching "nostria" (includes common case variants
 *           since NIP-01 tag matching is case-sensitive on the relay side).
 * Filter 2: Events with p-tag pointing to Nostria's pubkey.
 *
 * Client-side classification (classifyEvent) performs full case-insensitive
 * matching as a second pass, so any events that slip through with unusual
 * casing will still be correctly classified.
 */
export function buildScanFilters(
  sinceTimestamp: number,
  limit: number,
  nostriaHex: string
): Record<string, unknown>[] {
  return [
    { "#t": ["nostria", "Nostria", "NOSTRIA"], since: sinceTimestamp, limit },
    { "#p": [nostriaHex], since: sinceTimestamp, limit },
  ];
}

// ---------------------------------------------------------------------------
// Event classification
// ---------------------------------------------------------------------------

export function classifyEvent(event: NostrEvent): ("t-tag" | "p-tag" | "content")[] {
  const matches: ("t-tag" | "p-tag" | "content")[] = [];

  for (const tag of event.tags) {
    if (
      tag[0] === "t" &&
      tag[1] &&
      tag[1].toLowerCase() === "nostria"
    ) {
      if (!matches.includes("t-tag")) matches.push("t-tag");
    }
    if (tag[0] === "p" && tag[1] && tag[1].toLowerCase() === NOSTRIA_HEX) {
      if (!matches.includes("p-tag")) matches.push("p-tag");
    }
  }

  // Also check content for "nostria" mentions as a bonus signal
  if (event.content && event.content.toLowerCase().includes("nostria")) {
    if (!matches.includes("content")) matches.push("content");
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Output generation
// ---------------------------------------------------------------------------

function eventToMarkdownRow(result: ScanResult): string {
  const date = new Date(result.event.created_at * 1000);
  const dateStr = date.toISOString().slice(0, 19).replace("T", " ");
  const shortPubkey = result.event.pubkey.slice(0, 8) + "...";
  const kindLabel = getKindLabel(result.event.kind);
  const contentPreview = result.event.content
    .replace(/\n/g, " ")
    .slice(0, 120)
    .trim();
  const matchTypes = result.match_type.join(", ");

  return `| ${dateStr} | ${shortPubkey} | ${kindLabel} (${result.event.kind}) | ${matchTypes} | ${contentPreview}${result.event.content.length > 120 ? "..." : ""} |`;
}

function getKindLabel(kind: number): string {
  const labels: Record<number, string> = {
    0: "Metadata",
    1: "Note",
    2: "Relay",
    3: "Contacts",
    4: "DM",
    5: "Delete",
    6: "Repost",
    7: "Reaction",
    16: "Repost",
    30023: "Article",
    30078: "App Data",
    1984: "Report",
    9735: "Zap Receipt",
    9734: "Zap Request",
    10002: "Relay List",
  };
  return labels[kind] || "Other";
}

function generateMarkdownReport(results: ScanResult[], sinceDays: number): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  // Sort by created_at descending (newest first)
  const sorted = [...results].sort(
    (a, b) => b.event.created_at - a.event.created_at
  );

  // Stats
  const uniquePubkeys = new Set(sorted.map((r) => r.event.pubkey));
  const kindCounts: Record<number, number> = {};
  const matchTypeCounts: Record<string, number> = { "t-tag": 0, "p-tag": 0, "content": 0 };

  for (const r of sorted) {
    kindCounts[r.event.kind] = (kindCounts[r.event.kind] || 0) + 1;
    for (const mt of r.match_type) {
      matchTypeCounts[mt]++;
    }
  }

  let md = `# Nostria Mention Scan Report\n\n`;
  md += `**Generated:** ${now.toISOString()}\n`;
  md += `**Period:** Last ${sinceDays} days\n`;
  md += `**Total events found:** ${sorted.length}\n`;
  md += `**Unique authors:** ${uniquePubkeys.size}\n\n`;

  md += `## Match Summary\n\n`;
  md += `| Match Type | Count |\n`;
  md += `|-----------|-------|\n`;
  md += `| t-tag (hashtag #nostria) | ${matchTypeCounts["t-tag"]} |\n`;
  md += `| p-tag (Nostria account tagged) | ${matchTypeCounts["p-tag"]} |\n`;
  md += `| Content mention | ${matchTypeCounts["content"]} |\n\n`;

  md += `## Event Kinds\n\n`;
  md += `| Kind | Label | Count |\n`;
  md += `|------|-------|-------|\n`;
  for (const [kind, count] of Object.entries(kindCounts).sort(
    (a, b) => Number(b[1]) - Number(a[1])
  )) {
    md += `| ${kind} | ${getKindLabel(Number(kind))} | ${count} |\n`;
  }
  md += `\n`;

  md += `## Events\n\n`;
  md += `| Date | Author | Kind | Match | Content Preview |\n`;
  md += `|------|--------|------|-------|----------------|\n`;

  for (const result of sorted) {
    md += eventToMarkdownRow(result) + "\n";
  }

  md += `\n---\n\n`;
  md += `*Scanned ${dateStr} by the Nostria Marketing Agent mention scanner.*\n`;
  md += `*Nostria official pubkey (hex): \`${NOSTRIA_HEX}\`*\n`;

  return md;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { sinceDays, limit, outputDir } = parseArgs();

  console.log("=== Nostria Mention Scanner ===");
  console.log(`Nostria npub: ${NOSTRIA_NPUB}`);
  console.log(`Nostria hex:  ${NOSTRIA_HEX}`);
  console.log(`Looking back: ${sinceDays} days`);
  console.log(`Limit/relay:  ${limit}`);
  console.log(`Output dir:   ${outputDir}`);
  console.log("");

  // Load relay config
  const configPath = resolve(
    dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
    "relays.json"
  );

  if (!existsSync(configPath)) {
    console.error(`Relay config not found at: ${configPath}`);
    process.exit(1);
  }

  const relayConfig: RelayConfig = JSON.parse(
    readFileSync(configPath, "utf-8")
  );

  console.log(`Loaded ${relayConfig.relays.length} relays from config`);
  console.log("");

  const sinceTimestamp = Math.floor(Date.now() / 1000) - sinceDays * 86400;

  // Build filters using the shared helper
  const filters = buildScanFilters(sinceTimestamp, limit, NOSTRIA_HEX);

  // Query all relays concurrently
  const allResults: ScanResult[] = [];
  const seenIds = new Set<string>();
  const relayStats: { relay: string; events: number; error: boolean }[] = [];

  console.log("Connecting to relays...\n");

  const noticeCollector = new NoticeCollector();

  const relayPromises = relayConfig.relays.map(async (relayUrl) => {
    const startTime = Date.now();
    try {
      console.log(`  -> ${relayUrl} ...`);
      const events = await queryRelay(relayUrl, filters, relayConfig.timeout_ms, noticeCollector);
      const elapsed = Date.now() - startTime;

      let newCount = 0;
      for (const event of events) {
        const matchTypes = classifyEvent(event);
        if (matchTypes.length === 0) continue; // shouldn't happen, but guard

        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          allResults.push({ event, relay: relayUrl, match_type: matchTypes });
          newCount++;
        }
      }

      console.log(
        `  <- ${relayUrl}: ${events.length} events (${newCount} new) [${elapsed}ms]`
      );
      relayStats.push({ relay: relayUrl, events: events.length, error: false });
    } catch (err) {
      const elapsed = Date.now() - startTime;
      console.log(`  !! ${relayUrl}: error [${elapsed}ms]`);
      relayStats.push({ relay: relayUrl, events: 0, error: true });
    }
  });

  await Promise.all(relayPromises);

  console.log(`\nTotal unique events: ${allResults.length}`);
  console.log(
    `Relays contacted: ${relayStats.length} (${relayStats.filter((r) => !r.error).length} successful)\n`
  );

  if (noticeCollector.count > 0) {
    console.log(`Relay NOTICE messages (${noticeCollector.count}):`);
    for (const n of noticeCollector.getAll()) {
      console.log(`  [${n.relay}] ${n.message}`);
    }
    console.log("");
  }

  if (allResults.length === 0) {
    console.log("No events found. Nothing to save.");
    return;
  }

  // Ensure output directory exists
  const absOutputDir = resolve(process.cwd(), outputDir);
  if (!existsSync(absOutputDir)) {
    mkdirSync(absOutputDir, { recursive: true });
    console.log(`Created output directory: ${absOutputDir}`);
  }

  const dateStamp = new Date().toISOString().slice(0, 10);

  // Save JSON
  const jsonFilename = `${dateStamp}-nostria-mentions.json`;
  const jsonPath = resolve(absOutputDir, jsonFilename);

  const jsonOutput = {
    scan_date: new Date().toISOString(),
    since_days: sinceDays,
    nostria_npub: NOSTRIA_NPUB,
    nostria_hex: NOSTRIA_HEX,
    total_events: allResults.length,
    relay_stats: relayStats,
    events: allResults.map((r) => ({
      id: r.event.id,
      pubkey: r.event.pubkey,
      created_at: r.event.created_at,
      kind: r.event.kind,
      tags: r.event.tags,
      content: r.event.content,
      sig: r.event.sig,
      source_relay: r.relay,
      match_type: r.match_type,
    })),
  };

  writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2), "utf-8");
  console.log(`Saved JSON:     ${jsonPath}`);

  // Save Markdown report
  const mdFilename = `${dateStamp}-nostria-mentions.md`;
  const mdPath = resolve(absOutputDir, mdFilename);

  const markdownReport = generateMarkdownReport(allResults, sinceDays);
  writeFileSync(mdPath, markdownReport, "utf-8");
  console.log(`Saved Markdown: ${mdPath}`);

  // Print summary
  console.log("\n=== Scan Complete ===");
  console.log(`Events:  ${allResults.length}`);
  console.log(`JSON:    ${jsonFilename}`);
  console.log(`Report:  ${mdFilename}`);
}

// Only run main() when executed directly (not when imported by tests)
if (import.meta.path === Bun.main) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
