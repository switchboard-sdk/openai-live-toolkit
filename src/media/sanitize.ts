const MAX_STREAM_TEXT = 100

/** A URL for logs and error messages: without credentials, query or fragment, which can hold tokens. */
export function redactUrl(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1').replace(/[?#].*$/, '')
}

/** {@link redactUrl} for every http(s) URL in a message from the SDK. */
export function redactUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s'"]+/gi, redactUrl)
}

/**
 * Text someone else controls, such as a stream's title: one line, capped, without double quotes,
 * for the model to be told as quoted data.
 */
export function streamText(text: string): string {
  const line = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/["“”„«»]/g, "'")
    .trim()
  return line.length > MAX_STREAM_TEXT ? `${line.slice(0, MAX_STREAM_TEXT)}…` : line
}

/**
 * Whether a URL points at the device itself or a local network, which the model mustn't reach. Only
 * the URL is checked: a name that resolves to a local address, or a redirect to one, gets through.
 */
export function isLocalUrl(url: string): boolean {
  const authority = url.match(/^[a-z]+:\/\/([^/?#]*)/i)?.[1]
  // Credentials, IPv6 literals, backslashes, escapes and non-ASCII (which IDN maps, e.g. fullwidth
  // digits to ASCII ones) have no place in a stream host, and parse differently from one parser to
  // the next.
  if (authority === undefined || /[@[\]\\%]|[^\x21-\x7e]/.test(authority) || url.includes('\\')) {
    return true
  }
  const host = authority.replace(/:\d*$/, '').toLowerCase().replace(/\.$/, '')
  // Single-label names like "router" only resolve on a local network.
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost')) {
    return true
  }
  const labels = host.split('.')
  if (!labels.every((label) => /^(0x[0-9a-f]*|\d+)$/.test(label))) {
    return false
  }
  // A numeric host: resolvers also take short, octal and hex forms like 127.1, so only a plain
  // dotted quad is let through, and only outside the local ranges.
  const quad = labels.length === 4 && labels.every((l) => /^(0|[1-9]\d{0,2})$/.test(l) && +l < 256)
  if (!quad) {
    return true
  }
  const [a, b] = labels.map(Number) as [number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}
