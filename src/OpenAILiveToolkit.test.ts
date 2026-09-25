jest.mock('./NativeOpenAILiveToolkit')

import {
  createOpenAILiveToolkit,
  OpenAILiveError,
  type OpenAILiveToolkit,
} from './OpenAILiveToolkit'
import NativeOpenAILiveToolkit from './NativeOpenAILiveToolkit'
import { makeRpcResponse } from './test-helpers'
import { DEFAULT_SWITCHBOARD_APP_ID, DEFAULT_SWITCHBOARD_APP_SECRET } from './credentials'

// The orchestration layer: what `switchboard.initialize` / `createEngine` get sent,
// how the native event stream is classified, and the tool-call round trip. Asserted
// against the real SwitchboardClient → JSON-RPC → (mocked) native chain, since these
// are the seams that break when the node's action names or event shapes change.

const mock = jest.requireMock(
  './NativeOpenAILiveToolkit'
) as typeof import('./__mocks__/NativeOpenAILiveToolkit')
const { emit, resetNativeMock } = mock

const native = NativeOpenAILiveToolkit as unknown as {
  processCommand: jest.Mock<string, [string]>
  requestMicrophonePermission: jest.Mock<Promise<boolean>, []>
}

function sentCommands(): any[] {
  return native.processCommand.mock.calls.map(([json]) => JSON.parse(json))
}

function commandsFor(actionName: string): any[] {
  return sentCommands().filter(
    (c) => c.method === 'callAction' && c.params?.actionName === actionName
  )
}

function commandFor(actionName: string): any | undefined {
  return commandsFor(actionName)[0]
}

function setValuesFor(objectURI: string, key: string): any[] {
  return sentCommands().filter(
    (c) => c.method === 'setValue' && c.params?.objectURI === objectURI && c.params?.key === key
  )
}

function scriptNative(handler: (req: any) => string): void {
  native.processCommand.mockImplementation((json: string) => handler(JSON.parse(json)))
}

function happyPath(engineId = 'engine-1'): void {
  scriptNative((req) => {
    if (req.method === 'callAction' && req.params?.actionName === 'createEngine') {
      return makeRpcResponse(engineId)
    }
    return makeRpcResponse(null)
  })
}

const CREDS = { appId: 'app-123', appSecret: 'secret-456', openAIApiKey: 'sk-openai' }
const WITH_ISOLATION = { ...CREDS, aiCousticsLicenseKey: 'aic-key' }

function initialized(
  options: Parameters<OpenAILiveToolkit['initialize']>[0] = CREDS
): OpenAILiveToolkit {
  const toolkit = createOpenAILiveToolkit()
  toolkit.initialize(options)
  return toolkit
}

async function running(options: Parameters<OpenAILiveToolkit['initialize']>[0] = CREDS) {
  const toolkit = initialized(options)
  await toolkit.start()
  return toolkit
}

/** The engine config sent with createEngine. */
function engineConfig(): any {
  return commandFor('createEngine').params.params
}

function graphNodes(): any[] {
  return engineConfig().configuration.graph.nodes
}

function liveNodeConfig(): any {
  return graphNodes().find((n) => n.id === 'liveNode').configuration
}

/** The graph's connections as a chain of node ids. */
function graphChain(): string[] {
  const connections: { sourceNode: string; destinationNode: string }[] =
    engineConfig().configuration.graph.connections
  return [connections[0]!.sourceNode, ...connections.map((c) => c.destinationNode)]
}

