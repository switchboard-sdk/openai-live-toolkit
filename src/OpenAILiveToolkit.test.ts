jest.mock('./NativeOpenAILiveToolkit')

import {
  DeviceEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Share,
} from 'react-native'
import { AUDIO_FOCUS_CHANGED_EVENT, NETWORK_CHANGED_EVENT } from './androidModule'
import {
  CONTEXT_INSTRUCTIONS,
  createOpenAILiveToolkit,
  OpenAILiveError,
  splitContext,
  toolsNote,
  type OpenAILiveToolkit,
} from './OpenAILiveToolkit'
import {
  CREDS,
  commandFor,
  commandsFor,
  emitEvent,
  engineConfig,
  flush,
  graphChain,
  graphConnections,
  graphNodes,
  happyPath,
  initialized,
  liveNodeConfig,
  logged,
  makeRpcResponse,
  native,
  nativeMock,
  running,
  scriptNative,
  setValuesFor,
} from './test-helpers'
import { log } from './logs'
import { DEFAULT_SWITCHBOARD_APP_ID, DEFAULT_SWITCHBOARD_APP_SECRET } from './credentials'

// The orchestration layer: what `switchboard.initialize` / `createEngine` get sent,
// how the native event stream is classified, and the tool-call round trip. Asserted
// against the real SwitchboardClient → JSON-RPC → (mocked) native chain, since these
// are the seams that break when the node's action names or event shapes change.

const { emit, emitBluetooth, emitNetwork, emitOtherAppsDuck, resetNativeMock } = nativeMock

const WEBSOCKET = { ...CREDS, transport: 'websocket' as const, openAIApiKey: 'sk-openai' }
const WITH_ISOLATION = { ...CREDS, aiCousticsLicenseKey: 'aic-key' }

beforeEach(() => {
  resetNativeMock()
  happyPath()
})

describe('initialize', () => {
  it('sends switchboard.initialize with creds and the OpenAI extension', () => {
    initialized()
    const params = commandFor('initialize').params.params
    expect(params.appID).toBe('app-123')
    expect(params.appSecret).toBe('secret-456')
    expect(params.extensions).toEqual({ OpenAI: {} })
  })

  it('leaves apiURL to the SDK unless one is given', () => {
    initialized({ ...CREDS, apiUrl: ' ' })
    expect(commandFor('initialize').params.params.apiURL).toBeUndefined()
  })

  it('sends the Switchboard backend URL when given', () => {
    initialized({ ...CREDS, apiUrl: 'https://example.switchboard.audio' })
    expect(commandFor('initialize').params.params.apiURL).toBe('https://example.switchboard.audio')
  })

  it('gives the OpenAI extension the key over websocket', () => {
    initialized(WEBSOCKET)
    expect(commandFor('initialize').params.params.extensions).toEqual({
      OpenAI: { apiKey: 'sk-openai' },
    })
  })

  it('ignores an OpenAI key over webrtc, with a warning', () => {
    initialized({ ...CREDS, openAIApiKey: 'sk-openai' })
    expect(commandFor('initialize').params.params.extensions).toEqual({ OpenAI: {} })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('openAIApiKey ignored'))
  })

  it('adds the AICoustics extension when a license key is given', () => {
    const toolkit = initialized(WITH_ISOLATION)
    expect(commandFor('initialize').params.params.extensions.AICoustics).toEqual({
      licenseKey: 'aic-key',
    })
    expect(toolkit.isSpeakerIsolationAvailable).toBe(true)
  })

  it('reports speaker isolation unavailable without a license key', () => {
    const toolkit = initialized()
    expect(toolkit.isSpeakerIsolationSupported).toBe(true)
    expect(toolkit.isSpeakerIsolationAvailable).toBe(false)
  })

  it('leaves AICoustics out when the build lacks it, even with a license key', () => {
    native.isSpeakerIsolationSupported.mockReturnValue(false)
    const toolkit = initialized(WITH_ISOLATION)
    expect(commandFor('initialize').params.params.extensions.AICoustics).toBeUndefined()
    expect(toolkit.isSpeakerIsolationSupported).toBe(false)
    expect(toolkit.isSpeakerIsolationAvailable).toBe(false)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('OPENAI_LIVE_AICOUSTICS=1'))
  })

  it('falls back to the default Switchboard credentials when none are passed', () => {
    initialized({})
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

  it('logs the SDK version', () => {
    const values: Record<string, unknown> = { versionName: '3.2.8', buildNumber: 42 }
    scriptNative((req) =>
      makeRpcResponse(req.method === 'getValue' ? (values[req.params?.key] ?? null) : null)
    )
    initialized()
    expect(native.log).toHaveBeenCalledWith(expect.stringContaining('SDK 3.2.8 (42)'))
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
    expect(commandFor('destroyEngine')).toBeUndefined()
  })

  it('drops an idle engine that survived a reload, and builds one with the current settings', async () => {
    scriptNative((req) => {
      if (req.method === 'getValue' && req.params?.key === 'engines')
        return makeRpcResponse(['engine-9'])
      if (req.method === 'callAction' && req.params?.actionName === 'createEngine')
        return makeRpcResponse('engine-1')
      return makeRpcResponse(null)
    })
    const toolkit = initialized({ ...CREDS, media: true })
    expect(toolkit.isRunning).toBe(false)
    expect(commandFor('destroyEngine').params.params).toEqual({ engineID: 'engine-9' })
    await toolkit.start()
    expect(graphNodes().map((n) => n.id)).toContain('mediaPlayerNode')
  })
})

describe('start guards', () => {
  it('throws if initialize was never called', async () => {
    await expect(createOpenAILiveToolkit().start()).rejects.toMatchObject({
      code: 'NOT_INITIALIZED',
    })
  })

  it('throws MISSING_API_KEY over websocket without an OpenAI key, before touching the mic', async () => {
    const toolkit = initialized({ ...CREDS, transport: 'websocket' })
    await expect(toolkit.start()).rejects.toMatchObject({ code: 'MISSING_API_KEY', fatal: true })
    expect(native.requestMicrophonePermission).not.toHaveBeenCalled()
  })

  it('starts over webrtc without an OpenAI key', async () => {
    const toolkit = await running(CREDS)
    expect(toolkit.isRunning).toBe(true)
  })

  it('throws when the mic is denied', async () => {
    native.requestMicrophonePermission.mockResolvedValue(false)
    await expect(initialized().start()).rejects.toMatchObject({ code: 'MIC_PERMISSION_DENIED' })
    expect(commandFor('createEngine')).toBeUndefined()
  })

  it("throws the native reason when iOS can't ask for the mic", async () => {
    native.requestMicrophonePermission.mockRejectedValue(new Error('no usage string'))
    await expect(initialized().start()).rejects.toMatchObject({
      code: 'MIC_PERMISSION_DENIED',
      message: 'no usage string',
      fatal: true,
    })
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
      'inputSplitterNode',
      'liveNode',
      'liveSplitterNode',
      'monoToMultiChannelNode',
      'voiceVolumeNode',
      'mixerNode',
      'limiterNode',
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
      'inputSplitterNode',
      'liveNode',
      'liveSplitterNode',
      'monoToMultiChannelNode',
      'voiceVolumeNode',
      'mixerNode',
      'limiterNode',
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
      transport: 'webrtc',
      model: 'gpt-live-1',
      voice: 'marin',
      instructions: CONTEXT_INSTRUCTIONS,
      delegation: 'responses',
      responsesModel: 'gpt-5.5',
      responsesInstructions: expect.stringContaining('never claim an action is done'),
      tools: [],
      store: false,
    })
  })

  it('gives the Live node the transport and key over websocket', async () => {
    await running(WEBSOCKET)
    expect(liveNodeConfig()).toMatchObject({ transport: 'websocket', apiKey: 'sk-openai' })
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
      instructions:
        'Be terse.\n\n' +
        CONTEXT_INSTRUCTIONS +
        '\n\n' +
        toolsNote([{ name: 'get_time', description: 'Time' }]),
      voice: 'cedar',
      model: 'gpt-live-2',
      responsesModel: 'gpt-6',
      responsesInstructions: expect.stringMatching(
        /never claim an action is done[\s\S]*Use tools\.$/
      ),
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
    expect(liveNodeConfig().instructions).toBe(`First\n\n${CONTEXT_INSTRUCTIONS}`)
    toolkit.setInstructions('Second')
    expect(setValuesFor('liveNode', 'instructions')[0].params.value).toBe(
      `Second\n\n${CONTEXT_INSTRUCTIONS}`
    )
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
    expect(toolkit.addContext('User is Ivan.')).toBe(true)
    expect(toolkit.say('Welcome!')).toBe(true)
    expect(commandFor('appendThinking').params.params).toEqual({ text: 'User is Ivan.' })
    expect(commandFor('appendCommentary').params.params).toEqual({ text: 'Welcome!' })

    scriptNative(() => makeRpcResponse(undefined, { code: -1, message: 'no session' }))
    expect(toolkit.say('Again')).toBe(false)
  })
})

