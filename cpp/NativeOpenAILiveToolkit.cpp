#include "NativeOpenAILiveToolkit.h"

#include <fstream>

// Switchboard extensions. Each must be loaded once, before any graph that uses
// it is built — hence the constructor below. Headers resolve via the per-
// framework `include/` dirs added to the build's header search paths.
#include "AICousticsExtension.hpp"
#include "OpenAIExtension.hpp"

namespace facebook::react {

NativeOpenAILiveToolkit::NativeOpenAILiveToolkit(std::shared_ptr<CallInvoker> jsInvoker)
    : NativeOpenAILiveToolkitCxxSpec(std::move(jsInvoker)) {
  // Register extensions with the SDK.
  switchboard::extensions::openai::OpenAIExtension::load();
  switchboard::extensions::aicoustics::AICousticsExtension::load();

  // Forward every SDK event to JS via the codegen-generated emitter.
  switchboard.setEventCallback(
      [this](const std::string& event) { emitOnEventReceived(event); });
}

static std::string s_documentsPath;
static MicrophonePermissionHook s_micPermissionHook;

void NativeOpenAILiveToolkit::setDocumentsPath(const std::string& path) {
  s_documentsPath = path;
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
    // No hook (tests): nothing to ask.
    promise.resolve(true);
  }
  return promise;
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

std::string NativeOpenAILiveToolkit::processCommand(jsi::Runtime& rt,
                                            std::string command) {
  return switchboard.processCommand(command);
}

} // namespace facebook::react
