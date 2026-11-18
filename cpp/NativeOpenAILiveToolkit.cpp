#include "NativeOpenAILiveToolkit.h"

#include <fstream>
#include <switchboard_core/Logger.hpp>

#include "LogFile.hpp"

// Switchboard extensions. Each must be loaded once, before any graph that uses
// it is built — hence the constructor below. Headers resolve via the per-
// framework `include/` dirs added to the build's header search paths.
// AICoustics is opt-in: the podspec defines OPENAI_LIVE_TOOLKIT_AICOUSTICS when
// it links the extension.
#include "OnnxExtension.hpp"
#include "OpenAIExtension.hpp"
#include "SileroVADExtension.hpp"
#if OPENAI_LIVE_TOOLKIT_AICOUSTICS
#include "AICousticsExtension.hpp"
#endif

namespace facebook::react {

NativeOpenAILiveToolkit::NativeOpenAILiveToolkit(std::shared_ptr<CallInvoker> jsInvoker)
    : NativeOpenAILiveToolkitCxxSpec(std::move(jsInvoker)) {
  // Register extensions with the SDK.
  switchboard::extensions::openai::OpenAIExtension::load();
  // Silero VAD runs on Onnx; used by idle mode.
  switchboard::extensions::onnx::OnnxExtension::load();
  switchboard::extensions::silerovad::SileroVADExtension::load();
#if OPENAI_LIVE_TOOLKIT_AICOUSTICS
  switchboard::extensions::aicoustics::AICousticsExtension::load();
#endif

  // Forward every SDK event to JS via the codegen-generated emitter.
  switchboard.setEventCallback(
      [this](const std::string& event) { emitOnEventReceived(event); });
}

static std::string s_documentsPath;
static std::string s_cachePath;
static openailivetoolkit::PlatformHooks s_hooks;

void NativeOpenAILiveToolkit::setDocumentsPath(const std::string& path) {
  s_documentsPath = path;
}

void NativeOpenAILiveToolkit::setCachePath(const std::string& path) {
  s_cachePath = path;
}

std::string NativeOpenAILiveToolkit::getCachePath(jsi::Runtime& rt) {
  return s_cachePath;
}

void NativeOpenAILiveToolkit::setMicrophonePermissionHook(openailivetoolkit::MicrophonePermissionHook hook) {
  s_hooks.microphonePermission = std::move(hook);
}

void NativeOpenAILiveToolkit::setBluetoothConnectedHook(openailivetoolkit::BluetoothConnectedHook hook) {
  s_hooks.bluetoothConnected = std::move(hook);
}

bool NativeOpenAILiveToolkit::isBluetoothConnected(jsi::Runtime& rt) {
  return s_hooks.isBluetoothConnected();
}

void NativeOpenAILiveToolkit::notifyBluetoothChanged(bool connected) {
  emitOnBluetoothChanged(connected);
}

void NativeOpenAILiveToolkit::setNowPlayingHook(openailivetoolkit::NowPlayingHook hook) {
  s_hooks.nowPlaying = std::move(hook);
}

void NativeOpenAILiveToolkit::setNowPlaying(jsi::Runtime& rt, std::string info) {
  s_hooks.setNowPlaying(info);
}

void NativeOpenAILiveToolkit::setOtherAppsDuckHooks(openailivetoolkit::OtherAppsDuckHooks hooks) {
  s_hooks.otherAppsDuck = std::move(hooks);
}

void NativeOpenAILiveToolkit::duckOtherApps(jsi::Runtime& rt, bool duck, std::string engine) {
  s_hooks.duckOtherApps(duck, engine);
}

void NativeOpenAILiveToolkit::setOtherAudioResumable(jsi::Runtime& rt, bool resumable) {
  s_hooks.setOtherAudioResumable(resumable);
}

void NativeOpenAILiveToolkit::notifyOtherAppsDuckChanged(bool ducked) {
  emitOnOtherAppsDuckChanged(ducked);
}

void NativeOpenAILiveToolkit::setDeviceHooks(openailivetoolkit::DeviceHooks hooks) {
  s_hooks.device = std::move(hooks);
}

AsyncPromise<std::string> NativeOpenAILiveToolkit::synthesizeSpeech(jsi::Runtime& rt,
                                                                    std::string text,
                                                                    std::string language) {
  AsyncPromise<std::string> promise(rt, jsInvoker_);
  s_hooks.synthesizeSpeech(text, language, [promise](std::string path) mutable { promise.resolve(path); });
  return promise;
}

bool NativeOpenAILiveToolkit::isOtherAudioPlaying(jsi::Runtime& rt) {
  return s_hooks.isOtherAudioPlaying();
}

bool NativeOpenAILiveToolkit::isNetworkAvailable(jsi::Runtime& rt) {
  return s_hooks.isNetworkAvailable();
}

std::string NativeOpenAILiveToolkit::zipFiles(jsi::Runtime& rt, std::string paths, std::string zipPath) {
  return s_hooks.zipFiles(paths, zipPath);
}

void NativeOpenAILiveToolkit::notifyNetworkChanged(bool available) {
  emitOnNetworkChanged(available);
}

void NativeOpenAILiveToolkit::notifyRemoteCommand(const std::string& command) {
  emitOnRemoteCommand(command);
}

std::string NativeOpenAILiveToolkit::getDocumentsPath(jsi::Runtime& rt) {
  return s_documentsPath;
}

AsyncPromise<bool> NativeOpenAILiveToolkit::requestMicrophonePermission(jsi::Runtime& rt) {
  AsyncPromise<bool> promise(rt, jsInvoker_);
  // resolve() hops back to the JS thread; the completion may fire on any thread.
  s_hooks.requestMicrophonePermission([promise](bool granted, const std::string& error) mutable {
    if (!error.empty()) {
      promise.reject(Error(error));
      return;
    }
    promise.resolve(granted);
  });
  return promise;
}

bool NativeOpenAILiveToolkit::isSpeakerIsolationSupported(jsi::Runtime& rt) {
#if OPENAI_LIVE_TOOLKIT_AICOUSTICS
  return true;
#else
  return false;
#endif
}

bool NativeOpenAILiveToolkit::writeFile(jsi::Runtime& rt, std::string path,
                                std::string contents) {
  std::ofstream file(path, std::ios::out | std::ios::trunc);
  if (!file.is_open()) {
    return false;
  }
  file << contents;
  return file.good();
}

void NativeOpenAILiveToolkit::startLogFile(jsi::Runtime& rt, std::string directory) {
  openailivetoolkit::LogFile::start(directory);
  // So every shared log says which build and device it came from.
  if (auto device = s_hooks.describeDevice()) {
    switchboard::Logger::info("[OpenAILiveToolkit] " + *device);
  }
}

void NativeOpenAILiveToolkit::log(jsi::Runtime& rt, std::string message) {
  switchboard::Logger::info("[OpenAILiveToolkit] " + message);
}

std::string NativeOpenAILiveToolkit::exportLogFile(jsi::Runtime& rt) {
  return openailivetoolkit::LogFile::exportFile();
}

std::string NativeOpenAILiveToolkit::processCommand(jsi::Runtime& rt,
                                            std::string command) {
  return switchboard.processCommand(command);
}

} // namespace facebook::react
