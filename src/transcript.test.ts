import { appendFragment, MAX_ENTRIES, nextSessionOffset, type TranscriptEntry } from './transcript'

function counter() {
  let n = 0
  return () => ++n
}

describe('appendFragment', () => {
  it('joins close fragments from the same speaker', () => {
    const id = counter()
    let t: TranscriptEntry[] = []
    t = appendFragment(t, 'user', ' What is', 0, 200, id)
    t = appendFragment(t, 'user', ' the time', 200, 400, id)
    expect(t).toEqual([
      { id: 1, speaker: 'user', text: 'What is the time', startMs: 0, endMs: 400 },
    ])
  })

  it('starts a new entry after a long gap', () => {
    const id = counter()
    let t: TranscriptEntry[] = []
    t = appendFragment(t, 'user', ' One', 0, 200, id)
    t = appendFragment(t, 'user', ' Two', 5000, 5200, id)
    expect(t.map((e) => e.text)).toEqual(['One', 'Two'])
  })

  it('ends an entry when the other speaker talks in between', () => {
    const id = counter()
    let t: TranscriptEntry[] = []
    t = appendFragment(t, 'user', ' Tell me', 0, 200, id)
    t = appendFragment(t, 'assistant', ' Mm-hmm.', 200, 400, id)
    t = appendFragment(t, 'user', ' a story', 400, 600, id)
    expect(t.map((e) => [e.speaker, e.text])).toEqual([
      ['user', 'Tell me'],
      ['assistant', 'Mm-hmm.'],
      ['user', 'a story'],
    ])
  })

  it('keeps a quick back-and-forth in the order it was said', () => {
    const id = counter()
    let t: TranscriptEntry[] = []
    t = appendFragment(t, 'user', ' Hi', 0, 200, id)
    t = appendFragment(t, 'assistant', ' Hello!', 400, 600, id)
    t = appendFragment(t, 'user', ' How are you', 800, 1000, id)
    expect(t.map((e) => e.text)).toEqual(['Hi', 'Hello!', 'How are you'])
  })

  it('does not join a fragment that starts before the last entry (a new timeline)', () => {
    const id = counter()
    let t: TranscriptEntry[] = []
    t = appendFragment(t, 'user', ' Before', 60000, 60200, id)
    t = appendFragment(t, 'user', ' After restart', 0, 200, id)
    expect(t.map((e) => e.text)).toEqual(['Before', 'After restart'])
  })

  it('ignores empty fragments and does not mutate the input', () => {
    const id = counter()
    const t = appendFragment([], 'user', ' Hi', 0, 200, id)
    expect(appendFragment(t, 'user', '', 200, 400, id)).toBe(t)
    const next = appendFragment(t, 'user', ' there', 200, 400, id)
    expect(t[0]!.text).toBe('Hi')
    expect(next[0]!.text).toBe('Hi there')
  })

  it('drops the oldest entries past the cap', () => {
    const id = counter()
    let t: TranscriptEntry[] = []
    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      t = appendFragment(t, 'user', ` ${i}`, i * 10000, i * 10000 + 200, id)
    }
    expect(t).toHaveLength(MAX_ENTRIES)
    expect(t[0]!.text).toBe('5')
  })
})

describe('nextSessionOffset', () => {
  it('starts past the last entry, or at 0 when empty', () => {
    expect(nextSessionOffset([])).toBe(0)
    const id = counter()
    const t = appendFragment([], 'user', ' Hi', 0, 5000, id)
    expect(nextSessionOffset(t)).toBeGreaterThan(5000 + 1500)
  })
})
