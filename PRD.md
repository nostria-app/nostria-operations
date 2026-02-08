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

- [ ] Verify NIP-01 REQ filters work for `#t` tag with value `nostria` (case-insensitive)
- [ ] Verify NIP-01 REQ filters work for `#p` tag with Nostria hex pubkey
- [ ] Add support for scanning `content` field for "nostria" keyword mentions
- [ ] Implement proper event deduplication across relays (by event `id`)
- [ ] Validate event signatures before accepting (NIP-01 compliance)
- [ ] Add `--since` flag to control how many days back to scan (default: 30)
- [ ] Add `--limit` flag to cap events per relay per filter (default: 500)

## Event Parsing & Classification

- [ ] Classify each event with match types: `t-tag`, `p-tag`, `content`
- [ ] Extract and label event kinds (Note, Repost, Reaction, Zap, Article, etc.)
- [ ] Parse author pubkeys and resolve to npub format for display
- [ ] Extract referenced event IDs (e-tags) for threading context
- [ ] Count unique authors per scan to measure community reach

## Data Storage — JSON Output

- [ ] Save raw events to `marketing/mentions/YYYY-MM-DD-nostria-mentions.json`
- [ ] Include scan metadata: timestamp, relay stats, filter parameters
- [ ] Include per-event fields: id, pubkey, kind, tags, content, sig, source relay, match type
- [ ] Ensure JSON files are diffable (pretty-printed with 2-space indent)
- [ ] Add incremental mode: merge new events with existing JSON if same-day scan exists

## Data Storage — Markdown Report

- [ ] Generate `marketing/mentions/YYYY-MM-DD-nostria-mentions.md` summary report
- [ ] Include header stats: total events, unique authors, date range
- [ ] Include match type breakdown table (t-tag vs p-tag vs content)
- [ ] Include event kind distribution table
- [ ] Render events table with date, author, kind, match type, content preview
- [ ] Sort events by timestamp (newest first)

## Relay Configuration

- [ ] Maintain `scripts/marketing/relays.json` with well-known public relays
- [ ] Include Nostria's own relay (`wss://relay.nostria.app`)
- [ ] Add configurable timeout per relay (default: 15 seconds)
- [ ] Document how to add/remove relays in the config file

## Marketing Agent Integration

- [ ] Update `agents/marketing/config.yaml` to reference the mention scanner
- [ ] Add mention scanning to the marketing agent's system prompt responsibilities
- [ ] Create a summary template the marketing agent can use for engagement reports
- [ ] Add a `--output` flag so the marketing agent can specify custom output paths

## Automation & Scheduling

- [ ] Create a wrapper script or npm script (`bun run scan`) for easy execution
- [ ] Add GitHub Actions workflow to run the scanner on a schedule (weekly)
- [ ] Ensure the workflow commits results back to the repo automatically
- [ ] Add log entry generation to `/logs/` after each scan run

## Error Handling & Resilience

- [ ] Handle malformed JSON from relays gracefully
- [ ] Handle WebSocket connection timeouts without crashing
- [ ] Handle relays that send unexpected message types
- [ ] Add overall scan timeout (prevent infinite hangs)
- [ ] Log warnings for relays that return zero events (may indicate filter issues)

## Testing & Validation

- [ ] Run a test scan against 3 relays and verify JSON output structure
- [ ] Run a test scan and verify Markdown report renders correctly
- [ ] Verify deduplication works (same event from multiple relays counted once)
- [ ] Test with `--since 7` for a short-range scan
- [ ] Test with `--since 90` for a longer-range scan
- [ ] Verify the scanner works on both Windows and Linux (cross-platform paths)

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