describe('voice volume', () => {
  it('lifts the voice 6 dB by default, and keeps its volume, clamped, for the engine', async () => {
    const toolkit = initialized()
    expect(toolkit.voiceVolume).toBe(0.5)
    await toolkit.start()
    expect(graphNodes().find((n) => n.id === 'voiceVolumeNode')).toMatchObject({
      type: 'Switchboard.Gain',
      properties: { gain: 2 },
    })
    const seen: number[] = []
    toolkit.addVoiceVolumeListener((volume) => seen.push(volume))
    toolkit.setVoiceVolume(2)
    toolkit.setVoiceVolume(-1)
    expect(setValuesFor('voiceVolumeNode', 'gain').map((c) => c.params.value)).toEqual([4, 0])
    expect(toolkit.voiceVolume).toBe(0)
    expect(seen).toEqual([1, 0])
  })

  it('limits the output, so the boosted voice and the media mix without clipping', async () => {
    await running()
    expect(graphNodes().find((n) => n.id === 'limiterNode').type).toBe('Switchboard.Limiter')
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
    expect(commandsFor('unmuteInput')).toHaveLength(2)
  })

  it('unmutes the next session after an unmute with no session live', async () => {
    const toolkit = await running()
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    toolkit.setMuted(true)
    emitEvent('engine-1.liveNode', 'sessionDisconnected')
    toolkit.setMuted(false)
    expect(commandsFor('unmuteInput')).toHaveLength(1)

    // The node may still hold the mute from s1.
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's2' })
    expect(commandsFor('unmuteInput')).toHaveLength(2)
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

describe('tools note', () => {
  it('tells the model to delegate, then lists each tool, and is empty without tools', () => {
    expect(toolsNote([])).toBe('')
    expect(
      toolsNote([
        { name: 'a', description: 'Does A' },
        { name: 'b', description: 'Does B' },
      ])
    ).toBe(
      "You can't change anything in the app yourself: only delegating does. When the user asks " +
        'for something your tools do, delegate it right away, every time, also when asked again ' +
        'or right after doing it. Until the result comes, say a word at most, like "Sure". Never ' +
        "say it's done, or that you'll do it, without delegating: saying so changes nothing. " +
        'Your tools: a (Does A); b (Does B).'
    )
  })

  it("puts the features' lines before the list", () => {
    expect(
      toolsNote([{ name: 'a', description: 'A' }], false, ['Music is delegated too.'])
    ).toContain('saying so changes nothing. Music is delegated too. Your tools: a (A).')
  })

  it("tells the model its voice's loudness is the app's to set", () => {
    expect(toolsNote([{ name: 'seek_media', description: 'Skips' }])).not.toContain('your voice')
    expect(toolsNote([{ name: 'set_voice_volume', description: 'Voice' }])).toContain(
      'are about the volume setting of your voice, which only set_voice_volume changes'
    )
  })

  it('setInstructions writes the prompt with the current tools note', async () => {
    const toolkit = await running()
    toolkit.registerTool({ name: 'a', description: 'A', handler: () => 1 })
    toolkit.setInstructions('Be kind.')
    expect(setValuesFor('liveNode', 'instructions').at(-1).params.value).toBe(
      `Be kind.\n\n${CONTEXT_INSTRUCTIONS}\n\n` + toolsNote([{ name: 'a', description: 'A' }])
    )
  })

  it('tells a live session when tools change, once per change', async () => {
    const toolkit = await running()
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    toolkit.registerTool({ name: 'a', description: 'A', handler: () => 1 })
    toolkit.registerTool({ name: 'a', description: 'A', handler: () => 2 })
    toolkit.unregisterTool('a')
    expect(commandsFor('appendThinking').map((c) => c.params.params.text)).toEqual([
      'Your tools changed. ' + toolsNote([{ name: 'a', description: 'A' }]),
      'You no longer have any tools.',
    ])
  })

  it('tells a live session about many tools in pieces it accepts', async () => {
    const toolkit = await running()
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    const tools = Array.from({ length: 20 }, (_, i) => ({
      name: `tool_${i}`,
      description:
        'Does something useful in the app when the user asks for it, in a sentence or so.',
    }))
    tools.forEach((t) => toolkit.registerTool({ ...t, handler: () => 1 }))
    const texts: string[] = commandsFor('appendThinking').map((c) => c.params.params.text)
    const pieces = texts.slice(
      texts.map((text) => text.startsWith('Your tools changed.')).lastIndexOf(true)
    )
    expect(pieces.length).toBeGreaterThan(1)
    pieces.forEach((text) => expect(text.length).toBeLessThanOrEqual(1200))
    pieces.slice(1).forEach((text) => expect(text.startsWith('Your tools, continued: ')).toBe(true))
    expect(pieces.map((text) => text.replace('Your tools, continued: ', '')).join(' ')).toBe(
      `Your tools changed. ${toolsNote(tools)}`
    )
  })

  it('does not append before a session is up', async () => {
    const toolkit = await running()
    toolkit.registerTool({ name: 'a', description: 'A', handler: () => 1 })
    expect(commandsFor('appendThinking')).toHaveLength(0)
  })

  it('brings a new session up to date when tools changed since the instructions were written', async () => {
    const toolkit = await running()
    toolkit.registerTool({ name: 'a', description: 'A', handler: () => 1 })
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    expect(commandsFor('appendThinking')).toHaveLength(1)

    // A reconnect starts from the node's instructions again, which still lack the tool.
    emitEvent('engine-1.liveNode', 'sessionDisconnected')
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's2' })
    expect(commandsFor('appendThinking')).toHaveLength(2)
  })

  it('leaves a new session alone when its instructions already carry the tools', async () => {
    const toolkit = initialized()
    toolkit.registerTool({ name: 'a', description: 'A', handler: () => 1 })
    await toolkit.start()
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    expect(commandsFor('appendThinking')).toHaveLength(0)
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

  it("keeps a call's own tool event from listeners", async () => {
    const toolkit = await running()
    toolkit.registerTool({ name: 't', description: 'T', handler: () => 1 })
    const names: string[] = []
    toolkit.addEventListener('live', (e) => names.push(e.name))
    toolCall('t')
    emitEvent('engine-1.liveNode', 't', { callId: 'call-1', delegationId: 'd1' })
    await flush()
    expect(names).toEqual(['toolCall'])
    expect(commandsFor('submitToolResult')).toHaveLength(1)
  })

  it('passes a built-in event through when a tool has its name', async () => {
    const toolkit = await running()
    const names: string[] = []
    toolkit.addEventListener('live', (e) => names.push(e.name))
    toolkit.addErrorListener(() => {})
    toolCall('error')
    emitEvent('engine-1.liveNode', 'error', { type: 'server', message: 'Boom' })
    expect(names).toEqual(['toolCall', 'error'])
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

describe('session failures are fatal once the node stops trying', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] })
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  function collect(toolkit: OpenAILiveToolkit): OpenAILiveError[] {
    const errors: OpenAILiveError[] = []
    toolkit.addErrorListener((e) => errors.push(e))
    return errors
  }

  function failed(message: string, reason: string, reconnecting = true): void {
    emitEvent('engine-1.liveNode', 'error', { type: 'transport_error', code: '', message })
    emitEvent('engine-1.liveNode', 'sessionDisconnected', { reason, reconnecting })
  }

  it('is non-fatal during a session', async () => {
    const errors = collect(await running())
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    failed('WebRTC connection failed.', 'dropped')
    expect(errors.map((e) => [e.message, e.fatal])).toEqual([['WebRTC connection failed.', false]])
  })

  it('is fatal when the node stops trying, with the error type and code', async () => {
    const errors = collect(await running())
    emitEvent('engine-1.liveNode', 'error', {
      type: 'insufficient_quota',
      code: 'insufficient_quota',
      message: 'Failed to create the live session: HTTP 429',
    })
    emitEvent('engine-1.liveNode', 'sessionDisconnected', {
      reason: 'refused',
      reconnecting: false,
    })
    expect(errors.map((e) => [e.code, e.message, e.fatal])).toEqual([
      ['SESSION_FAILED', 'Failed to create the live session: HTTP 429', true],
    ])
    expect(errors[0]!.details).toMatchObject({
      type: 'insufficient_quota',
      code: 'insufficient_quota',
    })
  })

  it('only logs tries while offline', async () => {
    const errors = collect(await running())
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    emitEvent('engine-1.liveNode', 'sessionDisconnected', { reason: 'dropped', reconnecting: true })
    for (let i = 0; i < 5; i++) {
      failed("Failed to create the live session: Couldn't resolve host", 'unreachable')
    }
    jest.advanceTimersByTime(5_000)
    expect(errors).toEqual([])
    expect(logged()).toContain(
      "session unreachable, trying again: Failed to create the live session: Couldn't resolve host"
    )
  })

  it('is fatal after 3 tries in a row fail with the network up, until a session comes up', async () => {
    const errors = collect(await running())
    failed('Failed to create the live session: HTTP 502', 'dropped')
    failed("Failed to create the live session: Couldn't resolve host", 'unreachable')
    failed('Failed to create the live session: HTTP 502', 'dropped')
    failed('Failed to create the live session: HTTP 502', 'dropped')
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    emitEvent('engine-1.liveNode', 'sessionClosed', { reason: 'expired' })
    failed('Failed to create the live session: HTTP 502', 'dropped')
    expect(errors.map((e) => e.fatal)).toEqual([false, false, true, false])
  })

  it('is fatal when no sessionDisconnected follows', async () => {
    const errors = collect(await running())
    emitEvent('engine-1.liveNode', 'error', {
      type: 'missing_switchboard_app',
      message: 'OpenAI.Live over webrtc: the Switchboard SDK has no app.',
    })
    expect(errors).toEqual([])
    jest.advanceTimersByTime(1_000)
    expect(errors.map((e) => e.fatal)).toEqual([true])
  })

  it('is non-fatal when the session comes up anyway', async () => {
    const errors = collect(await running())
    emitEvent('engine-1.liveNode', 'error', { message: 'hiccup' })
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    jest.advanceTimersByTime(1_000)
    expect(errors.map((e) => [e.message, e.fatal])).toEqual([['hiccup', false]])
  })

  it('drops a failure held when the engine stops', async () => {
    const toolkit = await running()
    const errors = collect(toolkit)
    emitEvent('engine-1.liveNode', 'error', { message: 'late' })
    toolkit.stop()
    jest.advanceTimersByTime(1_000)
    expect(errors).toEqual([])
  })

  it('falls back to the raw payload when there is no message', async () => {
    const errors = collect(await running())
    emitEvent('engine-1.liveNode', 'error', {})
    jest.advanceTimersByTime(1_000)
    expect(errors[0]!.message).toContain('Session error')
  })

  describe('when the backend refuses the app', () => {
    const REFUSED = {
      type: 'transport_error',
      message: 'Failed to create the live session: HTTP 401, Invalid app credentials.',
    }

    function unauthorized(error: { type: string; message: string }): void {
      emitEvent('engine-1.liveNode', 'error', error)
      emitEvent('engine-1.liveNode', 'sessionDisconnected', {
        reason: 'unauthorized',
        reconnecting: false,
      })
    }

    it('says to check your own credentials', async () => {
      const errors = collect(await running())
      unauthorized(REFUSED)
      expect(errors.map((e) => [e.message, e.fatal])).toEqual([
        [
          `${REFUSED.message} Check appId and appSecret against your app at https://console.switchboard.audio.`,
          true,
        ],
      ])
    })

    it('says the demo credentials may have been rotated', async () => {
      const errors = collect(await running({}))
      unauthorized(REFUSED)
      expect(errors[0]!.message).toContain('The demo credentials may have been rotated')
    })

    it("adds nothing when OpenAI refuses the app's key", async () => {
      const errors = collect(await running())
      const openAIRefused = {
        type: 'invalid_request_error',
        message: 'Failed to create the live session: HTTP 401, Incorrect API key provided.',
      }
      unauthorized(openAIRefused)
      expect(errors[0]!.message).toBe(openAIRefused.message)
    })
  })
})

describe('voice levels', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] })
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  function meterLevels(levels: Record<string, unknown>) {
    scriptNative((req) =>
      req.method === 'getValue' && req.params?.key === 'levelDBFS'
        ? makeRpcResponse(levels[req.params.objectURI])
        : makeRpcResponse(null)
    )
  }

  it('meters what the model hears and its voice', async () => {
    await running()
    const meters = graphNodes().filter((n) => n.type === 'Switchboard.VUMeter')
    expect(meters.map((n) => n.id)).toEqual(['inputMeterNode', 'outputMeterNode'])
    expect(graphConnections()).toEqual(
      expect.arrayContaining([
        { sourceNode: 'inputSplitterNode', destinationNode: 'inputMeterNode' },
        { sourceNode: 'liveSplitterNode', destinationNode: 'outputMeterNode' },
      ])
    )
  })

  it('reads both meters every 50 ms while running, -60 to 0 dBFS as 0 to 1', async () => {
    const toolkit = await running()
    meterLevels({ inputMeterNode: -36, outputMeterNode: 6 })
    const listener = jest.fn()
    toolkit.addVoiceLevelListener(listener)
    jest.advanceTimersByTime(49)
    expect(listener).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(listener).toHaveBeenLastCalledWith({ input: 0.4, output: 1 })
    // Silence: below -60 dBFS, or no number at all.
    meterLevels({ inputMeterNode: -90, outputMeterNode: null })
    jest.advanceTimersByTime(50)
    expect(listener).toHaveBeenLastCalledWith({ input: 0, output: 0 })
  })

  it('settles at 0 and stops reading when the engine stops', async () => {
    const toolkit = await running()
    meterLevels({ inputMeterNode: -30, outputMeterNode: -30 })
    const listener = jest.fn()
    toolkit.addVoiceLevelListener(listener)
    jest.advanceTimersByTime(50)
    toolkit.stop()
    expect(listener).toHaveBeenLastCalledWith({ input: 0, output: 0 })
    listener.mockClear()
    jest.advanceTimersByTime(500)
    expect(listener).not.toHaveBeenCalled()
  })

  it('reads only while the engine runs and someone listens', async () => {
    const toolkit = initialized()
    const listener = jest.fn()
    const subscription = toolkit.addVoiceLevelListener(listener)
    jest.advanceTimersByTime(500)
    expect(listener).not.toHaveBeenCalled()
    await toolkit.start()
    jest.advanceTimersByTime(50)
    expect(listener).toHaveBeenCalledTimes(1)
    subscription.remove()
    jest.advanceTimersByTime(500)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('idle mode', () => {
  const IDLE = { ...CREDS, idleTimeoutMs: 10_000 }

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] })
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  function vad(name: 'speechStarted' | 'speechEnded') {
    emitEvent('engine-1.vadNode', name)
  }

  async function live(options: Parameters<OpenAILiveToolkit['initialize']>[0] = IDLE) {
    const toolkit = await running(options)
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    return toolkit
  }

  it('loads the VAD extensions only when on', () => {
    initialized(IDLE)
    expect(commandFor('initialize').params.params.extensions).toMatchObject({
      Silero: {},
      Onnx: {},
    })
    resetNativeMock()
    happyPath()
    initialized()
    expect(commandFor('initialize').params.params.extensions.Silero).toBeUndefined()
  })

  it('taps a VAD off the input the model hears and stores sessions', async () => {
    await running(IDLE)
    const connections = engineConfig().configuration.graph.connections
    expect(connections).toContainEqual({
      sourceNode: 'multiChannelToMonoNode',
      destinationNode: 'vadSplitterNode',
    })
    expect(connections).toContainEqual({
      sourceNode: 'vadSplitterNode',
      destinationNode: 'inputSplitterNode',
    })
    expect(connections).toContainEqual({
      sourceNode: 'vadSplitterNode',
      destinationNode: 'vadNode',
    })
    expect(graphNodes().find((n) => n.id === 'vadNode').type).toBe('Silero.VAD')
    expect(liveNodeConfig().store).toBe(true)
  })

  it('ends the session once nobody has talked for the timeout', async () => {
    const toolkit = await live()
    const names: string[] = []
    toolkit.addEventListener('live', (e) => names.push(e.name))
    jest.advanceTimersByTime(9_999)
    expect(commandFor('endSession')).toBeUndefined()
    jest.advanceTimersByTime(1)
    expect(commandFor('endSession')).toBeDefined()
    expect(toolkit.isIdle).toBe(true)
    expect(names).toEqual(['sessionEnded'])
  })

  it('counts from the last sign of conversation', async () => {
    await live()
    jest.advanceTimersByTime(9_000)
    emitEvent('engine-1.liveNode', 'outputTranscriptDelta', { delta: 'Sure.' })
    jest.advanceTimersByTime(9_000)
    expect(commandFor('endSession')).toBeUndefined()
    jest.advanceTimersByTime(1_000)
    expect(commandFor('endSession')).toBeDefined()
  })

  it('stays up while the user is speaking or a tool is running', async () => {
    const toolkit = await live()
    vad('speechStarted')
    jest.advanceTimersByTime(30_000)
    expect(commandFor('endSession')).toBeUndefined()
    vad('speechEnded')

    let finish: (value: unknown) => void = () => {}
    toolkit.registerTool({
      name: 't',
      description: 'T',
      handler: () => new Promise((r) => (finish = r)),
    })
    emitEvent('engine-1.liveNode', 'toolCall', { callId: 'c1', name: 't', argumentsJson: '{}' })
    jest.advanceTimersByTime(30_000)
    expect(commandFor('endSession')).toBeUndefined()
    finish(1)
    await flush()
    jest.advanceTimersByTime(10_000)
    expect(commandFor('endSession')).toBeDefined()
  })

  it('wakes on speech by forking the last session', async () => {
    const toolkit = await live()
    jest.advanceTimersByTime(10_000)
    vad('speechStarted')
    expect(commandFor('startSession').params.params).toEqual({ forkSessionId: 's1' })
    expect(toolkit.isIdle).toBe(false)
  })

  it('tells listeners whether a session continues the conversation', async () => {
    const toolkit = await running(IDLE)
    const continued: unknown[] = []
    toolkit.addEventListener('live', (e) => {
      if (e.name === 'sessionStarted') {
        continued.push((e.data as { continued?: boolean }).continued)
      }
    })
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    jest.advanceTimersByTime(10_000)
    vad('speechStarted')
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's2' })
    toolkit.newConversation()
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's3' })
    expect(continued).toEqual([false, true, false])
  })

  it('newConversation while idle makes the next wake start fresh', async () => {
    const toolkit = await live()
    jest.advanceTimersByTime(10_000)
    toolkit.newConversation()
    expect(commandsFor('resetSession')).toHaveLength(0)
    vad('speechStarted')
    expect(commandFor('startSession').params.params).toEqual({})
  })

  describe('after a wake', () => {
    async function woken(options: Parameters<OpenAILiveToolkit['initialize']>[0] = IDLE) {
      const toolkit = await live(options)
      jest.advanceTimersByTime(10_000)
      vad('speechStarted')
      vad('speechEnded')
      emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's2' })
      return toolkit
    }

    it('closes again after the grace period when the model does not answer', async () => {
      const toolkit = await woken()
      jest.advanceTimersByTime(4_999)
      expect(commandsFor('endSession')).toHaveLength(1)
      jest.advanceTimersByTime(1)
      expect(commandsFor('endSession')).toHaveLength(2)
      expect(toolkit.isIdle).toBe(true)
    })

    it('keeps the grace period through an input transcript, like an "mm" from a noise', async () => {
      await woken()
      emitEvent('engine-1.liveNode', 'inputTranscriptDelta', { delta: ' Mm' })
      jest.advanceTimersByTime(5_000)
      expect(commandsFor('endSession')).toHaveLength(2)
    })

    it('goes back to the full timeout once the model answers', async () => {
      await woken()
      emitEvent('engine-1.liveNode', 'outputTranscriptDelta', { delta: 'Sure.' })
      jest.advanceTimersByTime(9_999)
      expect(commandsFor('endSession')).toHaveLength(1)
      jest.advanceTimersByTime(1)
      expect(commandsFor('endSession')).toHaveLength(2)
    })

    it('waits the full timeout when the grace period is off', async () => {
      await woken({ ...IDLE, wakeGraceMs: 0 })
      jest.advanceTimersByTime(9_999)
      expect(commandsFor('endSession')).toHaveLength(1)
      jest.advanceTimersByTime(1)
      expect(commandsFor('endSession')).toHaveLength(2)
    })
  })

  it('starts fresh after the instructions or voice change, which a fork would keep', async () => {
    const toolkit = await live()
    jest.advanceTimersByTime(10_000)
    toolkit.setInstructions('Be kind.')
    vad('speechStarted')
    expect(commandFor('startSession').params.params).toEqual({})
  })

  it('does not wake while muted', async () => {
    const toolkit = await live()
    toolkit.setMuted(true)
    jest.advanceTimersByTime(10_000)
    vad('speechStarted')
    expect(commandFor('startSession')).toBeUndefined()
  })

  it('tells a fork about tools that changed while idle', async () => {
    const toolkit = await live()
    jest.advanceTimersByTime(10_000)
    toolkit.registerTool({ name: 'a', description: 'A', handler: () => 1 })
    expect(commandsFor('appendThinking')).toHaveLength(0)
    vad('speechStarted')
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's2' })
    expect(commandsFor('appendThinking').map((c) => c.params.params.text)).toEqual([
      'Your tools changed. ' + toolsNote([{ name: 'a', description: 'A' }]),
    ])
  })

  it('treats a refused fork as non-fatal, and the next session as new', async () => {
    const toolkit = await live()
    const errors: OpenAILiveError[] = []
    toolkit.addErrorListener((e) => errors.push(e))
    jest.advanceTimersByTime(10_000)
    vad('speechStarted')
    emitEvent('engine-1.liveNode', 'error', {
      type: 'invalid_request_error',
      message: 'The stored session was not found.',
    })
    emitEvent('engine-1.liveNode', 'sessionDisconnected', { reason: 'refused', reconnecting: true })
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's2' })
    expect(errors.map((e) => e.fatal)).toEqual([false])
    expect(native.log).toHaveBeenCalledWith('session started s2')
  })

  it('treats a fork that fails to connect as non-fatal, and the next session as new', async () => {
    const toolkit = await live()
    const errors: OpenAILiveError[] = []
    toolkit.addErrorListener((e) => errors.push(e))
    jest.advanceTimersByTime(10_000)
    vad('speechStarted')
    emitEvent('engine-1.liveNode', 'error', {
      type: 'transport_error',
      message: 'Failed to create the live session: HTTP 502, Failed to fork live session',
    })
    emitEvent('engine-1.liveNode', 'sessionDisconnected', { reason: 'dropped', reconnecting: true })
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's2' })
    expect(errors.map((e) => e.fatal)).toEqual([false])
    expect(native.log).toHaveBeenCalledWith('session started s2')
  })

  it('keeps a fork tried again while offline', async () => {
    const toolkit = await live()
    const errors: OpenAILiveError[] = []
    toolkit.addErrorListener((e) => errors.push(e))
    jest.advanceTimersByTime(10_000)
    vad('speechStarted')
    emitEvent('engine-1.liveNode', 'error', {
      type: 'transport_error',
      message: "Failed to create the live session: Couldn't resolve host",
    })
    emitEvent('engine-1.liveNode', 'sessionDisconnected', {
      reason: 'unreachable',
      reconnecting: true,
    })
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's2' })
    expect(errors).toEqual([])
    expect(native.log).toHaveBeenCalledWith('session started s2 (fork)')
  })

  it('treats a wake refused for the credentials as fatal', async () => {
    const toolkit = await live()
    const errors: OpenAILiveError[] = []
    toolkit.addErrorListener((e) => errors.push(e))
    jest.advanceTimersByTime(10_000)
    vad('speechStarted')
    emitEvent('engine-1.liveNode', 'error', {
      type: 'transport_error',
      message: 'Failed to create the live session: HTTP 401, Invalid app credentials.',
    })
    emitEvent('engine-1.liveNode', 'sessionDisconnected', {
      reason: 'unauthorized',
      reconnecting: false,
    })
    expect(errors.map((e) => e.fatal)).toEqual([true])
  })

  it('stops counting once the engine stops', async () => {
    const toolkit = await live()
    toolkit.stop()
    jest.advanceTimersByTime(10_000)
    expect(commandFor('endSession')).toBeUndefined()
  })

  it('never ends the session when off', async () => {
    await live(CREDS)
    jest.advanceTimersByTime(600_000)
    expect(commandFor('endSession')).toBeUndefined()
  })
})

