// Test-only helpers shared across suites. Excluded from the published tarball
// (see package.json `files`) and from the production build (tsconfig.build).

import type { RPCResponse } from './SwitchboardClient'

/** Build the JSON string a mocked `processCommand` returns for one RPC call. */
export function makeRpcResponse(result?: unknown, error?: RPCResponse['error']): string {
  const body: RPCResponse = { jsonrpc: '2.0', id: 1 }
  if (error !== undefined) {
    body.error = error
  } else {
    body.result = result ?? null
  }
  return JSON.stringify(body)
}
