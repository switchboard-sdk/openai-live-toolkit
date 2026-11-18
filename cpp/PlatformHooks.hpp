#pragma once

#include <functional>
#include <optional>
#include <string>
#include <utility>

namespace openailivetoolkit {

// Platform-provided mic-permission request; calls the completion with the grant result, or with
// why it couldn't ask (async, may complete on any thread).
using MicrophonePermissionCompletion = std::function<void(bool granted, const std::string& error)>;
using MicrophonePermissionHook = std::function<void(MicrophonePermissionCompletion)>;

// Platform-provided check: a Bluetooth microphone is available, or audio goes to Bluetooth.
using BluetoothConnectedHook = std::function<bool()>;

// Platform-provided Now Playing: shows the JSON info and takes the system's media buttons; '' clears it.
using NowPlayingHook = std::function<void(const std::string&)>;

// Platform-provided lowering of other apps through an engine's session.
struct OtherAppsDuckHooks {
  // Lower other apps (true) or bring them back (false), through the engine's session.
  std::function<void(bool, const std::string&)> duck;
  // Whether the app plays again what a change pauses.
  std::function<void(bool)> setResumable;
};

// Platform-provided speech, network and other apps' audio state.
struct DeviceHooks {
  // Text and a language such as "en-US"; completes with a WAV file's path, or "".
  std::function<void(const std::string&, const std::string&, std::function<void(std::string)>)> synthesize;
  std::function<bool()> networkAvailable;
  std::function<bool()> otherAudioPlaying;
  // Newline-separated files packed into one zip; "" when done, or why not.
  std::function<std::string(const std::string&, const std::string&)> zip;
  // The app, its version and build, the OS version and the device model, on one line.
  std::function<std::string()> describe;
};

/**
 * The hooks the iOS provider sets, and what each call does without its hook, as on Android: the
 * microphone counts as granted (Android asks from JS), no Bluetooth device, Now Playing or ducking,
 * nothing spoken, the network up, no other app playing, nothing zipped and no device description.
 */
struct PlatformHooks {
  MicrophonePermissionHook microphonePermission;
  BluetoothConnectedHook bluetoothConnected;
  NowPlayingHook nowPlaying;
  OtherAppsDuckHooks otherAppsDuck;
  DeviceHooks device;

  void requestMicrophonePermission(MicrophonePermissionCompletion completion) const {
    if (!microphonePermission) {
      completion(true, "");
      return;
    }
    microphonePermission(std::move(completion));
  }

  bool isBluetoothConnected() const {
    return bluetoothConnected && bluetoothConnected();
  }

  void setNowPlaying(const std::string& info) const {
    if (!nowPlaying) {
      return;
    }
    nowPlaying(info);
  }

  void duckOtherApps(bool duck, const std::string& engine) const {
    if (!otherAppsDuck.duck) {
      return;
    }
    otherAppsDuck.duck(duck, engine);
  }

  void setOtherAudioResumable(bool resumable) const {
    if (!otherAppsDuck.setResumable) {
      return;
    }
    otherAppsDuck.setResumable(resumable);
  }

  void synthesizeSpeech(
      const std::string& text, const std::string& language, std::function<void(std::string)> completion
  ) const {
    if (!device.synthesize) {
      completion("");
      return;
    }
    device.synthesize(text, language, std::move(completion));
  }

  bool isNetworkAvailable() const {
    return !device.networkAvailable || device.networkAvailable();
  }

  bool isOtherAudioPlaying() const {
    return device.otherAudioPlaying && device.otherAudioPlaying();
  }

  std::string zipFiles(const std::string& paths, const std::string& zipPath) const {
    return device.zip ? device.zip(paths, zipPath) : "Zipping isn't supported on this platform.";
  }

  std::optional<std::string> describeDevice() const {
    if (!device.describe) {
      return std::nullopt;
    }
    return device.describe();
  }
};

} // namespace openailivetoolkit