describe('session notes', () => {
  const IDLE = { ...CREDS, idleTimeoutMs: 10_000 }

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] })
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  function told(): string[] {
    return commandsFor('appendThinking').map((c) => c.params.params.text)
  }

  function started(sessionId: string) {
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId })
  }

  it('tells a live session a note, and each change once', async () => {
    const toolkit = await running()
    started('s1')
    toolkit.setSessionNote('music', 'Apple Music is playing "Song".')
    toolkit.setSessionNote('music', 'Apple Music is playing "Song".')
    toolkit.setSessionNote('music', 'Apple Music is paused on "Song".')
    expect(told()).toEqual(['Apple Music is playing "Song".', 'Apple Music is paused on "Song".'])
  })

  it('tells a new session every note, and a fork only the ones that changed', async () => {
    const toolkit = await running(IDLE)
    toolkit.setSessionNote('where', 'Where the car is: Budapest.')
    toolkit.setSessionNote('music', 'Apple Music is playing "Song".')
    started('s1')
    expect(told()).toEqual(['Where the car is: Budapest.', 'Apple Music is playing "Song".'])
    jest.advanceTimersByTime(10_000)
    toolkit.setSessionNote('where', 'Where the car is: Vienna.')
    emitEvent('engine-1.vadNode', 'speechStarted')
    expect(commandFor('startSession').params.params).toEqual({ forkSessionId: 's1' })
    started('s2')
    expect(told().slice(2)).toEqual(['Where the car is: Vienna.'])
    toolkit.newConversation()
    started('s3')
    expect(told().slice(3)).toEqual(['Where the car is: Vienna.', 'Apple Music is playing "Song".'])
  })

  it('tells an update only to a session that heard an earlier note', async () => {
    const toolkit = await running()
    toolkit.setSessionNote('music', 'Apple Music is not playing.', { onlyUpdate: true })
    started('s1')
    expect(told()).toEqual([])
    toolkit.setSessionNote('music', 'Apple Music is playing "Song".')
    toolkit.setSessionNote('music', 'Apple Music is not playing.', { onlyUpdate: true })
    expect(told()).toEqual(['Apple Music is playing "Song".', 'Apple Music is not playing.'])
  })

  it("drops a note set to ''", async () => {
    const toolkit = await running()
    toolkit.setSessionNote('music', 'Apple Music is playing "Song".')
    toolkit.setSessionNote('music', '')
    started('s1')
    expect(told()).toEqual([])
  })
})

