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
static MicrophonePermissionHook s_micPermissionHook;

void NativeOpenAILiveToolkit::setDocumentsPath(const std::string& path) {
  s_documentsPath = path;
}

void NativeOpenAILiveToolkit::setCachePath(const std::string& path) {
  s_cachePath = path;
}

std::string NativeOpenAILiveToolkit::getCachePath(jsi::Runtime& rt) {
  return s_cachePath;
}

void NativeOpenAILiveToolkit::setMicrophonePermissionHook(MicrophonePermissionHook hook) {
  s_micPermissionHook = std::move(hook);
}

std::string NativeOpenAILiveToolkit::getDocumentsPath(jsi::Runtime& rt) {
  return s_documentsPath;
}

AsyncPromise<bool> NativeOpenAILiveToolkit::requestMicrophonePermission(jsi::Runtime& rt) {
  AsyncPromise<bool> promise(rt, jsInvoker_);
  if (s_micPermissionHook) {
    // resolve() hops back to the JS thread; the completion may fire on any thread.
    s_micPermissionHook([promise](bool granted) mutable { promise.resolve(granted); });
  } else {
    // No hook (Android asks from JS, tests): nothing to ask.
    promise.resolve(true);
  }
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
