/**
 * Relay NOTICE Handler
 *
 * Parses and logs Nostr relay NOTICE messages for debugging.
 * Relays send ["NOTICE", "<message>"] to communicate human-readable
 * information to clients (NIP-01). This module collects and logs them.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single NOTICE message received from a relay. */
export interface RelayNotice {
  relay: string;
  message: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Checks whether a parsed JSON message is a Nostr NOTICE.
 * A NOTICE is a JSON array: ["NOTICE", "<message-string>"]
 */
export function isNoticeMessage(data: unknown): data is [string, string] {
  return (
    Array.isArray(data) &&
    data.length >= 2 &&
    data[0] === "NOTICE" &&
    typeof data[1] === "string"
  );
}

/**
 * Extracts the message string from a parsed NOTICE, or returns null
 * if the data is not a valid NOTICE message.
 */
export function parseNotice(data: unknown): string | null {
  if (isNoticeMessage(data)) {
    return data[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Notice collector
// ---------------------------------------------------------------------------

/**
 * Collects NOTICE messages from multiple relays. Thread-safe for concurrent
 * relay connections (each push is synchronous).
 */
export class NoticeCollector {
  private readonly notices: RelayNotice[] = [];

  /** Record a NOTICE from a relay. Logs it to stderr for debugging. */
  add(relay: string, message: string): void {
    const notice: RelayNotice = {
      relay,
      message,
      timestamp: new Date().toISOString(),
    };
    this.notices.push(notice);
    console.error(`[NOTICE] ${relay}: ${message}`);
  }

  /** Returns all collected notices (defensive copy). */
  getAll(): RelayNotice[] {
    return [...this.notices];
  }

  /** Returns notices for a specific relay URL. */
  getByRelay(relay: string): RelayNotice[] {
    return this.notices.filter((n) => n.relay === relay);
  }

  /** Number of notices collected so far. */
  get count(): number {
    return this.notices.length;
  }

  /** Remove all collected notices. */
  clear(): void {
    this.notices.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Convenience: handle a parsed WebSocket message
// ---------------------------------------------------------------------------

/**
 * Checks if `data` is a NOTICE message and, if so, records it in the
 * collector. Returns true if a NOTICE was handled.
 */
export function handleNotice(
  data: unknown,
  relay: string,
  collector: NoticeCollector
): boolean {
  const message = parseNotice(data);
  if (message !== null) {
    collector.add(relay, message);
    return true;
  }
  return false;
}