describe('logs', () => {
  const LOGGED = { ...CREDS, logFile: true }

  it('writes no log file unless asked', () => {
    initialized()
    expect(native.startLogFile).not.toHaveBeenCalled()
  })

  it('starts the log file in the caches directory', () => {
    initialized(LOGGED)
    expect(native.startLogFile).toHaveBeenCalledWith('/mock/caches')
  })

  it('logs tool names but not the conversation by default', async () => {
    await running(LOGGED)
    emitEvent('engine-1.liveNode', 'inputTranscriptDelta', { delta: 'Make it crimson.' })
    emitEvent('engine-1.liveNode', 'toolCall', {
      callId: 'c1',
      name: 'set_background_color',
      argumentsJson: '{"color":"crimson"}',
    })
    expect(logged()).toContain('tool call set_background_color')
    expect(logged().join('\n')).not.toContain('crimson')
  })

  it("logs the engine's state and route", async () => {
    await running(LOGGED)
    emitEvent('switchboard.engine-1', 'stateChanged', { state: 'interrupted', reason: 'phoneCall' })
    emitEvent('switchboard.engine-1', 'stateChanged', { state: 'running', reason: '' })
    emitEvent('switchboard.engine-1', 'routeChanged', {
      input: 'BluetoothHFP',
      inputName: 'MB Bluetooth',
      output: 'BluetoothA2DPOutput',
      outputName: 'MB Bluetooth',
    })
    expect(logged()).toEqual(
      expect.arrayContaining([
        'engine interrupted: phoneCall',
        'engine running',
        'engine route: output MB Bluetooth (BluetoothA2DPOutput), input MB Bluetooth (BluetoothHFP)',
      ])
    )
  })

  it('logs only the id and target of a delegation', async () => {
    await running(LOGGED)
    emitEvent('engine-1.liveNode', 'delegationCreated', {
      delegationId: 'd1',
      target: 'client',
      request: 'Make it crimson.',
    })
    expect(logged()).toContain('delegation {"delegationId":"d1","target":"client"}')
    expect(logged().join('\n')).not.toContain('crimson')
  })

  it('logs the transcript a turn at a time, and tool arguments, with logConversation', async () => {
    await running({ ...LOGGED, logConversation: true })
    emitEvent('engine-1.liveNode', 'inputTranscriptDelta', { delta: 'Make it' })
    emitEvent('engine-1.liveNode', 'inputTranscriptDelta', { delta: ' red.' })
    emitEvent('engine-1.liveNode', 'outputTranscriptDelta', { delta: 'Sure.' })
    emitEvent('engine-1.liveNode', 'toolCall', {
      callId: 'c1',
      name: 'set_background_color',
      argumentsJson: '{"color":"red"}',
    })
    expect(logged()).toEqual(
      expect.arrayContaining([
        'user: Make it red.',
        'assistant: Sure.',
        'tool call set_background_color {"color":"red"}',
      ])
    )
  })

  it('logs errors', () => {
    const toolkit = initialized()
    toolkit.addErrorListener(() => {})
    emitEvent('engine-1.liveNode', 'error', { message: 'boom' })
    emitEvent('engine-1.liveNode', 'sessionDisconnected', {
      reason: 'refused',
      reconnecting: false,
    })
    expect(logged()).toContain('error SESSION_FAILED (fatal): boom')
  })

  it('shares the exported file through the share sheet', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' })
    await createOpenAILiveToolkit().shareLogs()
    expect(share).toHaveBeenCalledWith({ url: 'file:///mock/caches/openai-live-toolkit-log.txt' })
    share.mockRestore()
  })

  it('shares through the JVM module on Android', async () => {
    const originalOS = Platform.OS
    Platform.OS = 'android'
    const shareFile = jest.fn().mockResolvedValue(undefined)
    NativeModules.OpenAILiveToolkitAndroid = { shareFile }
    try {
      await createOpenAILiveToolkit().shareLogs()
      expect(shareFile).toHaveBeenCalledWith('/mock/caches/openai-live-toolkit-log.txt')
    } finally {
      Platform.OS = originalOS
      delete NativeModules.OpenAILiveToolkitAndroid
    }
  })

  it('rejects when there is no log file', async () => {
    native.exportLogFile.mockReturnValue('')
    await expect(createOpenAILiveToolkit().shareLogs()).rejects.toThrow('logFile on')
  })

  describe('diagnostic audio', () => {
    const RECORDED = { ...LOGGED, diagnosticAudioSeconds: 120 }

    it('records the mic, what the model hears and the output', async () => {
      await running(RECORDED)
      expect(graphChain()).toEqual([
        'inputNode',
        'multiChannelToMonoNode',
        'micRecorderNode',
        'inputSplitterNode',
        'heardRecorderNode',
        'liveNode',
        'liveSplitterNode',
        'monoToMultiChannelNode',
        'voiceVolumeNode',
        'mixerNode',
        'limiterNode',
        'outputRecorderNode',
        'outputNode',
      ])
      expect(graphNodes().find((n) => n.id === 'micRecorderNode')).toEqual({
        id: 'micRecorderNode',
        type: 'Switchboard.DiagnosticRecorder',
        configuration: { sampleSeconds: 120 },
      })
    })

    it('records nothing without the log file', async () => {
      await running({ ...CREDS, diagnosticAudioSeconds: 120 })
      expect(graphNodes().some((n) => n.type === 'Switchboard.DiagnosticRecorder')).toBe(false)
    })

    it('zips the recordings with the log, each end marked in it', async () => {
      const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' })
      const toolkit = await running(RECORDED)
      scriptNative((req) =>
        req.params?.actionName === 'dump'
          ? makeRpcResponse(`${req.params.params.filePath}_recording.wav`)
          : makeRpcResponse(null)
      )
      await toolkit.shareLogs()
      expect(commandsFor('dump').map((c) => [c.params.objectURI, c.params.params])).toEqual([
        ['micRecorderNode', { filePath: '/mock/caches/mic' }],
        ['heardRecorderNode', { filePath: '/mock/caches/heard' }],
        ['outputRecorderNode', { filePath: '/mock/caches/output' }],
      ])
      expect(logged().filter((line) => line.startsWith('diagnostics:'))).toEqual([
        'diagnostics: mic recording ends',
        'diagnostics: heard recording ends',
        'diagnostics: output recording ends',
      ])
      expect(native.zipFiles).toHaveBeenCalledWith(
        [
          '/mock/caches/openai-live-toolkit-log.txt',
          '/mock/caches/mic_recording.wav',
          '/mock/caches/heard_recording.wav',
          '/mock/caches/output_recording.wav',
          '/mock/caches/labels.txt',
        ].join('\n'),
        '/mock/caches/openai-live-toolkit-logs.zip'
      )
      expect(share).toHaveBeenCalledWith({
        url: 'file:///mock/caches/openai-live-toolkit-logs.zip',
      })
      share.mockRestore()
    })

    it('labels what happened against the mic recording, for Audacity', async () => {
      const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' })
      const frames: Record<string, number> = {
        micRecorderNode: 0,
        heardRecorderNode: 0,
        outputRecorderNode: 0,
      }
      const toolkit = await running({ ...RECORDED, mixWithOthers: true, duckOtherApps: true })
      scriptNative((req) => {
        if (req.method === 'getValue' && req.params.key === 'currentFrames') {
          return makeRpcResponse(frames[req.params.objectURI])
        }
        if (req.params?.actionName === 'dump') {
          // The others record on while one is written, 0.1 s here.
          Object.keys(frames)
            .filter((node) => node !== req.params.objectURI)
            .forEach((node) => (frames[node] += 4_800))
          return makeRpcResponse(`${req.params.params.filePath}_recording.wav`)
        }
        return makeRpcResponse(null)
      })
      const at = (frame: number) => Object.keys(frames).forEach((node) => (frames[node] = frame))
      // Older than the two minutes kept.
      at(1_000_000)
      log('user: Hello')
      at(6_040_000)
      emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
      emitOtherAppsDuck(true)
      at(6_520_000)
      emitBluetooth(true)
      at(7_000_000)
      await toolkit.shareLogs()
      // The mic recording holds the last 120 s: from frame 1,240,000.
      expect(native.writeFile).toHaveBeenCalledWith(
        '/mock/caches/labels.txt',
        [
          '0.100000\t0.100000\theard recording starts here',
          '0.200000\t0.200000\toutput recording starts here',
          '100.000000\t100.000000\tsession started s1',
          '100.000000\t100.000000\tother apps lowered',
          '110.000000\t110.000000\taudio route changed, Bluetooth connected',
        ].join('\n') + '\n'
      )
      share.mockRestore()
    })

    it("shares the log alone when the recordings can't be written", async () => {
      const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' })
      const toolkit = await running(RECORDED)
      scriptNative((req) =>
        req.params?.actionName === 'dump'
          ? makeRpcResponse(undefined, { code: -1, message: 'nothing recorded' })
          : makeRpcResponse(null)
      )
      await toolkit.shareLogs()
      expect(logged()).toContain('diagnostics: no mic recording: nothing recorded')
      expect(native.zipFiles).not.toHaveBeenCalled()
      expect(share).toHaveBeenCalledWith({ url: 'file:///mock/caches/openai-live-toolkit-log.txt' })
      share.mockRestore()
    })
  })
})

