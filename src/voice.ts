/**
 * The OpenAI Live node's voice settings — the pure value layer (no native
 * imports), mirroring the node's own defaults.
 */

/** Voices the model can speak with. */
export type OpenAIVoice =
  | 'alloy'
  | 'ash'
  | 'ballad'
  | 'cedar'
  | 'coral'
  | 'echo'
  | 'marin'
  | 'sage'
  | 'shimmer'
  | 'verse'

/** Every {@link OpenAIVoice} — for building a voice picker. */
export const VOICES: readonly OpenAIVoice[] = [
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'marin',
  'sage',
  'shimmer',
  'verse',
]

/** The node's defaults, mirrored so the hook can report them before start(). */
export const DEFAULT_VOICE: OpenAIVoice = 'marin'
export const DEFAULT_MODEL = 'gpt-live-1'
/** Model that runs delegated work and calls the registered tools. */
export const DEFAULT_DELEGATE_MODEL = 'gpt-5.5'
