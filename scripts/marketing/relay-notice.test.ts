import { describe, expect, test, spyOn } from "bun:test";
import {
  isNoticeMessage,
  parseNotice,
  NoticeCollector,
  handleNotice,
  type RelayNotice,
} from "./relay-notice";

// ---------------------------------------------------------------------------
// isNoticeMessage unit tests
// ---------------------------------------------------------------------------

describe("isNoticeMessage", () => {
  test("returns true for valid NOTICE array", () => {
    expect(isNoticeMessage(["NOTICE", "hello"])).toBe(true);
  });

  test("returns true for NOTICE with empty message", () => {
    expect(isNoticeMessage(["NOTICE", ""])).toBe(true);
  });

  test("returns true for NOTICE with extra elements", () => {
    expect(isNoticeMessage(["NOTICE", "msg", "extra"])).toBe(true);
  });

  test("returns false for EVENT message", () => {
    expect(isNoticeMessage(["EVENT", "sub-id", {}])).toBe(false);
  });

  test("returns false for EOSE message", () => {
    expect(isNoticeMessage(["EOSE", "sub-id"])).toBe(false);
  });

  test("returns false for REQ message", () => {
    expect(isNoticeMessage(["REQ", "sub-id", {}])).toBe(false);
  });

  test("returns false for non-array", () => {
    expect(isNoticeMessage("NOTICE")).toBe(false);
    expect(isNoticeMessage(42)).toBe(false);
    expect(isNoticeMessage(null)).toBe(false);
    expect(isNoticeMessage(undefined)).toBe(false);
    expect(isNoticeMessage({})).toBe(false);
  });

  test("returns false for array with non-string second element", () => {
    expect(isNoticeMessage(["NOTICE", 42])).toBe(false);
    expect(isNoticeMessage(["NOTICE", null])).toBe(false);
    expect(isNoticeMessage(["NOTICE", undefined])).toBe(false);
    expect(isNoticeMessage(["NOTICE", {}])).toBe(false);
  });

  test("returns false for single-element array", () => {
    expect(isNoticeMessage(["NOTICE"])).toBe(false);
  });

  test("returns false for empty array", () => {
    expect(isNoticeMessage([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseNotice unit tests
// ---------------------------------------------------------------------------

describe("parseNotice", () => {
  test("returns message string for valid NOTICE", () => {
    expect(parseNotice(["NOTICE", "rate limited"])).toBe("rate limited");
  });

  test("returns empty string for NOTICE with empty message", () => {
    expect(parseNotice(["NOTICE", ""])).toBe("");
  });

  test("returns null for non-NOTICE data", () => {
    expect(parseNotice(["EVENT", "sub-id", {}])).toBeNull();
    expect(parseNotice(["EOSE", "sub-id"])).toBeNull();
  });

  test("returns null for non-array input", () => {
    expect(parseNotice("NOTICE")).toBeNull();
    expect(parseNotice(null)).toBeNull();
    expect(parseNotice(42)).toBeNull();
  });

  test("preserves full message text", () => {
    const msg = "restricted: this relay requires authentication";
    expect(parseNotice(["NOTICE", msg])).toBe(msg);
  });
});

// ---------------------------------------------------------------------------
// NoticeCollector unit tests
// ---------------------------------------------------------------------------

describe("NoticeCollector", () => {
  test("starts empty", () => {
    const collector = new NoticeCollector();
    expect(collector.count).toBe(0);
    expect(collector.getAll()).toEqual([]);
  });

  test("add() stores a notice", () => {
    const collector = new NoticeCollector();
    collector.add("wss://relay.example.com", "test message");
    expect(collector.count).toBe(1);
  });

  test("add() logs to stderr via console.error", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const collector = new NoticeCollector();
    collector.add("wss://relay.example.com", "rate limited");
    expect(spy).toHaveBeenCalledWith(
      "[NOTICE] wss://relay.example.com: rate limited"
    );
    spy.mockRestore();
  });

  test("getAll() returns all notices in order", () => {
    const collector = new NoticeCollector();
    collector.add("wss://a.com", "msg-a");
    collector.add("wss://b.com", "msg-b");
    collector.add("wss://a.com", "msg-c");

    const notices = collector.getAll();
    expect(notices).toHaveLength(3);
    expect(notices[0].relay).toBe("wss://a.com");
    expect(notices[0].message).toBe("msg-a");
    expect(notices[1].relay).toBe("wss://b.com");
    expect(notices[1].message).toBe("msg-b");
    expect(notices[2].relay).toBe("wss://a.com");
    expect(notices[2].message).toBe("msg-c");
  });

  test("getAll() returns a defensive copy", () => {
    const collector = new NoticeCollector();
    collector.add("wss://a.com", "msg");
    const copy = collector.getAll();
    copy.push({
      relay: "wss://fake.com",
      message: "injected",
      timestamp: new Date().toISOString(),
    });
    expect(collector.count).toBe(1);
  });

  test("getByRelay() filters by relay URL", () => {
    const collector = new NoticeCollector();
    collector.add("wss://a.com", "msg-1");
    collector.add("wss://b.com", "msg-2");
    collector.add("wss://a.com", "msg-3");

    const aNotices = collector.getByRelay("wss://a.com");
    expect(aNotices).toHaveLength(2);
    expect(aNotices[0].message).toBe("msg-1");
    expect(aNotices[1].message).toBe("msg-3");

    const bNotices = collector.getByRelay("wss://b.com");
    expect(bNotices).toHaveLength(1);
    expect(bNotices[0].message).toBe("msg-2");
  });

  test("getByRelay() returns empty array for unknown relay", () => {
    const collector = new NoticeCollector();
    collector.add("wss://a.com", "msg");
    expect(collector.getByRelay("wss://unknown.com")).toEqual([]);
  });

  test("clear() removes all notices", () => {
    const collector = new NoticeCollector();
    collector.add("wss://a.com", "msg-1");
    collector.add("wss://b.com", "msg-2");
    expect(collector.count).toBe(2);

    collector.clear();
    expect(collector.count).toBe(0);
    expect(collector.getAll()).toEqual([]);
  });

  test("notices have valid ISO timestamps", () => {
    const collector = new NoticeCollector();
    collector.add("wss://a.com", "msg");
    const notices = collector.getAll();
    expect(() => new Date(notices[0].timestamp)).not.toThrow();
    expect(new Date(notices[0].timestamp).toISOString()).toBe(
      notices[0].timestamp
    );
  });

  test("count reflects current number of notices", () => {
    const collector = new NoticeCollector();
    expect(collector.count).toBe(0);
    collector.add("wss://a.com", "msg-1");
    expect(collector.count).toBe(1);
    collector.add("wss://a.com", "msg-2");
    expect(collector.count).toBe(2);
    collector.clear();
    expect(collector.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// handleNotice unit tests
// ---------------------------------------------------------------------------

describe("handleNotice", () => {
  test("returns true and records for NOTICE data", () => {
    const collector = new NoticeCollector();
    const result = handleNotice(
      ["NOTICE", "restricted"],
      "wss://relay.example.com",
      collector
    );
    expect(result).toBe(true);
    expect(collector.count).toBe(1);
    expect(collector.getAll()[0].message).toBe("restricted");
    expect(collector.getAll()[0].relay).toBe("wss://relay.example.com");
  });

  test("returns false for non-NOTICE data", () => {
    const collector = new NoticeCollector();
    expect(handleNotice(["EVENT", "sub", {}], "wss://a.com", collector)).toBe(
      false
    );
    expect(handleNotice(["EOSE", "sub"], "wss://a.com", collector)).toBe(false);
    expect(collector.count).toBe(0);
  });

  test("returns false for non-array data", () => {
    const collector = new NoticeCollector();
    expect(handleNotice("NOTICE", "wss://a.com", collector)).toBe(false);
    expect(handleNotice(null, "wss://a.com", collector)).toBe(false);
    expect(handleNotice(42, "wss://a.com", collector)).toBe(false);
    expect(collector.count).toBe(0);
  });

  test("handles multiple NOTICE messages from different relays", () => {
    const collector = new NoticeCollector();
    handleNotice(["NOTICE", "msg-1"], "wss://relay1.com", collector);
    handleNotice(["NOTICE", "msg-2"], "wss://relay2.com", collector);
    handleNotice(["EVENT", "sub", {}], "wss://relay1.com", collector);
    handleNotice(["NOTICE", "msg-3"], "wss://relay1.com", collector);

    expect(collector.count).toBe(3);
    expect(collector.getByRelay("wss://relay1.com")).toHaveLength(2);
    expect(collector.getByRelay("wss://relay2.com")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// RelayNotice type shape tests
// ---------------------------------------------------------------------------

describe("RelayNotice type", () => {
  test("has required fields", () => {
    const collector = new NoticeCollector();
    collector.add("wss://relay.example.com", "test");
    const notice = collector.getAll()[0];
    expect(notice).toHaveProperty("relay");
    expect(notice).toHaveProperty("message");
    expect(notice).toHaveProperty("timestamp");
    expect(typeof notice.relay).toBe("string");
    expect(typeof notice.message).toBe("string");
    expect(typeof notice.timestamp).toBe("string");
  });
});
