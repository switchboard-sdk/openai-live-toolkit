jest.mock('./NativeOpenAILiveToolkit')

import { checkSdkEvent, happyPath, nativeMock, running, sdkEventsChecked } from './test-helpers'

beforeEach(() => {
  nativeMock.resetNativeMock()
  happyPath()
})

// Needs `npm run sdk:schema`, which CI runs.
const withSchema = sdkEventsChecked ? describe : describe.skip

withSchema("events checked against the SDK's schema", () => {
  it('passes events as the SDK sends them', async () => {
    await running()
    expect(() =>
      checkSdkEvent('engine-1.liveNode', 'sessionDisconnected', {
        reason: 'unreachable',
        reconnecting: true,
      })
    ).not.toThrow()
    expect(() =>
      checkSdkEvent('switchboard.engine-1', 'stateChanged', { state: 'running' })
    ).not.toThrow()
  })

  it("rejects an event the node doesn't send", async () => {
    await running()
    expect(() => checkSdkEvent('engine-1.liveNode', 'sessionLost')).toThrow(
      'OpenAI.Live has no sessionLost event'
    )
  })

  it("rejects a field the event doesn't have, or of another type", async () => {
    await running()
    expect(() => checkSdkEvent('engine-1.liveNode', 'sessionStarted', { id: 's1' })).toThrow(
      'OpenAI.Live sessionStarted has no id'
    )
    expect(() =>
      checkSdkEvent('engine-1.liveNode', 'sessionDisconnected', { reconnecting: 'yes' })
    ).toThrow('OpenAI.Live sessionDisconnected reconnecting is a boolean')
  })

  it("rejects a node the graph doesn't have", async () => {
    await running()
    expect(() => checkSdkEvent('engine-1.mediaPlayerNode', 'stateChanged')).toThrow(
      'No mediaPlayerNode node in the graph'
    )
  })
})
