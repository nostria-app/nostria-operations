import { describe, expect, test } from "bun:test";
import {
  classifyEvent,
  buildScanFilters,
  npubToHex,
  extractReferencedEvents,
  countUniqueAuthors,
  NOSTRIA_HEX,
  NOSTRIA_NPUB,
  type NostrEvent,
  type ReferencedEvent,
  type ScanResult,
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

/** Create a minimal ScanResult for testing. */
function makeScanResult(overrides: Partial<NostrEvent> = {}, relay = "wss://relay.example.com"): ScanResult {
  return {
    event: makeEvent(overrides),
    relay,
    match_type: ["t-tag"],
    referenced_events: [],
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

// ---------------------------------------------------------------------------
// extractReferencedEvents — e-tag extraction (NIP-10)
// ---------------------------------------------------------------------------

const VALID_EVENT_ID =
  "a".repeat(64);
const VALID_EVENT_ID_2 =
  "b".repeat(64);
const VALID_EVENT_ID_3 =
  "c".repeat(64);

describe("extractReferencedEvents — basic extraction", () => {
  test("extracts a single e-tag with no relay or marker", () => {
    const event = makeEvent({ tags: [["e", VALID_EVENT_ID]] });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe(VALID_EVENT_ID);
    expect(result[0].relayUrl).toBe("");
    expect(result[0].marker).toBe("");
  });

  test("extracts e-tag with relay URL but no marker", () => {
    const event = makeEvent({
      tags: [["e", VALID_EVENT_ID, "wss://relay.example.com"]],
    });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe(VALID_EVENT_ID);
    expect(result[0].relayUrl).toBe("wss://relay.example.com");
    expect(result[0].marker).toBe("");
  });

  test("extracts e-tag with relay URL and root marker", () => {
    const event = makeEvent({
      tags: [["e", VALID_EVENT_ID, "wss://relay.example.com", "root"]],
    });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(1);
    expect(result[0].marker).toBe("root");
  });

  test("extracts e-tag with reply marker", () => {
    const event = makeEvent({
      tags: [["e", VALID_EVENT_ID, "wss://relay.example.com", "reply"]],
    });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(1);
    expect(result[0].marker).toBe("reply");
  });

  test("extracts e-tag with mention marker", () => {
    const event = makeEvent({
      tags: [["e", VALID_EVENT_ID, "wss://relay.example.com", "mention"]],
    });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(1);
    expect(result[0].marker).toBe("mention");
  });

  test("extracts multiple e-tags", () => {
    const event = makeEvent({
      tags: [
        ["e", VALID_EVENT_ID, "wss://relay.example.com", "root"],
        ["e", VALID_EVENT_ID_2, "wss://relay.example.com", "reply"],
        ["e", VALID_EVENT_ID_3, "", "mention"],
      ],
    });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(3);
    expect(result[0].marker).toBe("root");
    expect(result[1].marker).toBe("reply");
    expect(result[2].marker).toBe("mention");
  });

  test("returns empty array when no e-tags present", () => {
    const event = makeEvent({
      tags: [
        ["t", "nostria"],
        ["p", "somepubkey"],
      ],
    });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(0);
  });

  test("returns empty array for empty tags", () => {
    const event = makeEvent({ tags: [] });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(0);
  });
});

describe("extractReferencedEvents — marker case handling", () => {
  test("handles uppercase marker", () => {
    const event = makeEvent({
      tags: [["e", VALID_EVENT_ID, "", "ROOT"]],
    });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(1);
    expect(result[0].marker).toBe("root");
  });

  test("handles mixed-case marker", () => {
    const event = makeEvent({
      tags: [["e", VALID_EVENT_ID, "", "Reply"]],
    });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(1);
    expect(result[0].marker).toBe("reply");
  });

  test("treats unknown marker as empty string", () => {
    const event = makeEvent({
      tags: [["e", VALID_EVENT_ID, "", "unknown"]],
    });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(1);
    expect(result[0].marker).toBe("");
  });
});

describe("extractReferencedEvents — validation", () => {
  test("skips e-tag with missing event ID", () => {
    const event = makeEvent({ tags: [["e"]] });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(0);
  });

  test("skips e-tag with empty event ID", () => {
    const event = makeEvent({ tags: [["e", ""]] });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(0);
  });

  test("skips e-tag with invalid (non-hex) event ID", () => {
    const event = makeEvent({ tags: [["e", "not-a-valid-hex-id"]] });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(0);
  });

  test("skips e-tag with too-short hex event ID", () => {
    const event = makeEvent({ tags: [["e", "abcdef1234"]] });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(0);
  });

  test("skips e-tag with too-long hex event ID", () => {
    const event = makeEvent({ tags: [["e", "a".repeat(65)]] });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(0);
  });

  test("accepts uppercase hex event ID", () => {
    const uppercaseId = "A".repeat(64);
    const event = makeEvent({ tags: [["e", uppercaseId]] });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe(uppercaseId);
  });

  test("ignores non-e tags", () => {
    const event = makeEvent({
      tags: [
        ["p", VALID_EVENT_ID],
        ["t", "nostria"],
        ["r", "https://example.com"],
      ],
    });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(0);
  });
});

describe("extractReferencedEvents — mixed tags", () => {
  test("extracts e-tags while ignoring other tag types", () => {
    const event = makeEvent({
      tags: [
        ["e", VALID_EVENT_ID, "wss://relay.example.com", "root"],
        ["p", "somepubkey"],
        ["t", "nostria"],
        ["e", VALID_EVENT_ID_2, "", "reply"],
        ["r", "https://example.com"],
      ],
    });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(2);
    expect(result[0].eventId).toBe(VALID_EVENT_ID);
    expect(result[0].marker).toBe("root");
    expect(result[1].eventId).toBe(VALID_EVENT_ID_2);
    expect(result[1].marker).toBe("reply");
  });

  test("extracts valid e-tags and skips invalid ones", () => {
    const event = makeEvent({
      tags: [
        ["e", VALID_EVENT_ID, "", "root"],
        ["e", "invalid-id"],
        ["e", VALID_EVENT_ID_2, "", "reply"],
        ["e", ""],
      ],
    });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(2);
    expect(result[0].eventId).toBe(VALID_EVENT_ID);
    expect(result[1].eventId).toBe(VALID_EVENT_ID_2);
  });

  test("handles typical threaded reply event", () => {
    // A typical reply in NIP-10 has a root e-tag and a reply e-tag
    const event = makeEvent({
      tags: [
        ["e", VALID_EVENT_ID, "wss://relay.damus.io", "root"],
        ["e", VALID_EVENT_ID_2, "wss://nos.lol", "reply"],
        ["p", "somepubkey"],
        ["t", "nostria"],
      ],
      content: "I love Nostria!",
    });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(2);

    const root = result.find((r) => r.marker === "root");
    const reply = result.find((r) => r.marker === "reply");
    expect(root).toBeDefined();
    expect(root!.eventId).toBe(VALID_EVENT_ID);
    expect(root!.relayUrl).toBe("wss://relay.damus.io");
    expect(reply).toBeDefined();
    expect(reply!.eventId).toBe(VALID_EVENT_ID_2);
    expect(reply!.relayUrl).toBe("wss://nos.lol");
  });

  test("handles empty relay URL with marker", () => {
    const event = makeEvent({
      tags: [["e", VALID_EVENT_ID, "", "root"]],
    });
    const result = extractReferencedEvents(event);
    expect(result).toHaveLength(1);
    expect(result[0].relayUrl).toBe("");
    expect(result[0].marker).toBe("root");
  });
});

// ---------------------------------------------------------------------------
// countUniqueAuthors — community reach measurement
// ---------------------------------------------------------------------------

describe("countUniqueAuthors", () => {
  test("returns zero for empty results", () => {
    const result = countUniqueAuthors([]);
    expect(result.count).toBe(0);
    expect(result.pubkeys).toHaveLength(0);
  });

  test("counts a single author", () => {
    const results = [makeScanResult({ pubkey: "aaa111" })];
    const result = countUniqueAuthors(results);
    expect(result.count).toBe(1);
    expect(result.pubkeys).toEqual(["aaa111"]);
  });

  test("counts multiple unique authors", () => {
    const results = [
      makeScanResult({ pubkey: "author1" }),
      makeScanResult({ pubkey: "author2" }),
      makeScanResult({ pubkey: "author3" }),
    ];
    const result = countUniqueAuthors(results);
    expect(result.count).toBe(3);
    expect(result.pubkeys).toHaveLength(3);
    expect(result.pubkeys).toContain("author1");
    expect(result.pubkeys).toContain("author2");
    expect(result.pubkeys).toContain("author3");
  });

  test("deduplicates repeated authors", () => {
    const results = [
      makeScanResult({ pubkey: "author1" }),
      makeScanResult({ pubkey: "author1" }),
      makeScanResult({ pubkey: "author2" }),
      makeScanResult({ pubkey: "author1" }),
      makeScanResult({ pubkey: "author2" }),
    ];
    const result = countUniqueAuthors(results);
    expect(result.count).toBe(2);
    expect(result.pubkeys).toHaveLength(2);
    expect(result.pubkeys).toContain("author1");
    expect(result.pubkeys).toContain("author2");
  });

  test("treats all events from the same author as one unique author", () => {
    const samePubkey = "a".repeat(64);
    const results = [
      makeScanResult({ pubkey: samePubkey }),
      makeScanResult({ pubkey: samePubkey }),
      makeScanResult({ pubkey: samePubkey }),
    ];
    const result = countUniqueAuthors(results);
    expect(result.count).toBe(1);
    expect(result.pubkeys).toEqual([samePubkey]);
  });

  test("pubkeys are case-sensitive (hex pubkeys are always lowercase)", () => {
    // In Nostr, pubkeys are hex and should be consistent,
    // but countUniqueAuthors should not alter them
    const results = [
      makeScanResult({ pubkey: "aabbcc" }),
      makeScanResult({ pubkey: "AABBCC" }),
    ];
    const result = countUniqueAuthors(results);
    expect(result.count).toBe(2);
  });

  test("handles large number of unique authors", () => {
    const results = Array.from({ length: 100 }, (_, i) =>
      makeScanResult({ pubkey: `author_${i.toString().padStart(3, "0")}` })
    );
    const result = countUniqueAuthors(results);
    expect(result.count).toBe(100);
    expect(result.pubkeys).toHaveLength(100);
  });

  test("handles mix of unique and duplicate authors", () => {
    const results = [
      makeScanResult({ pubkey: "alice" }),
      makeScanResult({ pubkey: "bob" }),
      makeScanResult({ pubkey: "alice" }),
      makeScanResult({ pubkey: "charlie" }),
      makeScanResult({ pubkey: "bob" }),
      makeScanResult({ pubkey: "alice" }),
      makeScanResult({ pubkey: "dave" }),
    ];
    const result = countUniqueAuthors(results);
    expect(result.count).toBe(4);
    expect(result.pubkeys).toContain("alice");
    expect(result.pubkeys).toContain("bob");
    expect(result.pubkeys).toContain("charlie");
    expect(result.pubkeys).toContain("dave");
  });

  test("returns pubkeys array that is a new array (not shared reference)", () => {
    const results = [makeScanResult({ pubkey: "author1" })];
    const result1 = countUniqueAuthors(results);
    const result2 = countUniqueAuthors(results);
    expect(result1.pubkeys).not.toBe(result2.pubkeys);
    expect(result1.pubkeys).toEqual(result2.pubkeys);
  });

  test("works with events from different relays", () => {
    const results = [
      makeScanResult({ pubkey: "author1" }, "wss://relay1.example.com"),
      makeScanResult({ pubkey: "author1" }, "wss://relay2.example.com"),
      makeScanResult({ pubkey: "author2" }, "wss://relay1.example.com"),
    ];
    const result = countUniqueAuthors(results);
    expect(result.count).toBe(2);
  });
});
