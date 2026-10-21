#pragma once

// Codegen-generated C++ TurboModule spec for `src/NativeOpenAILiveToolkit.ts`.
// The umbrella header name comes from package.json `codegenConfig.name`.
#include <RNOpenAILiveToolkitSpecJSI.h>

#include <functional>
#include <memory>
#include <string>

#include <react/bridging/Promise.h>
#include <switchboard/SwitchboardJSONRPC.hpp>

namespace facebook::react {

// Platform-provided mic-permission request; calls the completion with the
// grant result (async, may complete on any thread).
using MicrophonePermissionHook = std::function<void(std::function<void(bool)>)>;

/**
 * OpenAILiveToolkit's native core: a C++ TurboModule wrapping `SwitchboardJSONRPC`.
 *
 * The entire SDK is driven over one JSON-RPC string channel (`processCommand`),
 * and SDK events are pushed to JS through the generated `emitOnEventReceived`.
 * Compiled by the podspec on iOS and by android/CMakeLists.txt on Android.
 */
class NativeOpenAILiveToolkit : public NativeOpenAILiveToolkitCxxSpec<NativeOpenAILiveToolkit> {
public:
  NativeOpenAILiveToolkit(std::shared_ptr<CallInvoker> jsInvoker);

  std::string processCommand(jsi::Runtime& rt, std::string command);
  std::string getDocumentsPath(jsi::Runtime& rt);
  std::string getCachePath(jsi::Runtime& rt);
  bool writeFile(jsi::Runtime& rt, std::string path, std::string contents);
  AsyncPromise<bool> requestMicrophonePermission(jsi::Runtime& rt);
  bool isSpeakerIsolationSupported(jsi::Runtime& rt);
  void startLogFile(jsi::Runtime& rt, std::string directory);
  void log(jsi::Runtime& rt, std::string message);
  std::string exportLogFile(jsi::Runtime& rt);

  /** Set by the iOS provider at startup. Android reads it from the JVM module instead. */
  static void setDocumentsPath(const std::string& path);
  /** Set by the iOS provider at startup. Android reads it from the JVM module instead. */
  static void setCachePath(const std::string& path);
  /** Set by the iOS provider to perform the mic-permission request. Android asks from JS. */
  static void setMicrophonePermissionHook(MicrophonePermissionHook hook);

private:
  switchboard::SwitchboardJSONRPC switchboard;
};

} // namespace facebook::react
