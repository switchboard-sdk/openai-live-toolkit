//
//  OpenAILiveToolkitModuleProvider.mm
//  OpenAILiveToolkit
//

#import "OpenAILiveToolkitModuleProvider.h"

#import <AVFAudio/AVFAudio.h>
#import <ReactCommon/CallInvoker.h>
#import <ReactCommon/TurboModule.h>

#import "NativeOpenAILiveToolkit.h"

static BOOL IsBluetoothPort(AVAudioSessionPort type) {
  return [type isEqualToString:AVAudioSessionPortBluetoothHFP] ||
      [type isEqualToString:AVAudioSessionPortBluetoothA2DP] ||
      [type isEqualToString:AVAudioSessionPortBluetoothLE];
}

// A Bluetooth microphone is available, or audio already goes to Bluetooth. A device without a
// microphone, like a speaker, only shows up once it's the output.
static bool IsBluetoothConnected() {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  for (AVAudioSessionPortDescription *port in session.availableInputs) {
    if (IsBluetoothPort(port.portType)) {
      return true;
    }
  }
  for (AVAudioSessionPortDescription *port in session.currentRoute.outputs) {
    if (IsBluetoothPort(port.portType)) {
      return true;
    }
  }
  return false;
}

// One observer at a time: a JS reload builds a new module.
static id s_routeObserver;

@implementation OpenAILiveToolkitModuleProvider

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  // Hand the C++ module a writable location for recordings/logs.
  NSArray<NSString *> *paths =
      NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
  NSString *documentsDir = paths.firstObject;
  if (documentsDir) {
    facebook::react::NativeOpenAILiveToolkit::setDocumentsPath(
        std::string(documentsDir.UTF8String));
  }
  // Caches aren't backed up, so the log stays on the device.
  NSString *cacheDir =
      NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES).firstObject;
  if (cacheDir) {
    facebook::react::NativeOpenAILiveToolkit::setCachePath(std::string(cacheDir.UTF8String));
  }

  // Mic-permission request lives here — the C++ module can't reach AVFoundation.
  // Prompts once; a prior decision resolves without UI.
  facebook::react::NativeOpenAILiveToolkit::setMicrophonePermissionHook(
      [](std::function<void(bool)> completion) {
        if (@available(iOS 17.0, *)) {
          [AVAudioApplication requestRecordPermissionWithCompletionHandler:^(BOOL granted) {
            completion(granted);
          }];
        } else {
          [[AVAudioSession sharedInstance] requestRecordPermission:^(BOOL granted) {
            completion(granted);
          }];
        }
      });

  facebook::react::NativeOpenAILiveToolkit::setBluetoothConnectedHook([]() {
    return IsBluetoothConnected();
  });

  auto module = std::make_shared<facebook::react::NativeOpenAILiveToolkit>(params.jsInvoker);
  std::weak_ptr<facebook::react::NativeOpenAILiveToolkit> weakModule = module;
  NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
  if (s_routeObserver) {
    [center removeObserver:s_routeObserver];
  }
  s_routeObserver = [center addObserverForName:AVAudioSessionRouteChangeNotification
                                        object:nil
                                         queue:nil
                                    usingBlock:^(NSNotification *note) {
                                      if (auto strong = weakModule.lock()) {
                                        strong->notifyBluetoothChanged(IsBluetoothConnected());
                                      }
                                    }];
  return module;
}

@end