describe('other audio', () => {
  it('stops other audio by default', async () => {
    await running()
    expect(engineConfig().configuration.mixWithOthers).toBeUndefined()
  })

  it('mixes with other audio on iOS, ducking it to the minimum by default', async () => {
    await running({ ...CREDS, mixWithOthers: true })
    expect(engineConfig().configuration).toMatchObject({
      mixWithOthers: true,
      otherAudioDucking: 'min',
    })
  })
})

describe('ducking other apps', () => {
  const OPTIONS = { ...CREDS, mixWithOthers: true, duckOtherApps: true }

  afterEach(() => {
    jest.useRealTimers()
  })

  function live(name: string): void {
    emitEvent(
      'engine-1.liveNode',
      name,
      name === 'sessionStarted' ? { sessionId: 's1' } : undefined
    )
  }

  function ducks(): boolean[] {
    return native.duckOtherApps.mock.calls.map(([duck]) => duck)
  }

  it('lowers them while a session is open, and brings them back when it closes and on stop', async () => {
    const toolkit = await running(OPTIONS)
    expect(ducks()).toEqual([])
    live('sessionStarted')
    expect(ducks()).toEqual([true])
    live('sessionDisconnected')
    expect(ducks()).toEqual([true, false])
    live('sessionStarting')
    live('sessionStarted')
    toolkit.stop()
    expect(ducks()).toEqual([true, false, true, false])
  })

  it('brings them back when the session ends for quiet', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] })
    await running({ ...OPTIONS, idleTimeoutMs: 10_000 })
    live('sessionStarted')
    jest.advanceTimersByTime(10_000)
    expect(ducks()).toEqual([true, false])
  })

  it("leaves them alone while the app's own media plays", async () => {
    const toolkit = await running({ ...OPTIONS, media: { nowPlayingControls: true } })
    live('sessionStarted')
    toolkit.media.play('https://radio.example/rock.mp3')
    expect(ducks()).toEqual([true, false])
    toolkit.media.stop()
    expect(ducks()).toEqual([true, false, true])
  })

  it('reports each change the native side made', async () => {
    const toolkit = await running(OPTIONS)
    const changes: [boolean, boolean][] = []
    toolkit.addOtherAppsDuckListener((ducked, othersCanPlay) =>
      changes.push([ducked, othersCanPlay])
    )
    live('sessionStarted')
    expect(toolkit.otherAppsDucked).toBe(false)
    emitOtherAppsDuck(true)
    expect(toolkit.otherAppsDucked).toBe(true)
    expect(changes).toEqual([[true, true]])
  })

  it("says other apps can't play while the engine doesn't mix", async () => {
    const toolkit = await running(OPTIONS)
    const changes: [boolean, boolean][] = []
    toolkit.addOtherAppsDuckListener((ducked, othersCanPlay) =>
      changes.push([ducked, othersCanPlay])
    )
    scriptNative((req) =>
      makeRpcResponse(
        req.method === 'getValue' && req.params.key === 'mixingWithOthers' ? false : null
      )
    )
    emitOtherAppsDuck(false)
    expect(changes).toEqual([[false, false]])
  })

  it('tells the native side whether the app plays other audio again, once per change', async () => {
    const toolkit = await running(OPTIONS)
    toolkit.setOtherAudioResumable(true)
    toolkit.setOtherAudioResumable(true)
    toolkit.setOtherAudioResumable(false)
    expect(native.setOtherAudioResumable.mock.calls).toEqual([[true], [false]])
  })

  it('is off by default', async () => {
    await running({ ...CREDS, mixWithOthers: true })
    live('sessionStarted')
    expect(ducks()).toEqual([])
  })
})

