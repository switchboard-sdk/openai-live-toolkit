#import <XCTest/XCTest.h>

#import "OpenAILiveToolkitAudioRoute.h"

using namespace openailivetoolkit;

static NSArray<AVAudioSessionPort> *BluetoothPorts() {
  return @[ AVAudioSessionPortBluetoothHFP, AVAudioSessionPortBluetoothA2DP, AVAudioSessionPortBluetoothLE ];
}

static NSArray<AVAudioSessionPort> *WiredAndBuiltInPorts() {
  return @[
    AVAudioSessionPortBuiltInSpeaker, AVAudioSessionPortBuiltInReceiver, AVAudioSessionPortBuiltInMic,
    AVAudioSessionPortHeadphones, AVAudioSessionPortHeadsetMic, AVAudioSessionPortLineOut, AVAudioSessionPortLineIn,
    AVAudioSessionPortUSBAudio, AVAudioSessionPortHDMI, AVAudioSessionPortAirPlay, AVAudioSessionPortCarAudio
  ];
}

@interface AudioRouteTests : XCTestCase
@end

@implementation AudioRouteTests

- (void)testBluetoothPorts {
  for (AVAudioSessionPort port in BluetoothPorts()) {
    XCTAssertTrue(IsBluetoothPort(port), @"%@", port);
  }
}

- (void)testOtherPortsAreNotBluetooth {
  for (AVAudioSessionPort port in WiredAndBuiltInPorts()) {
    XCTAssertFalse(IsBluetoothPort(port), @"%@", port);
  }
  XCTAssertFalse(IsBluetoothPort(nil));
}

- (void)testVoiceProcessingOnTheSpeakerAndReceiver {
  XCTAssertTrue(IsVoiceProcessingRoute(AVAudioSessionPortBuiltInSpeaker, false));
  XCTAssertTrue(IsVoiceProcessingRoute(AVAudioSessionPortBuiltInReceiver, false));
}

- (void)testNoVoiceProcessingWithEchoCancelledInput {
  XCTAssertFalse(IsVoiceProcessingRoute(AVAudioSessionPortBuiltInSpeaker, true));
  XCTAssertFalse(IsVoiceProcessingRoute(AVAudioSessionPortBuiltInReceiver, true));
}

- (void)testNoVoiceProcessingElsewhere {
  NSMutableArray<AVAudioSessionPort> *ports = [BluetoothPorts() mutableCopy];
  [ports addObjectsFromArray:WiredAndBuiltInPorts()];
  [ports removeObjectsInArray:@[ AVAudioSessionPortBuiltInSpeaker, AVAudioSessionPortBuiltInReceiver ]];
  for (AVAudioSessionPort port in ports) {
    XCTAssertFalse(IsVoiceProcessingRoute(port, false), @"%@", port);
  }
  XCTAssertFalse(IsVoiceProcessingRoute(nil, false));
}

@end
