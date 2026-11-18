#pragma once

// Codegen-generated C++ TurboModule spec for `src/NativeOpenAILiveToolkit.ts`.
// The umbrella header name comes from package.json `codegenConfig.name`.
#include <RNOpenAILiveToolkitSpecJSI.h>

#include <functional>
#include <memory>
#include <string>

#include <react/bridging/Promise.h>
#include <switchboard/SwitchboardJSONRPC.hpp>

#include "PlatformHooks.hpp"

namespace facebook::react {

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
  bool isBluetoothConnected(jsi::Runtime& rt);
  void setNowPlaying(jsi::Runtime& rt, std::string info);
  void duckOtherApps(jsi::Runtime& rt, bool duck, std::string engine);
  void setOtherAudioResumable(jsi::Runtime& rt, bool resumable);
  AsyncPromise<std::string> synthesizeSpeech(jsi::Runtime& rt, std::string text, std::string language);
  bool isOtherAudioPlaying(jsi::Runtime& rt);
  bool isNetworkAvailable(jsi::Runtime& rt);
  std::string zipFiles(jsi::Runtime& rt, std::string paths, std::string zipPath);

  /** Called by the iOS provider when the audio route changes. */
  void notifyBluetoothChanged(bool connected);
  /** Called by the iOS provider when a Now Playing button is pressed. */
  void notifyRemoteCommand(const std::string& command);
  /** Called by the iOS provider when the device gains or loses its network path. */
  void notifyNetworkChanged(bool available);
  /** Called by the iOS provider after each change to other apps' ducking. */
  void notifyOtherAppsDuckChanged(bool ducked);

  /** Set by the iOS provider at startup. Android reads it from the JVM module instead. */
  static void setDocumentsPath(const std::string& path);
  /** Set by the iOS provider at startup. Android reads it from the JVM module instead. */
  static void setCachePath(const std::string& path);
  /** Set by the iOS provider to perform the mic-permission request. Android asks from JS. */
  static void setMicrophonePermissionHook(openailivetoolkit::MicrophonePermissionHook hook);
  /** Set by the iOS provider. Without it (Android) no Bluetooth device is reported. */
  static void setBluetoothConnectedHook(openailivetoolkit::BluetoothConnectedHook hook);
  /** Set by the iOS provider. Without it (Android) there's no Now Playing. */
  static void setNowPlayingHook(openailivetoolkit::NowPlayingHook hook);
  /** Set by the iOS provider. Without them (Android) nothing is ducked. */
  static void setOtherAppsDuckHooks(openailivetoolkit::OtherAppsDuckHooks hooks);
  /**
   * Set by the iOS provider. Without them (Android) nothing is spoken, the network counts as up,
   * no other app counts as playing and nothing is zipped.
   */
  static void setDeviceHooks(openailivetoolkit::DeviceHooks hooks);

private:
  switchboard::SwitchboardJSONRPC switchboard;
};

} // namespace facebook::react