function emitEvent(objectURI: string, name: string, data?: unknown): void {
  emit(JSON.stringify({ objectURI, name, data }))
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

beforeEach(() => {
  resetNativeMock()
  happyPath()
})

describe('initialize', () => {
  it('sends switchboard.initialize with creds and the OpenAI extension key', () => {
    initialized()
    const params = commandFor('initialize').params.params
    expect(params.appID).toBe('app-123')
    expect(params.appSecret).toBe('secret-456')
    expect(params.extensions).toEqual({ OpenAI: { apiKey: 'sk-openai' } })
  })

  it('adds the AICoustics extension when a license key is given', () => {
    const toolkit = initialized(WITH_ISOLATION)
    expect(commandFor('initialize').params.params.extensions.AICoustics).toEqual({
      licenseKey: 'aic-key',
    })
    expect(toolkit.isSpeakerIsolationAvailable).toBe(true)
  })

  it('reports speaker isolation unavailable without a license key', () => {
    expect(initialized().isSpeakerIsolationAvailable).toBe(false)
  })

  it('falls back to the default Switchboard credentials when none are passed', () => {
    initialized({ openAIApiKey: 'sk-openai' })
    const params = commandFor('initialize').params.params
    expect(params.appID).toBe(DEFAULT_SWITCHBOARD_APP_ID)
    expect(params.appSecret).toBe(DEFAULT_SWITCHBOARD_APP_SECRET)
  })

  it('is idempotent — a second initialize does not re-send', () => {
    const toolkit = initialized()
    const calls = native.processCommand.mock.calls.length
    toolkit.initialize({ ...CREDS, appId: 'other' })
    expect(native.processCommand.mock.calls.length).toBe(calls)
  })

  it('skips SDK init when the native SDK survived a reload', () => {
    scriptNative((req) =>
      req.method === 'getValue' && req.params?.key === 'isInitialized'
        ? makeRpcResponse(true)
        : makeRpcResponse(null)
    )
    initialized()
    expect(commandFor('initialize')).toBeUndefined()
  })

  it('records an SDK refusal in initError and on the error channel', async () => {
    scriptNative((req) =>
      req.params?.actionName === 'initialize'
        ? makeRpcResponse(undefined, { code: -1, message: 'bad creds' })
        : makeRpcResponse(null)
    )
    const toolkit = createOpenAILiveToolkit()
    const errors: OpenAILiveError[] = []
    toolkit.addErrorListener((e) => errors.push(e))
    toolkit.initialize(CREDS)
    expect(toolkit.initError).toContain('bad creds')
    expect(errors.map((e) => e.code)).toEqual(['INIT_FAILED'])
    await expect(toolkit.start()).rejects.toMatchObject({ code: 'INIT_FAILED' })
  })

  it('still throws for a blank Switchboard credential', () => {
    expect(() => createOpenAILiveToolkit().initialize({ ...CREDS, appId: ' ' })).toThrow('appId')
    expect(() => createOpenAILiveToolkit().initialize({ ...CREDS, appSecret: '' })).toThrow(
      'appSecret'
    )
  })

  it('re-adopts a running engine that survived a reload', async () => {
    scriptNative((req) => {
      if (req.method === 'getValue' && req.params?.key === 'engines')
        return makeRpcResponse(['engine-9'])
      if (req.method === 'getValue' && req.params?.key === 'isRunning') return makeRpcResponse(true)
      return makeRpcResponse(null)
    })
    const toolkit = initialized()
    expect(toolkit.isRunning).toBe(true)
    await toolkit.start()
    expect(commandFor('createEngine')).toBeUndefined()
  })
})

describe('start guards', () => {
  it('throws if initialize was never called', async () => {
    await expect(createOpenAILiveToolkit().start()).rejects.toMatchObject({
      code: 'NOT_INITIALIZED',
    })
  })

  it('throws MISSING_API_KEY without an OpenAI key, before touching the mic', async () => {
    const toolkit = initialized({ appId: 'a', appSecret: 'b' })
    await expect(toolkit.start()).rejects.toMatchObject({ code: 'MISSING_API_KEY', fatal: true })
    expect(native.requestMicrophonePermission).not.toHaveBeenCalled()
  })

  it('throws when the mic is denied', async () => {
    native.requestMicrophonePermission.mockResolvedValue(false)
    await expect(initialized().start()).rejects.toMatchObject({ code: 'MIC_PERMISSION_DENIED' })
    expect(commandFor('createEngine')).toBeUndefined()
  })

  it('throws with the error body when createEngine returns no id', async () => {
    scriptNative((req) =>
      req.params?.actionName === 'createEngine'
        ? makeRpcResponse(undefined, { code: -1, message: 'bad graph' })
        : makeRpcResponse(null)
    )
    await expect(initialized().start()).rejects.toMatchObject({ code: 'ENGINE_CREATION_FAILED' })
  })

  it('throws and stays not-running when the engine refuses to start', async () => {
    scriptNative((req) => {
      if (req.params?.actionName === 'createEngine') return makeRpcResponse('engine-1')
      if (req.params?.actionName === 'start')
        return makeRpcResponse(undefined, { code: -1, message: 'mic busy' })
      return makeRpcResponse(null)
    })
    const toolkit = initialized()
    await expect(toolkit.start()).rejects.toMatchObject({ code: 'ENGINE_START_FAILED' })
    expect(toolkit.isRunning).toBe(false)
  })

  it('is a no-op when already running', async () => {
    const toolkit = await running()
    await toolkit.start()
    expect(commandsFor('start')).toHaveLength(1)
  })
})

describe('graph', () => {
  it('runs mic → mono → Quail between resamplers → Live → speaker when isolation is available', async () => {
    await running(WITH_ISOLATION)
    expect(graphChain()).toEqual([
      'inputNode',
      'multiChannelToMonoNode',
      'downResamplerNode',
      'speakerIsolationNode',
      'upResamplerNode',
      'liveNode',
      'monoToMultiChannelNode',
      'outputNode',
    ])
    const quail = graphNodes().find((n) => n.id === 'speakerIsolationNode')
    expect(quail.type).toBe('AICoustics.SpeechEnhancer')
    expect(quail.configuration).toMatchObject({
      enabled: true,
      vadGated: false,
      enhancementLevel: 0.7,
    })
  })

  it('leaves Quail out without a license key', async () => {
    await running()
    expect(graphChain()).toEqual([
      'inputNode',
      'multiChannelToMonoNode',
      'liveNode',
      'monoToMultiChannelNode',
      'outputNode',
    ])
  })

  it('builds Quail disabled when seeded off', async () => {
    await running({ ...WITH_ISOLATION, speakerIsolation: false })
    expect(graphNodes().find((n) => n.id === 'speakerIsolationNode').configuration.enabled).toBe(
      false
    )
  })

  it('runs with echo cancellation at 48 kHz', async () => {
    await running()
    const configuration = engineConfig().configuration
    expect(configuration.voiceProcessingEnabled).toBe(true)
    expect(configuration.graph.config).toEqual({ sampleRate: 48000, bufferSize: 480 })
  })

  it('bakes defaults into the Live node', async () => {
    await running()
    expect(liveNodeConfig()).toEqual({
      model: 'gpt-live-1',
      voice: 'marin',
      instructions: '',
      delegation: 'responses',
      responsesModel: 'gpt-5.5',
      responsesInstructions: '',
      tools: [],
    })
  })

  it('carries seeded settings and registered tools into the Live node', async () => {
    const toolkit = initialized({
      ...CREDS,
      instructions: 'Be terse.',
      voice: 'cedar',
      model: 'gpt-live-2',
      delegateModel: 'gpt-6',
      delegateInstructions: 'Use tools.',
    })
    toolkit.registerTool({ name: 'get_time', description: 'Time', handler: () => '' })
    await toolkit.start()
    expect(liveNodeConfig()).toMatchObject({
      instructions: 'Be terse.',
      voice: 'cedar',
      model: 'gpt-live-2',
      responsesModel: 'gpt-6',
      responsesInstructions: 'Use tools.',
      tools: [
        {
          type: 'function',
          name: 'get_time',
          description: 'Time',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
    })
  })
})

describe('live settings', () => {
  it('setInstructions is stored before start and written live after', async () => {
    const toolkit = initialized()
    toolkit.setInstructions('First')
    expect(setValuesFor('liveNode', 'instructions')).toHaveLength(0)
    await toolkit.start()
    expect(liveNodeConfig().instructions).toBe('First')
    toolkit.setInstructions('Second')
    expect(setValuesFor('liveNode', 'instructions')[0].params.value).toBe('Second')
  })

  it('setVoice writes live and is a no-op when unchanged', async () => {
    const toolkit = await running()
    toolkit.setVoice('marin')
    expect(setValuesFor('liveNode', 'voice')).toHaveLength(0)
    toolkit.setVoice('cedar')
    expect(setValuesFor('liveNode', 'voice')[0].params.value).toBe('cedar')
  })

  it('setSpeakerIsolation toggles the Quail node live', async () => {
    const toolkit = await running(WITH_ISOLATION)
    toolkit.setSpeakerIsolation(false)
    expect(setValuesFor('speakerIsolationNode', 'enabled')[0].params.value).toBe(false)
  })

  it('setSpeakerIsolation does nothing without a license key', async () => {
    const toolkit = await running()
    toolkit.setSpeakerIsolation(false)
    expect(setValuesFor('speakerIsolationNode', 'enabled')).toHaveLength(0)
  })

  it('context actions reach the Live node and report delivery', async () => {
    const toolkit = await running()
    expect(toolkit.appendInstructions('Speak French.')).toBe(true)
    expect(toolkit.addContext('User is Ivan.')).toBe(true)
    expect(toolkit.say('Welcome!')).toBe(true)
    expect(commandFor('appendInstructions').params.params).toEqual({ text: 'Speak French.' })
    expect(commandFor('appendThinking').params.params).toEqual({ text: 'User is Ivan.' })
    expect(commandFor('appendCommentary').params.params).toEqual({ text: 'Welcome!' })

    scriptNative(() => makeRpcResponse(undefined, { code: -1, message: 'no session' }))
    expect(toolkit.say('Again')).toBe(false)
  })
})

describe('muting', () => {
  it('mutes a live session, and re-applies it to each new session', async () => {
    const toolkit = await running()
    toolkit.setMuted(true)
    // No session yet: nothing to send.
    expect(commandsFor('muteInput')).toHaveLength(0)

    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    expect(commandsFor('muteInput')).toHaveLength(1)

    toolkit.setMuted(false)
    expect(commandsFor('unmuteInput')).toHaveLength(1)

    emitEvent('engine-1.liveNode', 'sessionDisconnected')
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's2' })
    expect(commandsFor('muteInput')).toHaveLength(1)
  })
})

describe('tools', () => {
  it('writes the tool set live when running', async () => {
    const toolkit = await running()
    toolkit.registerTool({ name: 'a', description: 'A', handler: () => 1 })
    toolkit.registerTool({
      name: 'b',
      description: 'B',
      parameters: { type: 'object' },
      handler: () => 2,
    })
    const writes = setValuesFor('liveNode', 'tools')
    expect(writes.at(-1).params.value.map((t: any) => t.name)).toEqual(['a', 'b'])
  })

  it('unregisterTool re-pushes the remaining set, and ignores unknown names', async () => {
    const toolkit = await running()
    toolkit.registerTool({ name: 'a', description: 'A', handler: () => 1 })
    toolkit.unregisterTool('a')
    toolkit.unregisterTool('missing')
    const writes = setValuesFor('liveNode', 'tools')
    expect(writes).toHaveLength(2)
    expect(writes.at(-1).params.value).toEqual([])
  })
})

describe('tool calls', () => {
  function toolCall(name: string, argumentsJson = '{}') {
    emitEvent('engine-1.liveNode', 'toolCall', {
      callId: 'call-1',
      name,
      argumentsJson,
      delegationId: 'd1',
    })
  }

  it('runs the handler and submits its result JSON-encoded', async () => {
    const toolkit = await running()
    const handler = jest.fn(async ({ city }: { city: string }) => ({ temp: 62, city }))
    toolkit.registerTool({ name: 'weather', description: 'W', handler })
    toolCall('weather', '{"city":"Seattle"}')
    await flush()
    expect(handler).toHaveBeenCalledWith({ city: 'Seattle' })
    expect(commandFor('submitToolResult').params.params).toEqual({
      callId: 'call-1',
      outputJson: '{"temp":62,"city":"Seattle"}',
    })
  })

  it('passes {} when argumentsJson is empty', async () => {
    const toolkit = await running()
    const handler = jest.fn(() => null)
    toolkit.registerTool({ name: 't', description: 'T', handler })
    toolCall('t', '')
    await flush()
    expect(handler).toHaveBeenCalledWith({})
    expect(commandFor('submitToolResult').params.params.outputJson).toBe('null')
  })

  it('submits a tool error and reports it when the handler throws', async () => {
    const toolkit = await running()
    const errors: OpenAILiveError[] = []
    toolkit.addErrorListener((e) => errors.push(e))
    toolkit.registerTool({
      name: 't',
      description: 'T',
      handler: () => {
        throw new Error('boom')
      },
    })
    toolCall('t')
    await flush()
    expect(commandFor('submitToolResult')).toBeUndefined()
    expect(commandFor('submitToolError').params.params.errorJson).toContain('boom')
    expect(errors.map((e) => [e.code, e.fatal])).toEqual([['TOOL_HANDLER_FAILED', false]])
  })

  it('submits a tool error for an unknown tool', async () => {
    await running()
    toolCall('nope')
    await flush()
    expect(commandFor('submitToolError').params.params.errorJson).toContain('No tool registered')
  })

  it('reports an undeliverable result', async () => {
    const toolkit = await running()
    const errors: OpenAILiveError[] = []
    toolkit.addErrorListener((e) => errors.push(e))
    toolkit.registerTool({ name: 't', description: 'T', handler: () => 1 })
    scriptNative((req) =>
      req.params?.actionName === 'submitToolResult'
        ? makeRpcResponse(undefined, { code: -1, message: 'stale call' })
        : makeRpcResponse(null)
    )
    toolCall('t')
    await flush()
    expect(errors.map((e) => e.code)).toEqual(['TOOL_RESULT_UNDELIVERED'])
  })
})

describe('session failures are classified by whether a session is up', () => {
  function collect(toolkit: OpenAILiveToolkit): OpenAILiveError[] {
    const errors: OpenAILiveError[] = []
    toolkit.addErrorListener((e) => errors.push(e))
    return errors
  }

  it('is fatal with no session up, and non-fatal during one', async () => {
    const toolkit = await running()
    const errors = collect(toolkit)
    emitEvent('engine-1.liveNode', 'error', { message: 'invalid key' })
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    emitEvent('engine-1.liveNode', 'error', { message: 'hiccup' })
    emitEvent('engine-1.liveNode', 'sessionClosed', { reason: 'expired' })
    emitEvent('engine-1.liveNode', 'error', { message: 'down again' })
    expect(errors.map((e) => [e.code, e.message, e.fatal])).toEqual([
      ['SESSION_FAILED', 'invalid key', true],
      ['SESSION_FAILED', 'hiccup', false],
      ['SESSION_FAILED', 'down again', true],
    ])
  })

  it('falls back to the raw payload when there is no message', async () => {
    const errors = collect(await running())
    emitEvent('engine-1.liveNode', 'error', {})
    expect(errors[0]!.message).toContain('Session error')
  })
})

describe('event dispatch', () => {
  it('classifies a dotted node URI by its last segment, and drops unknown nodes', async () => {
    const toolkit = await running()
    const names: string[] = []
    toolkit.addEventListener('live', (e) => names.push(e.name))
    emitEvent('engine-1.liveNode', 'inputTranscriptDelta', { delta: 'Hi' })
    emitEvent('engine-1.somethingElse', 'inputTranscriptDelta', { delta: 'x' })
    expect(names).toEqual(['inputTranscriptDelta'])
  })

  it('handles the {params: event} envelope and the eventName fallback', async () => {
    const toolkit = await running()
    const names: string[] = []
    toolkit.addEventListener('live', (e) => names.push(e.name))
    emit(JSON.stringify({ params: { objectURI: 'e.liveNode', name: 'sessionStarting' } }))
    emit(JSON.stringify({ objectURI: 'e.liveNode', eventName: 'sessionStarted' }))
    expect(names).toEqual(['sessionStarting', 'sessionStarted'])
  })

  it('ignores malformed JSON and stops delivering after remove()', async () => {
    const toolkit = await running()
    const listener = jest.fn()
    const sub = toolkit.addEventListener('live', listener)
    emit('not json')
    sub.remove()
    emitEvent('e.liveNode', 'sessionStarted')
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('stop / release', () => {
  it('stop halts the engine but keeps it for a fast restart', async () => {
    const toolkit = await running()
    toolkit.stop()
    expect(toolkit.isRunning).toBe(false)
    await toolkit.start()
    expect(commandsFor('createEngine')).toHaveLength(1)
  })

  it('throws and stays running when the engine refuses to stop', async () => {
    const toolkit = await running()
    scriptNative(() => makeRpcResponse(undefined, { code: -1, message: 'nope' }))
    expect(() => toolkit.stop()).toThrow(OpenAILiveError)
    expect(toolkit.isRunning).toBe(true)
  })

  it('release destroys the engine so the next start rebuilds it', async () => {
    const toolkit = await running()
    toolkit.release()
    expect(commandFor('destroyEngine').params.params).toEqual({ engineID: 'engine-1' })
    await toolkit.start()
    expect(commandsFor('createEngine')).toHaveLength(2)
  })
})

describe('requestMicrophonePermission', () => {
  it('delegates to the native module', async () => {
    native.requestMicrophonePermission.mockResolvedValue(true)
    await expect(createOpenAILiveToolkit().requestMicrophonePermission()).resolves.toBe(true)
  })
})
