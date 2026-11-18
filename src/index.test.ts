jest.mock('./NativeOpenAILiveToolkit')

import { NativeModules, Platform } from 'react-native'
import { getDocumentsPath, writeFile } from './index'
import NativeOpenAILiveToolkit from './NativeOpenAILiveToolkit'

const native = NativeOpenAILiveToolkit as unknown as {
  getDocumentsPath: jest.Mock<string, []>
  writeFile: jest.Mock<boolean, [string, string]>
}

// Smoke test for the real functions the barrel exposes (the rest are
// type/re-exports). They're thin passthroughs to native, so we only verify the
// delegation — a rename on either side would surface here.

describe('filesystem passthroughs', () => {
  it('getDocumentsPath delegates to the native module', () => {
    native.getDocumentsPath.mockReturnValue('/docs')
    expect(getDocumentsPath()).toBe('/docs')
    expect(native.getDocumentsPath).toHaveBeenCalled()
  })

  it('getDocumentsPath reads the JVM module on Android', () => {
    native.getDocumentsPath.mockClear()
    const originalOS = Platform.OS
    Platform.OS = 'android'
    NativeModules.OpenAILiveToolkitAndroid = {
      getConstants: () => ({ documentsPath: '/data/user/0/app/files' }),
    }
    try {
      expect(getDocumentsPath()).toBe('/data/user/0/app/files')
      expect(native.getDocumentsPath).not.toHaveBeenCalled()
    } finally {
      Platform.OS = originalOS
      delete NativeModules.OpenAILiveToolkitAndroid
    }
  })

  it('writeFile delegates to the native module', () => {
    native.writeFile.mockReturnValue(true)
    expect(writeFile('/docs/log.txt', 'hello')).toBe(true)
    expect(native.writeFile).toHaveBeenCalledWith('/docs/log.txt', 'hello')
  })
})
