/** Who said a {@link TranscriptEntry}. */
export type Speaker = 'user' | 'assistant'

/** A run of speech from one speaker, built from GPT-Live's timed transcript fragments. */
export interface TranscriptEntry {
  /** Stable key for list rendering. */
  id: number
  speaker: Speaker
  text: string
  /** Timeline start of the first fragment. */
  startMs: number
  /** Timeline end of the last fragment. */
  endMs: number
}

/** Fragments from one speaker further apart than this start a new entry. */
export const ENTRY_GAP_MS = 1500
/** Oldest entries are dropped past this many. */
export const MAX_ENTRIES = 200

/**
 * Fold one fragment into the transcript. GPT-Live has no turn events, so a fragment
 * continues the last entry when it's the same speaker and follows closely enough.
 * Anything the other speaker said in between (a backchannel included) ends the entry,
 * so the transcript reads in the order things were said. Returns a new array; the
 * input isn't mutated.
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
  const last = entries[entries.length - 1]
  const gap = last ? startMs - last.endMs : Infinity
  if (last && last.speaker === speaker && startMs >= last.startMs && gap <= ENTRY_GAP_MS) {
    const updated = [...entries]
    updated[updated.length - 1] = {
      ...last,
      text: last.text + delta,
      endMs: Math.max(last.endMs, endMs),
    }
    return updated
  }
  const entry: TranscriptEntry = { id: nextId(), speaker, text: delta.trimStart(), startMs, endMs }
  const appended = [...entries, entry]
  return appended.length > MAX_ENTRIES ? appended.slice(appended.length - MAX_ENTRIES) : appended
}

/**
 * Where a new session's timeline should start so its fragments come after everything
 * already in the transcript. Each GPT-Live session counts from 0.
 */
export function nextSessionOffset(entries: readonly TranscriptEntry[]): number {
  const last = entries[entries.length - 1]
  return last ? last.endMs + ENTRY_GAP_MS + 1 : 0
}