describe('offline notice', () => {
  const OFFLINE = "I've lost the connection. I'll be back when it returns."

  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  function live(name: string, data?: unknown): void {
    emitEvent('engine-1.liveNode', name, data)
  }

  function spoken(): string[] {
    return native.synthesizeSpeech.mock.calls.map(([text]) => text)
  }

  function told(): string[] {
    return commandsFor('appendThinking').map((c) => c.params.params.text)
  }

  it('says once, on the device, while the network stays gone', async () => {
    await running({ ...CREDS, offlineNotice: true })
    emitNetwork(false)
    await jest.advanceTimersByTimeAsync(3_000)
    live('sessionDisconnected')
    await jest.advanceTimersByTimeAsync(20_000)
    expect(native.synthesizeSpeech.mock.calls).toEqual([[OFFLINE, 'en-US']])
  })

  it('says nothing for a short drop', async () => {
    await running({ ...CREDS, offlineNotice: true })
    emitNetwork(false)
    await jest.advanceTimersByTimeAsync(1_000)
    emitNetwork(true)
    await jest.advanceTimersByTimeAsync(5_000)
    expect(spoken()).toEqual([])
  })

  it('says it when a session stays down, but not when it comes back in time', async () => {
    await running({ ...CREDS, offlineNotice: true })
    live('sessionDisconnected')
    await jest.advanceTimersByTimeAsync(5_000)
    live('sessionStarted', { sessionId: 's1' })
    await jest.advanceTimersByTimeAsync(10_000)
    expect(spoken()).toEqual([])

    live('sessionDisconnected')
    await jest.advanceTimersByTimeAsync(10_000)
    expect(spoken()).toEqual([OFFLINE])
  })

  it('says it is back once the session is, leaving the reconnect to the node', async () => {
    await running({ ...CREDS, offlineNotice: true, continueConversation: true })
    live('sessionStarted', { sessionId: 's1' })
    emitNetwork(false)
    live('sessionDisconnected', { reason: 'dropped', reconnecting: true })
    await jest.advanceTimersByTimeAsync(3_000)
    expect(spoken()).toEqual([OFFLINE])

    await jest.advanceTimersByTimeAsync(7_000)
    emitNetwork(true)
    expect(commandFor('startSession')).toBeUndefined()
    // Tries that still fail with the network back don't say it again.
    live('sessionStarting')
    live('sessionDisconnected', { reason: 'unreachable', reconnecting: true })
    await jest.advanceTimersByTimeAsync(20_000)
    expect(spoken()).toEqual([OFFLINE])

    live('sessionStarted', { sessionId: 's2' })
    expect(spoken()).toEqual([OFFLINE, "We're back online."])
    expect(told()).toContain(
      "The connection was lost for 30 s, and the user was told; it's back now."
    )
  })

  it('says it is back when the network returns during a session that held on', async () => {
    await running({ ...CREDS, offlineNotice: true })
    live('sessionStarted', { sessionId: 's1' })
    emitNetwork(false)
    await jest.advanceTimersByTimeAsync(3_000)
    emitNetwork(true)
    expect(spoken()).toEqual([OFFLINE, "We're back online."])
  })

  it('says it is back when the network returns while the session is closed for quiet', async () => {
    await running({ ...CREDS, offlineNotice: true, idleTimeoutMs: 10_000 })
    live('sessionStarted', { sessionId: 's1' })
    await jest.advanceTimersByTimeAsync(10_000)
    expect(commandFor('endSession')).toBeDefined()
    emitNetwork(false)
    await jest.advanceTimersByTimeAsync(3_000)
    emitNetwork(true)
    expect(spoken()).toEqual([OFFLINE, "We're back online."])
  })

  it('plays what the device says through the engine, with media lowered meanwhile', async () => {
    const toolkit = await running({ ...CREDS, offlineNotice: true, media: true })
    expect(graphNodes().find((n) => n.id === 'noticePlayerNode').type).toBe(
      'Switchboard.AudioPlayer'
    )
    expect(graphConnections()).toContainEqual({
      sourceNode: 'noticePlayerNode',
      destinationNode: 'mixerNode',
      destinationBusIndex: 2,
    })
    expect(graphNodes().find((n) => n.id === 'mixerNode').configuration).toEqual({
      numberOfInputs: 3,
    })

    toolkit.media.play('https://radio.example/live.mp3')
    emitNetwork(false)
    await jest.advanceTimersByTimeAsync(3_000)
    const gains = () => setValuesFor('mediaVolumeNode', 'gain').map((c) => c.params.value)
    expect(gains()).toEqual([0.2])
    const notice = commandsFor('load').find((c) => c.params.objectURI === 'noticePlayerNode')
    expect(notice.params.params).toEqual({ audioFilePath: '/mock/caches/speech.wav' })

    emitEvent('engine-1.noticePlayerNode', 'stateChanged', { state: 'finished' })
    await jest.advanceTimersByTimeAsync(0)
    expect(gains()).toEqual([0.2, 1])
  })

  it('keeps media lowered through a notice that cuts off another, then raises it', async () => {
    const toolkit = await running({ ...CREDS, offlineNotice: true, media: true })
    const gains = () => setValuesFor('mediaVolumeNode', 'gain').map((c) => c.params.value)
    live('sessionStarted', { sessionId: 's1' })
    toolkit.media.play('https://radio.example/live.mp3')
    emitNetwork(false)
    await jest.advanceTimersByTimeAsync(3_000)
    toolkit.media.pause()
    toolkit.media.setVolume(0.5)
    emitNetwork(true)
    await jest.advanceTimersByTimeAsync(0)
    expect(gains()).toEqual([0.2, 0.1, 0.1])

    emitEvent('engine-1.noticePlayerNode', 'stateChanged', { state: 'finished' })
    await jest.advanceTimersByTimeAsync(0)
    expect(gains()).toEqual([0.2, 0.1, 0.1, 0.5])
    await jest.advanceTimersByTimeAsync(20_000)
    expect(gains()).toHaveLength(4)
  })

  it('plays next to the voice alone without media', async () => {
    await running({ ...CREDS, offlineNotice: true })
    expect(graphConnections()).toContainEqual({
      sourceNode: 'noticePlayerNode',
      destinationNode: 'mixerNode',
      destinationBusIndex: 1,
    })
    expect(graphNodes().find((n) => n.id === 'mixerNode').configuration).toEqual({
      numberOfInputs: 2,
    })
  })

  it('plays media that failed while offline again', async () => {
    const url = 'https://radio.example/live.mp3'
    const toolkit = await running({ ...CREDS, offlineNotice: true, media: true })
    toolkit.media.play(url)
    emitNetwork(false)
    emitEvent('engine-1.mediaPlayerNode', 'stateChanged', { state: 'error' })
    emitNetwork(true)
    expect(commandsFor('stream').map((c) => c.params.params.audioFilePath)).toEqual([url, url])
  })

  it('uses the given words and voice', async () => {
    await running({
      ...CREDS,
      offlineNotice: { offline: 'Offline.', online: 'Online.', language: 'hu-HU' },
    })
    emitNetwork(false)
    await jest.advanceTimersByTimeAsync(3_000)
    expect(native.synthesizeSpeech.mock.calls).toEqual([['Offline.', 'hu-HU']])
  })

  it('is off by default', async () => {
    await running()
    emitNetwork(false)
    live('sessionDisconnected')
    await jest.advanceTimersByTimeAsync(20_000)
    expect(spoken()).toEqual([])
  })
})

