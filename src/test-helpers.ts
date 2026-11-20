/// <reference types="node" />
// Test-only helpers shared across suites. Excluded from the published tarball
// (see package.json `files`) and from the production build (tsconfig.build).

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
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

interface SdkField {
  name?: string
  type?: string
}

interface SdkType {
  subtype: string
  events?: Record<string, { data?: Record<string, SdkField> | SdkField[] }>
}

const SDK_SCHEMA = join(__dirname, '..', '.switchboard', 'object-types.json')

/**
 * The Switchboard SDK's object types by name, from `npm run sdk:schema`. Required in CI; without
 * it, events aren't checked.
 */
const sdkTypes = loadSdkTypes()

/** Whether {@link emitEvent} checks events against the SDK's schema. */
export const sdkEventsChecked = sdkTypes !== null

function loadSdkTypes(): Map<string, SdkType> | null {
  if (!existsSync(SDK_SCHEMA)) {
    if (process.env.CI) {
      throw new Error(`${SDK_SCHEMA} is missing; run npm run sdk:schema`)
    }
    return null
  }
  const { objectTypes } = JSON.parse(readFileSync(SDK_SCHEMA, 'utf8')) as {
    objectTypes: SdkType[]
  }
  return new Map(objectTypes.map((t) => [t.subtype, t]))
}

/** The SDK type of the engine or node `objectURI` names, from the latest engine config sent. */
function sdkTypeOf(objectURI: string): string {
  const create = commandsFor('createEngine').at(-1)
  if (!create) {
    throw new Error(`An event from ${objectURI} before any engine`)
  }
  const config = create.params.params
  if (objectURI.startsWith('switchboard.')) {
    return config.type
  }
  const nodeId = objectURI.slice(objectURI.lastIndexOf('.') + 1)
  const node = config.configuration.graph.nodes.find((n: any) => n.id === nodeId)
  if (!node) {
    throw new Error(`No ${nodeId} node in the graph`)
  }
  return node.type
}

function hasSdkType(value: unknown, type: string | undefined): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'int':
      return Number.isInteger(value)
    case 'float':
      return typeof value === 'number'
    default:
      return true
  }
}

/** Throws unless the SDK's schema has the event, with each of `data`'s fields and their types. */
export function checkSdkEvent(objectURI: string, name: string, data?: unknown): void {
  if (!sdkTypes) {
    return
  }
  const typeName = sdkTypeOf(objectURI)
  const type = sdkTypes.get(typeName)
  if (!type) {
    throw new Error(`The SDK schema has no ${typeName}`)
  }
  const event = type.events?.[name]
  if (!event) {
    throw new Error(`${typeName} has no ${name} event`)
  }
  if (data === undefined || data === null) {
    return
  }
  for (const [key, value] of Object.entries(data)) {
    // Fields by name, or a list of them.
    const field = Array.isArray(event.data)
      ? event.data.find((f) => f.name === key)
      : event.data?.[key]
    if (!field) {
      throw new Error(`${typeName} ${name} has no ${key}`)
    }
    if (!hasSdkType(value, field.type)) {
      throw new Error(`${typeName} ${name} ${key} is a ${field.type}, not ${JSON.stringify(value)}`)
    }
  }
}

/** Emits an event from a node or engine, as the SDK's schema says it sends it. */
export function emitEvent(objectURI: string, name: string, data?: unknown): void {
  checkSdkEvent(objectURI, name, data)
  emitUncheckedEvent(objectURI, name, data)
}

/** Emits an event the SDK's schema doesn't list, such as one from an unknown node. */
export function emitUncheckedEvent(objectURI: string, name: string, data?: unknown): void {
  nativeMock.emit(JSON.stringify({ objectURI, name, data }))
}

export const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
