# Nostria Mention Scanner — PRD Task List

Ralphy will execute each unchecked task sequentially using your chosen AI engine.

## Overview

Build and maintain a Nostr relay mention scanner that discovers events referencing
Nostria (via `#nostria` t-tag, official p-tag, or content mention), saves structured
data to the repo, and generates human-readable reports for the marketing agent.

**Official Nostria npub:** `npub16x7nxvehx0wvgy0sa6ynkw9c2ghuph3z0ll5t8veq3xwm8n9tqds6ka44x`

---

## Project Setup

- [x] Verify Bun is installed and available on PATH (`bun --version`)
- [x] Create `tsconfig.json` with strict mode for the scripts directory
- [x] Validate that `scripts/marketing/relays.json` contains reachable relays (connect test)

## Core Scanner — Relay Connectivity

- [x] Test WebSocket connections to every relay in `relays.json` and log results
- [x] Add retry logic for transient relay connection failures (max 2 retries per relay)
- [x] Add relay health reporting: track which relays responded, timed out, or errored
- [x] Handle relay `NOTICE` messages and log them for debugging

## Core Scanner — Event Retrieval

- [x] Verify NIP-01 REQ filters work for `#t` tag with value `nostria` (case-insensitive)
- [x] Verify NIP-01 REQ filters work for `#p` tag with Nostria hex pubkey
- [x] Add support for scanning `content` field for "nostria" keyword mentions
- [x] Implement proper event deduplication across relays (by event `id`)
- [x] Add `--since` flag to control how many days back to scan (default: 30)
- [x] Add `--limit` flag to cap events per relay per filter (default: 500)

## Event Parsing & Classification

- [x] Classify each event with match types: `t-tag`, `p-tag`, `content`
- [x] Extract and label event kinds (Note, Repost, Reaction, Zap, Article, etc.)
- [x] Parse author pubkeys and resolve to npub format for display
- [x] Extract referenced event IDs (e-tags) for threading context
- [x] Count unique authors per scan to measure community reach

## Data Storage — JSON Output

- [x] Save raw events to `marketing/mentions/YYYY-MM-DD-nostria-mentions.json`
- [x] Include scan metadata: timestamp, relay stats, filter parameters
- [x] Include per-event fields: id, pubkey, kind, tags, content, sig, source relay, match type
- [x] Ensure JSON files are diffable (pretty-printed with 2-space indent)
- [ ] Add incremental mode: merge new events with existing JSON if same-day scan exists

## Data Storage — Markdown Report

- [x] Generate `marketing/mentions/YYYY-MM-DD-nostria-mentions.md` summary report
- [x] Include header stats: total events, unique authors, date range
- [x] Include match type breakdown table (t-tag vs p-tag vs content)
- [x] Include event kind distribution table
- [x] Render events table with date, author, kind, match type, content preview
- [x] Sort events by timestamp (newest first)

## Relay Configuration

- [x] Maintain `scripts/marketing/relays.json` with well-known public relays
- [x] Include Nostria's own relay (`wss://relay.nostria.app`)
- [x] Add configurable timeout per relay (default: 15 seconds)

## Marketing Agent Integration

- [x] Update `agents/marketing/config.yaml` to reference the mention scanner
- [x] Add mention scanning to the marketing agent's system prompt responsibilities
- [ ] Create a summary template the marketing agent can use for engagement reports
- [x] Add a `--output` flag so the marketing agent can specify custom output paths

## Automation & Scheduling

- [x] Create a wrapper script or npm script (`bun run scan`) for easy execution
- [ ] Add GitHub Actions workflow to run the scanner on a schedule (weekly)
- [ ] Ensure the workflow commits results back to the repo automatically
- [ ] Add log entry generation to `/logs/` after each scan run

## Error Handling & Resilience

- [ ] Handle malformed JSON from relays gracefully
- [ ] Handle WebSocket connection timeouts without crashing
- [ ] Handle relays that send unexpected message types
- [ ] Add overall scan timeout (prevent infinite hangs)
- [ ] Log warnings for relays that return zero events (may indicate filter issues)

---

## Usage

Run with Ralphy:

```bash
# Execute tasks from this PRD
ralphy --prd PRD.md

# Or run the scanner directly
bun run scripts/marketing/nostr-mention-scanner.ts

# With options
bun run scripts/marketing/nostr-mention-scanner.ts --since 7 --limit 100
```

## Notes

- Tasks are marked complete automatically when the AI agent finishes them
- Completed tasks show as `- [x] Task description`
- Tasks are executed in order from top to bottom
- The scanner uses raw WebSocket connections (no nostr-tools dependency) for minimal footprint