describe('splitContext', () => {
  it('keeps short text whole', () => {
    expect(splitContext('  Short.  ')).toEqual(['Short.'])
    expect(splitContext('')).toEqual([])
  })

  it('cuts long text after a "; " or ". "', () => {
    const entries = Array.from({ length: 60 }, (_, i) => `entry ${i} with some words`)
    const text = entries.join('; ') + '.'
    const pieces = splitContext(text)
    expect(pieces.length).toBeGreaterThan(1)
    pieces.slice(0, -1).forEach((p) => expect(p.endsWith(';')).toBe(true))
    pieces.forEach((p) => expect(p.length).toBeLessThanOrEqual(1200))
    expect(pieces.join(' ')).toBe(text)
  })

  it('cuts text without breaks at the limit', () => {
    expect(splitContext('x'.repeat(2500)).map((p) => p.length)).toEqual([1200, 1200, 100])
  })
})

describe('bluetooth', () => {
  function a2dpValues(): boolean[] {
    return setValuesFor('engine-1', 'allowBluetoothA2DP').map((c) => c.params.value)
  }

  it("hears the phone's microphone by default, playing over A2DP", async () => {
    await running()
    expect(engineConfig().configuration.allowBluetoothA2DP).toBe(true)
  })

  it('uses the Bluetooth microphone when chosen, and switches live on iOS', async () => {
    const toolkit = await running({ ...CREDS, microphone: 'bluetooth' })
    expect(engineConfig().configuration.allowBluetoothA2DP).toBeUndefined()
    toolkit.setMicrophone('phone')
    expect(a2dpValues()).toEqual([true])
  })

  it("doesn't ask for echo-cancelled input by default", async () => {
    await running()
    expect(engineConfig().configuration.prefersEchoCancelledInput).toBeUndefined()
  })

  it('asks for echo-cancelled input with echoCancelledInput', async () => {
    await running({ ...CREDS, echoCancelledInput: true })
    expect(engineConfig().configuration.prefersEchoCancelledInput).toBe(true)
  })

  it('allows voice processing by default, and switches it live on iOS', async () => {
    const toolkit = await running()
    expect(engineConfig().configuration.voiceProcessingEnabled).toBe(true)
    toolkit.setVoiceProcessing(false)
    expect(setValuesFor('engine-1', 'voiceProcessingEnabled').map((c) => c.params.value)).toEqual([
      false,
    ])
  })

  it('reports a connected Bluetooth device and route changes', () => {
    native.isBluetoothConnected.mockReturnValue(true)
    const toolkit = initialized()
    expect(toolkit.isBluetoothConnected()).toBe(true)
    const seen: boolean[] = []
    const sub = toolkit.addBluetoothListener((connected) => seen.push(connected))
    emitBluetooth(false)
    sub.remove()
    emitBluetooth(true)
    expect(seen).toEqual([false])
  })

  it('keeps the Bluetooth microphone on Android', async () => {
    const originalOS = Platform.OS
    Platform.OS = 'android'
    NativeModules.OpenAILiveToolkitAndroid = {
      startAudioSession: jest.fn().mockResolvedValue(undefined),
      stopAudioSession: jest.fn().mockResolvedValue(undefined),
    }
    const permission = jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED)
    try {
      native.isBluetoothConnected.mockReturnValue(true)
      const toolkit = await running({ ...CREDS, microphone: 'phone' })
      expect(engineConfig().configuration.allowBluetoothA2DP).toBeUndefined()
      toolkit.setMicrophone('phone')
      expect(a2dpValues()).toEqual([])
      expect(toolkit.isBluetoothConnected()).toBe(false)
    } finally {
      Platform.OS = originalOS
      delete NativeModules.OpenAILiveToolkitAndroid
      permission.mockRestore()
    }
  })
})

