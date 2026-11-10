// What the shopper told the concierge, read back from their own concierge_layout events.
// Kept apart from the route so the selection rule is testable.

/** Properties of one concierge_layout event, oldest first in the list. */
export interface StatementEvent {
  /** The shopper's sentence. Events from before statements were stored have none. */
  q?: unknown
  /** Set when the shopper asked the concierge to forget what they said. */
  forget?: unknown
}

/** How many statements are kept and re-applied. */
export const STATEMENTS_MAX = 5

/** Oldest first, no repeats, at most STATEMENTS_MAX. A repeated statement moves to the end. */
export function mergeStatements(earlier: string[], later: string[]): string[] {
  let out: string[] = []
  for (const s of [...earlier, ...later]) out = [...out.filter((x) => x !== s), s]
  return out.slice(-STATEMENTS_MAX)
}

/** The statements still in force: everything since the last "forget", no repeats, newest last. */
export function statementsFrom(events: StatementEvent[]): string[] {
  let out: string[] = []
  for (const event of events) {
    if (event.forget === true) {
      out = []
      continue
    }
    if (typeof event.q !== "string" || !event.q.trim()) continue
    out = mergeStatements(out, [event.q.trim()])
  }
  return out
}

/** "forget what I told you", "reset my preferences": the whole message, so a product ask never matches. */
export const FORGET_RE =
  /^\s*(please\s+)?(forget|clear|reset|wipe|undo)\s+(all\s+)?(of\s+)?(that|this|it|everything|what i (said|told you)|my (preferences?|prefs|settings|choices))[\s.!]*$/i
