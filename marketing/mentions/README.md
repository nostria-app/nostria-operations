# Nostria Mentions

This directory contains Nostr mention scan results for the Nostria project.

## File Format

Each scan produces two files:

- `YYYY-MM-DD-nostria-mentions.json` — Raw event data for programmatic use
- `YYYY-MM-DD-nostria-mentions.md` — Human-readable report

## What Gets Captured

The scanner looks for Nostr events matching:

1. **t-tag**: Events with hashtag `#nostria` (tag type `t`, value `nostria`)
2. **p-tag**: Events tagging the official Nostria pubkey
3. **Content**: Events mentioning "nostria" in the content body (bonus signal)

## Running the Scanner

```bash
bun run scripts/marketing/nostr-mention-scanner.ts
```

Options:
- `--since <days>` — How far back to search (default: 30)
- `--limit <n>` — Max events per relay per filter (default: 500)
- `--output <dir>` — Output directory (default: marketing/mentions)
