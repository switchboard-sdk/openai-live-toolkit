// Test-only helpers shared across suites. Excluded from the published tarball
// (see package.json `files`) and from the production build (tsconfig.build).

import NativeOpenAILiveToolkit from './NativeOpenAILiveToolkit'
import { createOpenAILiveToolkit, type OpenAILiveToolkit } from './OpenAILiveToolkit'
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

// The rest drives a real toolkit against the mocked native module, so suites that use it call
// jest.mock on NativeOpenAILiveToolkit.

export const native = NativeOpenAILiveToolkit as unknown as {
  processCommand: jest.Mock<string, [string]>
  requestMicrophonePermission: jest.Mock<Promise<boolean>, []>
  isSpeakerIsolationSupported: jest.Mock<boolean, []>
  startLogFile: jest.Mock<void, [string]>
  log: jest.Mock<void, [string]>
  exportLogFile: jest.Mock<string, []>
  isBluetoothConnected: jest.Mock<boolean, []>
  setNowPlaying: jest.Mock<void, [string]>
  duckOtherApps: jest.Mock<void, [boolean, string]>
  setOtherAudioResumable: jest.Mock<void, [boolean]>
  synthesizeSpeech: jest.Mock<Promise<string>, [string, string]>
  isOtherAudioPlaying: jest.Mock<boolean, []>
  zipFiles: jest.Mock<string, [string, string]>
  writeFile: jest.Mock<boolean, [string, string]>
}

export const nativeMock = jest.requireMock(
  './NativeOpenAILiveToolkit'
) as typeof import('./__mocks__/NativeOpenAILiveToolkit')

export function logged(): string[] {
  return native.log.mock.calls.map(([line]) => line)
}

export function sentCommands(): any[] {
  return native.processCommand.mock.calls.map(([json]) => JSON.parse(json))
}

export function commandsFor(actionName: string): any[] {
  return sentCommands().filter(
    (c) => c.method === 'callAction' && c.params?.actionName === actionName
  )
}

export function commandFor(actionName: string): any | undefined {
  return commandsFor(actionName)[0]
}

export function setValuesFor(objectURI: string, key: string): any[] {
  return sentCommands().filter(
    (c) => c.method === 'setValue' && c.params?.objectURI === objectURI && c.params?.key === key
  )
}

export function scriptNative(handler: (req: any) => string): void {
  native.processCommand.mockImplementation((json: string) => handler(JSON.parse(json)))
}

export function happyPath(engineId = 'engine-1'): void {
  scriptNative((req) => {
    if (req.method === 'callAction' && req.params?.actionName === 'createEngine') {
      return makeRpcResponse(engineId)
    }
    return makeRpcResponse(null)
  })
}

export const CREDS = { appId: 'app-123', appSecret: 'secret-456' }

type InitializeOptions = Parameters<OpenAILiveToolkit['initialize']>[0]

export function initialized(options: InitializeOptions = CREDS): OpenAILiveToolkit {
  const toolkit = createOpenAILiveToolkit()
  toolkit.initialize(options)
  return toolkit
}

export async function running(options: InitializeOptions = CREDS): Promise<OpenAILiveToolkit> {
  const toolkit = initialized(options)
  await toolkit.start()
  return toolkit
}

/** The engine config sent with createEngine. */
export function engineConfig(): any {
  return commandFor('createEngine').params.params
}

export function graphNodes(): any[] {
  return engineConfig().configuration.graph.nodes
}

export function liveNodeConfig(): any {
  return graphNodes().find((n) => n.id === 'liveNode').configuration
}

export function graphConnections(): {
  sourceNode: string
  destinationNode: string
  destinationBusIndex?: number
}[] {
  return engineConfig().configuration.graph.connections
}

/** The graph's main chain, mic to speaker, as node ids. It comes first in the connections. */
export function graphChain(): string[] {
  const connections = graphConnections()
  const end = connections.findIndex((c) => c.destinationNode === 'outputNode')
  return [
    connections[0]!.sourceNode,
    ...connections.slice(0, end + 1).map((c) => c.destinationNode),
  ]
}

export function emitEvent(objectURI: string, name: string, data?: unknown): void {
  nativeMock.emit(JSON.stringify({ objectURI, name, data }))
}

export const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
