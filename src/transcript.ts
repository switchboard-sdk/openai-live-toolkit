/** Who said a {@link TranscriptEntry}. */
export type Speaker = 'user' | 'assistant'

/** A run of speech from one speaker, built from GPT-Live's timed transcript fragments. */
export interface TranscriptEntry {
  /** Stable key for list rendering. */
  id: number
  speaker: Speaker
  text: string
  /** Session-timeline start of the first fragment. */
  startMs: number
  /** Session-timeline end of the last fragment. */
  endMs: number
}

/** Fragments from one speaker further apart than this start a new entry. */
export const ENTRY_GAP_MS = 1500
/** Oldest entries are dropped past this many. */
export const MAX_ENTRIES = 200

/**
 * Fold one fragment into the transcript. GPT-Live has no turn events and the two
 * speakers' fragments interleave, so a fragment joins its speaker's latest entry
 * when it follows closely enough, even if the other speaker talked in between.
 * Returns a new array ordered by start time; the input isn't mutated.
 */
export function appendFragment(
  entries: readonly TranscriptEntry[],
  speaker: Speaker,
  delta: string,
  startMs: number,
  endMs: number,
  nextId: () => number
): TranscriptEntry[] {
  if (delta === '') {
    return entries as TranscriptEntry[]
  }
  let latest = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.speaker === speaker) {
      latest = i
      break
    }
  }
  const previous = latest >= 0 ? entries[latest]! : null
  if (previous && startMs - previous.endMs <= ENTRY_GAP_MS) {
    const updated = [...entries]
    updated[latest] = {
      ...previous,
      text: previous.text + delta,
      endMs: Math.max(previous.endMs, endMs),
    }
    return updated
  }
  const entry: TranscriptEntry = { id: nextId(), speaker, text: delta.trimStart(), startMs, endMs }
  const appended = [...entries, entry].sort((a, b) => a.startMs - b.startMs)
  return appended.length > MAX_ENTRIES ? appended.slice(appended.length - MAX_ENTRIES) : appended
}
