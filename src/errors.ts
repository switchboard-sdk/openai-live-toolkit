/**
 * Machine-readable cause of an {@link OpenAILiveError}. Branch on this rather
 * than on the message, which is meant for humans and may change.
 */
export type OpenAILiveErrorCode =
  /** The Switchboard SDK refused to initialize (rejected credentials, extension load failure). */
  | 'INIT_FAILED'
  /** An action needed the SDK, which never came up. */
  | 'NOT_INITIALIZED'
  /** No OpenAI API key for the `websocket` transport. */
  | 'MISSING_API_KEY'
  /** The user denied microphone access. */
  | 'MIC_PERMISSION_DENIED'
  /** The audio graph couldn't be built. */
  | 'ENGINE_CREATION_FAILED'
  /** The engine refused to start (audio session unavailable, mic held by another app). */
  | 'ENGINE_START_FAILED'
  /** The engine refused to stop — it's still running, and the mic is still hot. */
  | 'ENGINE_STOP_FAILED'
  /** OpenAI reported a session-level failure (rejected key, quota, unknown model, bad tool schema). */
  | 'SESSION_FAILED'
  /** A tool handler threw. Already reported to the model, which carries on without the result. */
  | 'TOOL_HANDLER_FAILED'
  /** A tool's result never reached OpenAI — no live session, or a stale call id. */
  | 'TOOL_RESULT_UNDELIVERED'
  /** Media couldn't play: media is off, no running engine, not an http(s) URL, or the stream failed. */
  | 'MEDIA_FAILED'

/**
 * A failure with a machine-readable {@link OpenAILiveError.code}.
 *
 * One type on both channels: actions with a caller (`start`, `stop`) reject with
 * it, and failures with no caller (the session, tool calls) are delivered to
 * the toolkit's error listeners. Never both for the same failure.
 */
export class OpenAILiveError extends Error {
  /** What failed. */
  readonly code: OpenAILiveErrorCode
  /**
   * Whether this leaves something the app has to act on. `false` means the session
   * absorbed it and carries on — worth logging, but there's nothing to render and
   * nothing to clear, so it never lands in the provider's `error` state.
   */
  readonly fatal: boolean
  /** Whatever the underlying layer reported, when there was more than a message. */
  readonly details?: Record<string, unknown>

  constructor(
    code: OpenAILiveErrorCode,
    message: string,
    fatal: boolean,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'OpenAILiveError'
    this.code = code
    this.fatal = fatal
    this.details = details
  }
}

/** `err` as an {@link OpenAILiveError}, wrapping an unexpected throw with `code`. */
export function asLiveError(
  err: unknown,
  code: OpenAILiveErrorCode,
  fatal: boolean
): OpenAILiveError {
  if (err instanceof OpenAILiveError) {
    return err
  }
  return new OpenAILiveError(code, err instanceof Error ? err.message : String(err), fatal)
}
