#import <XCTest/XCTest.h>

#include <optional>

#include "PlatformHooks.hpp"

using namespace openailivetoolkit;

@interface PlatformHooksTests : XCTestCase
@end

// Without hooks is how Android runs.
@implementation PlatformHooksTests

- (void)testOtherAudioPlaying {
  PlatformHooks hooks;
  XCTAssertFalse(hooks.isOtherAudioPlaying());

  hooks.device.otherAudioPlaying = [] { return true; };
  XCTAssertTrue(hooks.isOtherAudioPlaying());
  hooks.device.otherAudioPlaying = [] { return false; };
  XCTAssertFalse(hooks.isOtherAudioPlaying());
}

- (void)testNetworkAvailable {
  PlatformHooks hooks;
  XCTAssertTrue(hooks.isNetworkAvailable());

  hooks.device.networkAvailable = [] { return false; };
  XCTAssertFalse(hooks.isNetworkAvailable());
  hooks.device.networkAvailable = [] { return true; };
  XCTAssertTrue(hooks.isNetworkAvailable());
}

- (void)testBluetoothConnected {
  PlatformHooks hooks;
  XCTAssertFalse(hooks.isBluetoothConnected());

  hooks.bluetoothConnected = [] { return true; };
  XCTAssertTrue(hooks.isBluetoothConnected());
}

- (void)testMicrophonePermission {
  PlatformHooks hooks;
  std::optional<bool> granted;
  hooks.requestMicrophonePermission([&](bool result) { granted = result; });
  XCTAssertTrue(granted == true);

  hooks.microphonePermission = [](std::function<void(bool)> completion) { completion(false); };
  hooks.requestMicrophonePermission([&](bool result) { granted = result; });
  XCTAssertTrue(granted == false);
}

- (void)testNowPlaying {
  PlatformHooks hooks;
  hooks.setNowPlaying("{}");

  std::string shown = "none";
  hooks.nowPlaying = [&](const std::string &info) { shown = info; };
  hooks.setNowPlaying("");
  XCTAssertEqualObjects(@(shown.c_str()), @"");
}

- (void)testDuckOtherApps {
  PlatformHooks hooks;
  hooks.duckOtherApps(true, "engine-1");
  hooks.setOtherAudioResumable(true);

  std::optional<bool> ducked;
  std::optional<bool> resumable;
  std::string engine;
  hooks.otherAppsDuck = {
      .duck =
          [&](bool duck, const std::string &on) {
            ducked = duck;
            engine = on;
          },
      .setResumable = [&](bool value) { resumable = value; },
  };
  hooks.duckOtherApps(true, "engine-1");
  hooks.setOtherAudioResumable(true);
  XCTAssertTrue(ducked == true);
  XCTAssertTrue(resumable == true);
  XCTAssertEqualObjects(@(engine.c_str()), @"engine-1");
}

- (void)testSynthesizeSpeech {
  PlatformHooks hooks;
  std::optional<std::string> path;
  hooks.synthesizeSpeech("Hi", "en-US", [&](std::string result) { path = result; });
  XCTAssertTrue(path == "");

  hooks.device.synthesize = [](const std::string &text, const std::string &language,
                               std::function<void(std::string)> completion) {
    completion("/caches/" + language + "-" + text + ".wav");
  };
  hooks.synthesizeSpeech("Hi", "en-US", [&](std::string result) { path = result; });
  XCTAssertTrue(path == "/caches/en-US-Hi.wav");
}

- (void)testZipFiles {
  PlatformHooks hooks;
  XCTAssertEqualObjects(@(hooks.zipFiles("/a\n/b", "/logs.zip").c_str()), @"Zipping isn't supported on this platform.");

  hooks.device.zip = [](const std::string &paths, const std::string &zipPath) { return ""; };
  XCTAssertEqualObjects(@(hooks.zipFiles("/a\n/b", "/logs.zip").c_str()), @"");
}

- (void)testDescribeDevice {
  PlatformHooks hooks;
  XCTAssertFalse(hooks.describeDevice().has_value());

  hooks.device.describe = [] { return "app Example 1.0 (1)"; };
  XCTAssertTrue(hooks.describeDevice() == "app Example 1.0 (1)");
}

@end
