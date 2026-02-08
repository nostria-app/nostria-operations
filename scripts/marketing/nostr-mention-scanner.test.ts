import { describe, expect, test } from "bun:test";
import {
  classifyEvent,
  buildScanFilters,
  npubToHex,
  NOSTRIA_HEX,
  NOSTRIA_NPUB,
  type NostrEvent,
} from "./nostr-mention-scanner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal NostrEvent for testing. */
function makeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "abc123",
    pubkey: "def456",
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags: [],
    content: "",
    sig: "sig000",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// npubToHex conversion
// ---------------------------------------------------------------------------

describe("npubToHex", () => {
  test("converts Nostria npub to a 64-char hex string", () => {
    const hex = npubToHex(NOSTRIA_NPUB);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  test("NOSTRIA_HEX matches npubToHex output", () => {
    expect(NOSTRIA_HEX).toBe(npubToHex(NOSTRIA_NPUB));
  });

  test("throws for invalid prefix", () => {
    expect(() => npubToHex("nsec1abcdef")).toThrow();
  });

  test("throws for malformed bech32", () => {
    expect(() => npubToHex("not-a-bech32-string")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildScanFilters — NIP-01 REQ filter structure
// ---------------------------------------------------------------------------

describe("buildScanFilters", () => {
  const since = 1700000000;
  const limit = 100;
  const hex = NOSTRIA_HEX;

  test("returns exactly two filters", () => {
    const filters = buildScanFilters(since, limit, hex);
    expect(filters).toHaveLength(2);
  });

  test("first filter targets #t tag", () => {
    const filters = buildScanFilters(since, limit, hex);
    const tFilter = filters[0];
    expect(tFilter).toHaveProperty("#t");
    expect(tFilter["#t"]).toBeInstanceOf(Array);
  });

  test("first filter includes case variants of 'nostria'", () => {
    const filters = buildScanFilters(since, limit, hex);
    const tValues = filters[0]["#t"] as string[];
    // Must include at least lowercase "nostria"
    expect(tValues).toContain("nostria");
    // Should also include common case variants
    expect(tValues).toContain("Nostria");
    expect(tValues).toContain("NOSTRIA");
  });

  test("first filter includes since and limit", () => {
    const filters = buildScanFilters(since, limit, hex);
    expect(filters[0].since).toBe(since);
    expect(filters[0].limit).toBe(limit);
  });

  test("second filter targets #p tag with Nostria hex pubkey", () => {
    const filters = buildScanFilters(since, limit, hex);
    const pFilter = filters[1];
    expect(pFilter).toHaveProperty("#p");
    const pValues = pFilter["#p"] as string[];
    expect(pValues).toContain(hex);
  });

  test("second filter includes since and limit", () => {
    const filters = buildScanFilters(since, limit, hex);
    expect(filters[1].since).toBe(since);
    expect(filters[1].limit).toBe(limit);
  });

  test("filter structure is valid NIP-01 JSON-serializable", () => {
    const filters = buildScanFilters(since, limit, hex);
    for (const f of filters) {
      const json = JSON.stringify(["REQ", "test-sub", f]);
      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed[0]).toBe("REQ");
      expect(parsed[1]).toBe("test-sub");
      expect(typeof parsed[2]).toBe("object");
    }
  });
});

// ---------------------------------------------------------------------------
// classifyEvent — #t tag matching (case-insensitive)
// ---------------------------------------------------------------------------

describe("classifyEvent — #t tag", () => {
  test('matches t-tag with lowercase "nostria"', () => {
    const event = makeEvent({ tags: [["t", "nostria"]] });
    const result = classifyEvent(event);
    expect(result).toContain("t-tag");
  });

  test('matches t-tag with capitalized "Nostria"', () => {
    const event = makeEvent({ tags: [["t", "Nostria"]] });
    const result = classifyEvent(event);
    expect(result).toContain("t-tag");
  });

  test('matches t-tag with uppercase "NOSTRIA"', () => {
    const event = makeEvent({ tags: [["t", "NOSTRIA"]] });
    const result = classifyEvent(event);
    expect(result).toContain("t-tag");
  });

  test('matches t-tag with mixed case "nOsTrIa"', () => {
    const event = makeEvent({ tags: [["t", "nOsTrIa"]] });
    const result = classifyEvent(event);
    expect(result).toContain("t-tag");
  });

  test('matches t-tag with "NoStRiA"', () => {
    const event = makeEvent({ tags: [["t", "NoStRiA"]] });
    const result = classifyEvent(event);
    expect(result).toContain("t-tag");
  });

  test("does not match unrelated t-tag", () => {
    const event = makeEvent({ tags: [["t", "bitcoin"]] });
    const result = classifyEvent(event);
    expect(result).not.toContain("t-tag");
  });

  test("does not match partial t-tag like 'nostria-app'", () => {
    const event = makeEvent({ tags: [["t", "nostria-app"]] });
    const result = classifyEvent(event);
    expect(result).not.toContain("t-tag");
  });

  test("does not match t-tag with leading/trailing whitespace", () => {
    const event = makeEvent({ tags: [["t", " nostria "]] });
    const result = classifyEvent(event);
    expect(result).not.toContain("t-tag");
  });

  test("deduplicates t-tag match when multiple t-tags match", () => {
    const event = makeEvent({
      tags: [
        ["t", "nostria"],
        ["t", "Nostria"],
        ["t", "NOSTRIA"],
      ],
    });
    const result = classifyEvent(event);
    const tTagCount = result.filter((m) => m === "t-tag").length;
    expect(tTagCount).toBe(1);
  });

  test("handles empty tags array", () => {
    const event = makeEvent({ tags: [] });
    const result = classifyEvent(event);
    expect(result).not.toContain("t-tag");
  });

  test("handles tag with missing value (only tag name)", () => {
    const event = makeEvent({ tags: [["t"]] });
    const result = classifyEvent(event);
    expect(result).not.toContain("t-tag");
  });

  test("handles tag with empty string value", () => {
    const event = makeEvent({ tags: [["t", ""]] });
    const result = classifyEvent(event);
    expect(result).not.toContain("t-tag");
  });
});

// ---------------------------------------------------------------------------
// classifyEvent — #p tag matching
// ---------------------------------------------------------------------------

describe("classifyEvent — #p tag", () => {
  test("matches p-tag with Nostria hex pubkey", () => {
    const event = makeEvent({ tags: [["p", NOSTRIA_HEX]] });
    const result = classifyEvent(event);
    expect(result).toContain("p-tag");
  });

  test("does not match p-tag with different pubkey", () => {
    const event = makeEvent({
      tags: [["p", "0000000000000000000000000000000000000000000000000000000000000000"]],
    });
    const result = classifyEvent(event);
    expect(result).not.toContain("p-tag");
  });

  test("does not match p-tag with empty value", () => {
    const event = makeEvent({ tags: [["p", ""]] });
    const result = classifyEvent(event);
    expect(result).not.toContain("p-tag");
  });
});

// ---------------------------------------------------------------------------
// classifyEvent — content matching
// ---------------------------------------------------------------------------

describe("classifyEvent — content", () => {
  test('matches content containing "nostria" (lowercase)', () => {
    const event = makeEvent({ content: "Check out nostria app!" });
    const result = classifyEvent(event);
    expect(result).toContain("content");
  });

  test('matches content containing "Nostria" (capitalized)', () => {
    const event = makeEvent({ content: "I love Nostria!" });
    const result = classifyEvent(event);
    expect(result).toContain("content");
  });

  test('matches content containing "NOSTRIA" (uppercase)', () => {
    const event = makeEvent({ content: "Try NOSTRIA today!" });
    const result = classifyEvent(event);
    expect(result).toContain("content");
  });

  test("does not match content without 'nostria'", () => {
    const event = makeEvent({ content: "Hello world" });
    const result = classifyEvent(event);
    expect(result).not.toContain("content");
  });

  test("handles empty content", () => {
    const event = makeEvent({ content: "" });
    const result = classifyEvent(event);
    expect(result).not.toContain("content");
  });
});

// ---------------------------------------------------------------------------
// classifyEvent — combined matching
// ---------------------------------------------------------------------------

describe("classifyEvent — combined", () => {
  test("returns multiple match types when both t-tag and content match", () => {
    const event = makeEvent({
      tags: [["t", "nostria"]],
      content: "Trying nostria app",
    });
    const result = classifyEvent(event);
    expect(result).toContain("t-tag");
    expect(result).toContain("content");
    expect(result).toHaveLength(2);
  });

  test("returns all three match types when t-tag, p-tag, and content match", () => {
    const event = makeEvent({
      tags: [
        ["t", "nostria"],
        ["p", NOSTRIA_HEX],
      ],
      content: "Nostria is great!",
    });
    const result = classifyEvent(event);
    expect(result).toContain("t-tag");
    expect(result).toContain("p-tag");
    expect(result).toContain("content");
    expect(result).toHaveLength(3);
  });

  test("returns empty array when nothing matches", () => {
    const event = makeEvent({
      tags: [["t", "bitcoin"]],
      content: "Hello world",
    });
    const result = classifyEvent(event);
    expect(result).toHaveLength(0);
  });

  test("handles event with many unrelated tags plus one matching t-tag", () => {
    const event = makeEvent({
      tags: [
        ["e", "someeventid"],
        ["p", "somepubkey"],
        ["t", "bitcoin"],
        ["t", "nostr"],
        ["t", "NOSTRIA"],
        ["r", "https://example.com"],
      ],
      content: "Various tags here",
    });
    const result = classifyEvent(event);
    expect(result).toContain("t-tag");
    expect(result).not.toContain("p-tag"); // different pubkey
  });
});

// ---------------------------------------------------------------------------
// NIP-01 REQ filter — relay-side #t behavior verification
// ---------------------------------------------------------------------------

describe("NIP-01 #t filter — case coverage", () => {
  test("REQ filter covers the three most common casings", () => {
    const filters = buildScanFilters(0, 100, NOSTRIA_HEX);
    const tValues = filters[0]["#t"] as string[];

    // The relay-side filter should include at least these variants
    // to maximize coverage since NIP-01 tag matching is case-sensitive
    const coveredCasings = ["nostria", "Nostria", "NOSTRIA"];
    for (const casing of coveredCasings) {
      expect(tValues).toContain(casing);
    }
  });

  test("classifyEvent catches any casing that relay filter might miss", () => {
    // Even if a relay returns an event with unusual casing that wasn't
    // in the REQ filter, classifyEvent's toLowerCase() catches it
    const unusualCasings = ["nOSTRIA", "nosTRIA", "NosTrIa", "noStria"];
    for (const casing of unusualCasings) {
      const event = makeEvent({ tags: [["t", casing]] });
      const result = classifyEvent(event);
      expect(result).toContain("t-tag");
    }
  });

  test("filter + classify together handle the full case-insensitive workflow", () => {
    // Simulate: relay returns events that matched the filter
    // Then classifyEvent re-validates them client-side
    const filters = buildScanFilters(1700000000, 100, NOSTRIA_HEX);
    const tValues = filters[0]["#t"] as string[];

    // For each value in the filter, classifyEvent should confirm the match
    for (const filterValue of tValues) {
      const event = makeEvent({ tags: [["t", filterValue]] });
      const result = classifyEvent(event);
      expect(result).toContain("t-tag");
    }
  });
});
