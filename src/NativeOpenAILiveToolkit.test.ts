describe('NativeOpenAILiveToolkit', () => {
  it('says how to fix a build without the native module', () => {
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ TurboModuleRegistry: { get: () => null } }))
      expect(() => jest.requireActual('./NativeOpenAILiveToolkit')).toThrow(
        /native module isn't in this app build/
      )
    })
  })
})
