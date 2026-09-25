import { appendFragment, MAX_ENTRIES, type TranscriptEntry } from './transcript'

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

  it('keeps interleaved speakers apart, joining each to its own latest entry', () => {
    const id = counter()
    let t: TranscriptEntry[] = []
    t = appendFragment(t, 'user', ' Tell me', 0, 200, id)
    t = appendFragment(t, 'assistant', ' Mm-hmm.', 200, 400, id)
    t = appendFragment(t, 'user', ' a story', 400, 600, id)
    expect(t.map((e) => [e.speaker, e.text])).toEqual([
      ['user', 'Tell me a story'],
      ['assistant', 'Mm-hmm.'],
    ])
  })

  it('orders entries by start time', () => {
    const id = counter()
    let t: TranscriptEntry[] = []
    t = appendFragment(t, 'assistant', ' Later', 3000, 3200, id)
    t = appendFragment(t, 'user', ' Earlier', 1000, 1200, id)
    expect(t.map((e) => e.text)).toEqual(['Earlier', 'Later'])
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