describe('web search', () => {
  it('is off by default', async () => {
    await running()
    expect(liveNodeConfig().tools).not.toContainEqual({ type: 'web_search' })
  })

  it('gives the delegate web search and tells the model about it', async () => {
    await running({ ...CREDS, webSearch: true })
    expect(liveNodeConfig().tools).toContainEqual({ type: 'web_search' })
    expect(liveNodeConfig().instructions).toContain('the delegate can search the web')
  })

  it('keeps web search when tools change', async () => {
    const toolkit = await running({ ...CREDS, webSearch: true })
    toolkit.registerTool({ name: 'a', description: 'A', handler: () => 1 })
    expect(setValuesFor('liveNode', 'tools').pop().params.value).toContainEqual({
      type: 'web_search',
    })
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

  function forkSessionIds(): string[] {
    return setValuesFor('liveNode', 'forkSessionId').map((c) => c.params.value)
  }

  const CONTINUE = { ...CREDS, continueConversation: true }

  it('start begins a new conversation, without storing sessions, by default', async () => {
    const toolkit = await running()
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    toolkit.stop()
    await toolkit.start()
    expect(forkSessionIds()).toEqual([])
    expect(liveNodeConfig().store).toBe(false)
  })

  it('with continueConversation, start continues the conversation a stop closed', async () => {
    const toolkit = await running(CONTINUE)
    expect(liveNodeConfig().store).toBe(true)
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    toolkit.stop()
    await toolkit.start()
    expect(forkSessionIds()).toEqual(['', 's1'])
    expect(native.log).toHaveBeenCalledWith('start: forking s1')
  })

  it('treats a fork on start that fails as non-fatal', async () => {
    const toolkit = await running(CONTINUE)
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    toolkit.stop()
    await toolkit.start()
    const errors: OpenAILiveError[] = []
    toolkit.addErrorListener((e) => errors.push(e))
    emitEvent('engine-1.liveNode', 'error', {
      type: 'invalid_request_error',
      message: 'The stored session was not found.',
    })
    emitEvent('engine-1.liveNode', 'sessionDisconnected', { reason: 'refused', reconnecting: true })
    expect(errors.map((e) => e.fatal)).toEqual([false])
  })

  it('start after setInstructions or release begins a new conversation', async () => {
    const toolkit = await running(CONTINUE)
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    toolkit.stop()
    toolkit.setInstructions('Be brief.')
    await toolkit.start()
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's2' })
    toolkit.release()
    await toolkit.start()
    expect(forkSessionIds()).toEqual(['', '', ''])
  })

  it('start continues a saved session', async () => {
    const toolkit = initialized(CONTINUE)
    await toolkit.start({ continueSessionId: 'saved' })
    expect(forkSessionIds()).toEqual(['saved'])
  })

  it('ignores a saved session without continueConversation', async () => {
    const toolkit = initialized()
    await toolkit.start({ continueSessionId: 'saved' })
    expect(forkSessionIds()).toEqual([])
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('continueSessionId ignored'))
  })

  it('newConversation replaces a live session and makes the next start fresh', async () => {
    const toolkit = await running(CONTINUE)
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    toolkit.newConversation()
    expect(commandsFor('resetSession')).toHaveLength(1)
    toolkit.stop()
    await toolkit.start()
    expect(forkSessionIds()).toEqual(['', ''])
  })

  it('newConversation on a stopped engine only forgets the session', async () => {
    const toolkit = await running(CONTINUE)
    emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
    toolkit.stop()
    toolkit.newConversation()
    expect(commandsFor('resetSession')).toHaveLength(0)
    await toolkit.start()
    expect(forkSessionIds()).toEqual(['', ''])
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

describe('Android', () => {
  const originalOS = Platform.OS
  let audioSession: Record<string, jest.Mock>
  let permission: jest.SpyInstance
  let version: jest.SpyInstance

  beforeEach(() => {
    Platform.OS = 'android'
    version = jest.spyOn(Platform, 'Version', 'get').mockReturnValue(34)
    audioSession = {
      startAudioSession: jest.fn().mockResolvedValue(undefined),
      stopAudioSession: jest.fn().mockResolvedValue(undefined),
    }
    NativeModules.OpenAILiveToolkitAndroid = audioSession
    permission = jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED)
  })

  afterEach(() => {
    Platform.OS = originalOS
    version.mockRestore()
    delete NativeModules.OpenAILiveToolkitAndroid
    permission.mockRestore()
    // Toolkits from earlier tests would hear the network events.
    DeviceEventEmitter.removeAllListeners(NETWORK_CHANGED_EVENT)
    DeviceEventEmitter.removeAllListeners(AUDIO_FOCUS_CHANGED_EVENT)
  })

  it('lowers media while the user speaks only on the loudspeaker', async () => {
    audioSession.isOnSpeaker = jest.fn(() => false)
    await running({ ...CREDS, media: true })
    const gains = () => setValuesFor('mediaVolumeNode', 'gain').map((c) => c.params.value)
    emitEvent('engine-1.vadNode', 'speechStarted')
    expect(gains()).toEqual([])
    emitEvent('engine-1.vadNode', 'speechEnded')
    audioSession.isOnSpeaker.mockReturnValue(true)
    emitEvent('engine-1.vadNode', 'speechStarted')
    expect(gains()).toEqual([0.1])
  })

  it('asks for RECORD_AUDIO through PermissionsAndroid', async () => {
    await running()
    expect(permission).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
    expect(native.requestMicrophonePermission).not.toHaveBeenCalled()
  })

  it('asks for notifications on Android 13+, for the foreground service', async () => {
    await running()
    expect(permission).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
  })

  it('does not ask for notifications before Android 13', async () => {
    version.mockReturnValue(32)
    await running()
    expect(permission).not.toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
  })

  it('starts when notifications are denied', async () => {
    permission.mockImplementation(async (name: string) =>
      name === PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        ? PermissionsAndroid.RESULTS.DENIED
        : PermissionsAndroid.RESULTS.GRANTED
    )
    const toolkit = await running()
    expect(toolkit.isRunning).toBe(true)
    expect(audioSession.startAudioSession).toHaveBeenCalled()
  })

  it('throws when RECORD_AUDIO is denied', async () => {
    permission.mockResolvedValue(PermissionsAndroid.RESULTS.DENIED)
    await expect(initialized().start()).rejects.toMatchObject({ code: 'MIC_PERMISSION_DENIED' })
    expect(audioSession.startAudioSession).not.toHaveBeenCalled()
  })

  it('opens the mic and speaker for voice communication', async () => {
    await running({ ...CREDS, echoCancelledInput: true })
    const configuration = engineConfig().configuration
    expect(configuration.inputPreset).toBe('VOICE_COMMUNICATION')
    expect(configuration.outputUsage).toBe('USAGE_VOICE_COMMUNICATION')
    expect(configuration.voiceProcessingEnabled).toBeUndefined()
    expect(configuration.prefersEchoCancelledInput).toBeUndefined()
  })

  it('starts the audio session before the engine and stops it after', async () => {
    audioSession.startAudioSession.mockImplementation(async () => {
      expect(commandsFor('start')).toHaveLength(0)
    })
    const toolkit = await running()
    expect(audioSession.startAudioSession).toHaveBeenCalledTimes(1)
    expect(audioSession.stopAudioSession).not.toHaveBeenCalled()
    toolkit.stop()
    expect(audioSession.stopAudioSession).toHaveBeenCalledTimes(1)
  })

  it('takes the audio focus that pauses other apps', async () => {
    await running()
    expect(audioSession.startAudioSession).toHaveBeenCalledWith(false)
  })

  it('with mixWithOthers, takes the audio focus that lets other apps play on', async () => {
    await running({ ...CREDS, mixWithOthers: true })
    expect(audioSession.startAudioSession).toHaveBeenCalledWith(true)
  })

  it('logs audio focus changes', async () => {
    await running({ ...CREDS, logFile: true })
    DeviceEventEmitter.emit(AUDIO_FOCUS_CHANGED_EVENT, 'lost')
    expect(logged()).toContain('audio focus: lost')
  })

  it('starts the engine when the audio session fails', async () => {
    audioSession.startAudioSession.mockRejectedValue(new Error('no route'))
    const toolkit = await running()
    expect(toolkit.isRunning).toBe(true)
  })

  it('stops the audio session when the engine refuses to start', async () => {
    scriptNative((req) => {
      if (req.params?.actionName === 'createEngine') return makeRpcResponse('engine-1')
      if (req.params?.actionName === 'start')
        return makeRpcResponse(undefined, { code: -1, message: 'mic busy' })
      return makeRpcResponse(null)
    })
    await expect(initialized().start()).rejects.toMatchObject({ code: 'ENGINE_START_FAILED' })
    expect(audioSession.stopAudioSession).toHaveBeenCalledTimes(1)
  })

  it('keeps the audio session when the engine refuses to stop', async () => {
    const toolkit = await running()
    scriptNative(() => makeRpcResponse(undefined, { code: -1, message: 'nope' }))
    expect(() => toolkit.stop()).toThrow(OpenAILiveError)
    expect(audioSession.stopAudioSession).not.toHaveBeenCalled()
  })
  describe('native timers', () => {
    // Pending ones by id; the native module resolves a cancelled timer with false.
    let timers: Map<number, { ms: number; resolve: (fired: boolean) => void }>

    beforeEach(() => {
      timers = new Map()
      audioSession.setTimer = jest.fn(
        (id: number, ms: number) =>
          new Promise<boolean>((resolve) => timers.set(id, { ms, resolve }))
      )
      audioSession.cancelTimer = jest.fn((id: number) => {
        timers.get(id)?.resolve(false)
        timers.delete(id)
      })
    })

    async function fire(ms: number) {
      const [id, timer] = [...timers].find(([, t]) => t.ms === ms) ?? []
      expect(timer).toBeDefined()
      timers.delete(id!)
      timer!.resolve(true)
      await flush()
    }

    describe('idle mode', () => {
      async function live() {
        const toolkit = await running({ ...CREDS, idleTimeoutMs: 10_000 })
        emitEvent('engine-1.liveNode', 'sessionStarted', { sessionId: 's1' })
        return toolkit
      }

      it('counts down natively, since JS timers stop in the background', async () => {
        await live()
        await fire(10_000)
        expect(commandFor('endSession')).toBeDefined()
      })

      it('ignores a timer that was cancelled', async () => {
        await live()
        emitEvent('engine-1.liveNode', 'inputTranscriptDelta', { delta: 'hi' })
        expect(audioSession.cancelTimer).toHaveBeenCalled()
        await flush()
        expect(commandFor('endSession')).toBeUndefined()
      })

      it('cancels the native timer on stop', async () => {
        const toolkit = await live()
        toolkit.stop()
        expect(timers.size).toBe(0)
      })
    })

    describe('offline notice', () => {
      beforeEach(() => {
        audioSession.isNetworkAvailable = jest.fn(() => true)
        audioSession.watchNetwork = jest.fn()
        audioSession.synthesizeSpeech = jest.fn().mockResolvedValue('/mock/caches/tts.wav')
      })

      it("watches the network and speaks with the device's text-to-speech", async () => {
        await running({ ...CREDS, offlineNotice: true })
        expect(audioSession.watchNetwork).toHaveBeenCalled()
        DeviceEventEmitter.emit(NETWORK_CHANGED_EVENT, false)
        await fire(3_000)
        expect(audioSession.synthesizeSpeech).toHaveBeenCalledWith(
          "I've lost the connection. I'll be back when it returns.",
          'en-US'
        )
        expect(native.synthesizeSpeech).not.toHaveBeenCalled()
        const notice = commandsFor('load').find((c) => c.params.objectURI === 'noticePlayerNode')
        expect(notice.params.params).toEqual({ audioFilePath: '/mock/caches/tts.wav' })
      })

      it('says nothing for a short drop', async () => {
        await running({ ...CREDS, offlineNotice: true })
        DeviceEventEmitter.emit(NETWORK_CHANGED_EVENT, false)
        DeviceEventEmitter.emit(NETWORK_CHANGED_EVENT, true)
        expect(timers.size).toBe(0)
        expect(audioSession.synthesizeSpeech).not.toHaveBeenCalled()
      })
    })
  })

  describe('logs', () => {
    const DEVICE = 'app Example 1.0 (1), com.example, Android 16 (API 36), Google Pixel 6a'

    beforeEach(() => {
      audioSession.getConstants = jest.fn(() => ({
        documentsPath: '/mock/documents',
        cachePath: '/mock/caches',
        device: DEVICE,
      }))
      audioSession.zipFiles = jest.fn().mockResolvedValue('')
      audioSession.shareFile = jest.fn().mockResolvedValue(undefined)
    })

    it('starts the log with the app and device', () => {
      initialized({ ...CREDS, logFile: true })
      expect(logged()).toContain(DEVICE)
    })

    it('zips the diagnostic recordings with the log and shares the zip', async () => {
      const toolkit = await running({ ...CREDS, logFile: true, diagnosticAudioSeconds: 60 })
      scriptNative((req) =>
        req.params?.actionName === 'dump'
          ? makeRpcResponse(`${req.params.params.filePath}_recording.wav`)
          : makeRpcResponse(null)
      )
      await toolkit.shareLogs()
      expect(audioSession.zipFiles).toHaveBeenCalledWith(
        [
          '/mock/caches/openai-live-toolkit-log.txt',
          '/mock/caches/mic_recording.wav',
          '/mock/caches/heard_recording.wav',
          '/mock/caches/output_recording.wav',
          '/mock/caches/labels.txt',
        ].join('\n'),
        '/mock/caches/openai-live-toolkit-logs.zip'
      )
      expect(native.zipFiles).not.toHaveBeenCalled()
      expect(audioSession.shareFile).toHaveBeenCalledWith(
        '/mock/caches/openai-live-toolkit-logs.zip'
      )
    })

    it("rejects when the zip can't be made", async () => {
      audioSession.zipFiles.mockResolvedValue('disk full')
      const toolkit = await running({ ...CREDS, logFile: true, diagnosticAudioSeconds: 60 })
      scriptNative((req) =>
        req.params?.actionName === 'dump'
          ? makeRpcResponse(`${req.params.params.filePath}_recording.wav`)
          : makeRpcResponse(null)
      )
      await expect(toolkit.shareLogs()).rejects.toThrow("Couldn't zip the logs: disk full")
      expect(audioSession.shareFile).not.toHaveBeenCalled()
    })
  })
})
