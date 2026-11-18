//
//  OpenAILiveToolkitModuleProvider.mm
//  OpenAILiveToolkit
//

#import "OpenAILiveToolkitModuleProvider.h"

#import <AVFAudio/AVFAudio.h>
#import <AVFoundation/AVFoundation.h>
#import <Network/Network.h>
#import <MediaPlayer/MediaPlayer.h>
#import <ReactCommon/CallInvoker.h>
#import <UIKit/UIKit.h>
#import <ReactCommon/TurboModule.h>

#import "NativeOpenAILiveToolkit.h"
#import "OpenAILiveToolkitAudioRoute.h"
#import "OpenAILiveToolkitOtherAppsDuck.h"
#import "OpenAILiveToolkitNowPlaying.h"

#include <atomic>
#include <mutex>
#include <sys/utsname.h>
#include <switchboard/Switchboard.hpp>
#include <switchboard_core/Logger.hpp>
#include <unistd.h>

// A Bluetooth microphone is available, or audio already goes to Bluetooth. A device without a
// microphone, like a speaker, only shows up once it's the output.
static bool IsBluetoothConnected() {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  for (AVAudioSessionPortDescription *port in session.availableInputs) {
    if (openailivetoolkit::IsBluetoothPort(port.portType)) {
      return true;
    }
  }
  for (AVAudioSessionPortDescription *port in session.currentRoute.outputs) {
    if (openailivetoolkit::IsBluetoothPort(port.portType)) {
      return true;
    }
  }
  return false;
}

static NSString *DescribePorts(NSArray<AVAudioSessionPortDescription *> *ports) {
  NSMutableArray<NSString *> *names = [NSMutableArray array];
  for (AVAudioSessionPortDescription *port in ports) {
    [names addObject:[NSString stringWithFormat:@"%@ (%@)", port.portType, port.portName]];
  }
  return names.count > 0 ? [names componentsJoinedByString:@", "] : @"none";
}

// The route, session and volume, to see how the system treats the toolkit's audio.
static void LogAudioSession(NSString *event) {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSString *line = [NSString
      stringWithFormat:@"[OpenAILiveToolkit] %@: output %@, input %@, %@, %@, options 0x%lx, volume %.2f",
                       event, DescribePorts(session.currentRoute.outputs),
                       DescribePorts(session.currentRoute.inputs), session.category, session.mode,
                       (unsigned long)session.categoryOptions, session.outputVolume];
  switchboard::Logger::info(line.UTF8String);
}

// e.g. "app Example 1.0 (5), com.example.app, iOS 26.1, iPhone17,1"
static std::string DescribeDevice() {
  NSBundle *bundle = NSBundle.mainBundle;
  NSString *name = [bundle objectForInfoDictionaryKey:@"CFBundleDisplayName"]
      ?: [bundle objectForInfoDictionaryKey:@"CFBundleName"];
  NSOperatingSystemVersion os = NSProcessInfo.processInfo.operatingSystemVersion;
  struct utsname system;
  uname(&system);
  NSString *line = [NSString
      stringWithFormat:@"app %@ %@ (%@), %@, iOS %ld.%ld.%ld, %s", name ?: @"?",
                       [bundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"?",
                       [bundle objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"?",
                       bundle.bundleIdentifier ?: @"?", (long)os.majorVersion, (long)os.minorVersion,
                       (long)os.patchVersion, system.machine];
  return line.UTF8String;
}

@interface OpenAILiveToolkitVolumeObserver : NSObject
@end

@implementation OpenAILiveToolkitVolumeObserver
- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary<NSKeyValueChangeKey, id> *)change
                       context:(void *)context {
  LogAudioSession(@"Volume changed");
}
@end

// One observer at a time: a JS reload builds a new module.
static id s_routeObserver;
static id s_activeObserver;
// Observes the session, which outlives modules, so it's added once.
static OpenAILiveToolkitVolumeObserver *s_volumeObserver;

// Runs it on the main thread, at once when already there.
static void OnMainThread(dispatch_block_t block) {
  if (NSThread.isMainThread) {
    block();
  } else {
    dispatch_sync(dispatch_get_main_queue(), block);
  }
}

static void SetNowPlaying(const std::string &info,
                          std::weak_ptr<facebook::react::NativeOpenAILiveToolkit> weakModule) {
  NSDictionary *fields = openailivetoolkit::ParseNowPlaying(info);
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!fields) {
      openailivetoolkit::ClearNowPlaying();
      return;
    }
    openailivetoolkit::AddRemoteCommandTargets(^(NSString *command) {
      if (auto strong = weakModule.lock()) {
        strong->notifyRemoteCommand(command.UTF8String);
      }
    });
    openailivetoolkit::ShowNowPlaying(fields);
  });
}

// Changing the session's options takes a few hundred ms, so ducking runs on its own queue.
static dispatch_queue_t DuckQueue() {
  static dispatch_queue_t queue;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    queue = dispatch_queue_create("com.synervoz.openailivetoolkit.duck", DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

static bool IsVoiceProcessingRoute() {
  AVAudioSession *session = AVAudioSession.sharedInstance;
  bool echoCancelledInput = false;
  if (@available(iOS 18.2, *)) {
    echoCancelledInput = session.prefersEchoCancelledInput;
  }
  return openailivetoolkit::IsVoiceProcessingRoute(session.currentRoute.outputs.firstObject.portType,
                                                   echoCancelledInput);
}

// The engine whose session ducks, from the last DuckOtherApps. DuckQueue only.
static std::string s_duckEngine;
// The module told of each change. DuckQueue only.
static std::weak_ptr<facebook::react::NativeOpenAILiveToolkit> s_duckModule;
// How long SetDuckOthers waits for the engine to change its session.
static const int DUCK_WAIT_MS = 2000;
static const int DUCK_POLL_MS = 50;

// One of the engine's boolean values; false without an engine.
static bool EngineFlag(const std::string &key) {
  if (s_duckEngine.empty()) {
    return false;
  }
  auto value = switchboard::Switchboard::getValue(s_duckEngine, key);
  return value.isSuccess() && switchboard::SBAny::convert<bool>(value.value());
}

// Sets the engine's duckOthers, which the engine applies to its session on its own queue, and waits
// for the session to have it. The engine tries a change iOS refuses again once the app is active.
// DuckQueue only.
static bool SetDuckOthers(bool duck) {
  if (s_duckEngine.empty()) {
    return false;
  }
  std::string change = duck ? "lower" : "raise";
  auto set = switchboard::Switchboard::setValue(s_duckEngine, "duckOthers", switchboard::SBAny(duck));
  if (set.isError()) {
    switchboard::Logger::error("[OpenAILiveToolkit] Couldn't " + change + " other apps: " + set.error().message);
    return false;
  }
  for (int waited = 0; waited < DUCK_WAIT_MS; waited += DUCK_POLL_MS) {
    if (EngineFlag("duckingOthers") == duck) {
      LogAudioSession(duck ? @"Other apps lowered" : @"Other apps back");
      return true;
    }
    usleep(DUCK_POLL_MS * 1000);
  }
  switchboard::Logger::error("[OpenAILiveToolkit] Couldn't " + change + " other apps: the session didn't change");
  return false;
}

static openailivetoolkit::OtherAppsDuck s_otherAppsDuck({
    .isVoiceProcessingRoute = [] { return IsVoiceProcessingRoute(); },
    .setDuckOthers = [](bool duck) { return SetDuckOthers(duck); },
    .otherAppPlays = [] { return (bool)AVAudioSession.sharedInstance.isOtherAudioPlaying; },
    .later =
        [](double seconds, std::function<void()> block) {
          dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), DuckQueue(), ^{
            block();
          });
        },
    .changed =
        [](bool ducked) {
          if (auto strong = s_duckModule.lock()) {
            strong->notifyOtherAppsDuckChanged(ducked);
          }
        },
    .log = [](const std::string &line) { switchboard::Logger::info("[OpenAILiveToolkit] " + line); },
});

static void RecheckOtherAppsDuck() {
  dispatch_async(DuckQueue(), ^{
    s_otherAppsDuck.update();
  });
}

static void DuckOtherApps(bool duck, const std::string &engine) {
  std::string on = engine;
  dispatch_async(DuckQueue(), ^{
    s_duckEngine = on;
    s_otherAppsDuck.setWanted(duck);
  });
}

static void SetOtherAudioResumable(bool resumable) {
  dispatch_async(DuckQueue(), ^{
    s_otherAppsDuck.setResumable(resumable);
  });
}

// Newline-separated files copied into a folder named after the zip, which the system zips when it's
// read for uploading. "" when done, or why not.
static std::string ZipFiles(const std::string &paths, const std::string &zipPath) {
  NSFileManager *files = NSFileManager.defaultManager;
  NSURL *zipURL = [NSURL fileURLWithPath:@(zipPath.c_str())];
  NSURL *folder = zipURL.URLByDeletingPathExtension;
  [files removeItemAtURL:folder error:nil];
  [files removeItemAtURL:zipURL error:nil];
  NSError *error = nil;
  if (![files createDirectoryAtURL:folder withIntermediateDirectories:YES attributes:nil error:&error]) {
    return error.localizedDescription.UTF8String;
  }
  for (NSString *path in [@(paths.c_str()) componentsSeparatedByString:@"\n"]) {
    if (path.length == 0) {
      continue;
    }
    NSURL *source = [NSURL fileURLWithPath:path];
    if (![files copyItemAtURL:source toURL:[folder URLByAppendingPathComponent:source.lastPathComponent] error:&error]) {
      [files removeItemAtURL:folder error:nil];
      return error.localizedDescription.UTF8String;
    }
  }
  __block NSError *moveError = nil;
  NSFileCoordinator *coordinator = [NSFileCoordinator new];
  [coordinator coordinateReadingItemAtURL:folder
                                  options:NSFileCoordinatorReadingForUploading
                                    error:&error
                               byAccessor:^(NSURL *zipped) {
                                 // The system's zip is gone after this block.
                                 [files moveItemAtURL:zipped toURL:zipURL error:&moveError];
                               }];
  [files removeItemAtURL:folder error:nil];
  NSError *failure = error ?: moveError;
  return failure ? failure.localizedDescription.UTF8String : "";
}

// The system's voice, for when the model can't be reached, rendered to a WAV file so it plays through
// the engine like the model's voice. The same words come from the same file. Main thread only.
static AVSpeechSynthesizer *s_speech;

static void SynthesizeSpeech(const std::string &text, const std::string &language,
                             std::function<void(std::string)> completion) {
  NSString *words = [NSString stringWithUTF8String:text.c_str()];
  NSString *voice = [NSString stringWithUTF8String:language.c_str()];
  NSString *cacheDir = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES).firstObject;
  NSString *name = [NSString stringWithFormat:@"openai-live-toolkit-speech-%@-%lx.wav", voice,
                                              (unsigned long)[words hash]];
  NSString *path = [cacheDir stringByAppendingPathComponent:name];
  if ([[NSFileManager defaultManager] fileExistsAtPath:path]) {
    completion(path.UTF8String);
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!s_speech) {
      s_speech = [AVSpeechSynthesizer new];
    }
    AVSpeechUtterance *utterance = [AVSpeechUtterance speechUtteranceWithString:words];
    utterance.voice = [AVSpeechSynthesisVoice voiceWithLanguage:voice];
    __block AVAudioFile *file = nil;
    __block BOOL failed = NO;
    std::function<void(std::string)> done = completion;
    [s_speech writeUtterance:utterance
            toBufferCallback:^(AVAudioBuffer *buffer) {
              AVAudioPCMBuffer *pcm = [buffer isKindOfClass:AVAudioPCMBuffer.class] ? (AVAudioPCMBuffer *)buffer : nil;
              // An empty buffer ends it.
              if (!pcm || pcm.frameLength == 0) {
                file = nil;
                done(failed ? "" : path.UTF8String);
                return;
              }
              if (failed) {
                return;
              }
              if (!file) {
                NSDictionary *settings = @{
                  AVFormatIDKey : @(kAudioFormatLinearPCM),
                  AVSampleRateKey : @(pcm.format.sampleRate),
                  AVNumberOfChannelsKey : @(pcm.format.channelCount),
                  AVLinearPCMBitDepthKey : @16,
                  AVLinearPCMIsFloatKey : @NO,
                  AVLinearPCMIsBigEndianKey : @NO,
                };
                file = [[AVAudioFile alloc] initForWriting:[NSURL fileURLWithPath:path]
                                                  settings:settings
                                              commonFormat:pcm.format.commonFormat
                                               interleaved:pcm.format.isInterleaved
                                                     error:nil];
              }
              failed = !file || ![file writeFromBuffer:pcm error:nil];
            }];
  });
}

// Started once and kept: a reload only points it at the new module.
static nw_path_monitor_t s_networkMonitor;
static std::atomic<bool> s_networkAvailable { true };
static std::weak_ptr<facebook::react::NativeOpenAILiveToolkit> s_networkModule;
static std::mutex s_networkModuleMutex;

static void MonitorNetwork(std::weak_ptr<facebook::react::NativeOpenAILiveToolkit> weakModule) {
  {
    std::lock_guard<std::mutex> lock(s_networkModuleMutex);
    s_networkModule = weakModule;
  }
  if (s_networkMonitor) {
    return;
  }
  s_networkMonitor = nw_path_monitor_create();
  nw_path_monitor_set_queue(s_networkMonitor,
                            dispatch_queue_create("com.synervoz.openailivetoolkit.network", DISPATCH_QUEUE_SERIAL));
  nw_path_monitor_set_update_handler(s_networkMonitor, ^(nw_path_t path) {
    bool available = nw_path_get_status(path) == nw_path_status_satisfied;
    if (s_networkAvailable.exchange(available) == available) {
      return;
    }
    std::shared_ptr<facebook::react::NativeOpenAILiveToolkit> module;
    {
      std::lock_guard<std::mutex> lock(s_networkModuleMutex);
      module = s_networkModule.lock();
    }
    if (module) {
      module->notifyNetworkChanged(available);
    }
  });
  nw_path_monitor_start(s_networkMonitor);
}

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
      [](openailivetoolkit::MicrophonePermissionCompletion completion) {
        // Without the usage string iOS terminates the app on the request.
        if (![NSBundle.mainBundle objectForInfoDictionaryKey:@"NSMicrophoneUsageDescription"]) {
          completion(false, "The app's Info.plist has no NSMicrophoneUsageDescription, so iOS "
                            "can't ask for the microphone. Add one.");
          return;
        }
        if (@available(iOS 17.0, *)) {
          [AVAudioApplication requestRecordPermissionWithCompletionHandler:^(BOOL granted) {
            completion(granted, "");
          }];
        } else {
          [[AVAudioSession sharedInstance] requestRecordPermission:^(BOOL granted) {
            completion(granted, "");
          }];
        }
      });

  facebook::react::NativeOpenAILiveToolkit::setBluetoothConnectedHook([]() {
    return IsBluetoothConnected();
  });

  auto module = std::make_shared<facebook::react::NativeOpenAILiveToolkit>(params.jsInvoker);
  std::weak_ptr<facebook::react::NativeOpenAILiveToolkit> weakModule = module;

  // The buttons' targets call the module they were added for, so a reload starts over.
  OnMainThread(^{
    openailivetoolkit::ClearNowPlaying();
  });
  facebook::react::NativeOpenAILiveToolkit::setNowPlayingHook(
      [weakModule](const std::string &info) { SetNowPlaying(info, weakModule); });

  dispatch_async(DuckQueue(), ^{
    s_duckModule = weakModule;
  });
  facebook::react::NativeOpenAILiveToolkit::setOtherAppsDuckHooks({
      .duck = [](bool duck, const std::string &engine) { DuckOtherApps(duck, engine); },
      .setResumable = [](bool resumable) { SetOtherAudioResumable(resumable); },
  });
  facebook::react::NativeOpenAILiveToolkit::setDeviceHooks({
      .synthesize = [](const std::string &text, const std::string &language,
                       std::function<void(std::string)> completion) {
        SynthesizeSpeech(text, language, std::move(completion));
      },
      .networkAvailable = []() { return s_networkAvailable.load(); },
      .otherAudioPlaying = []() { return (bool)AVAudioSession.sharedInstance.isOtherAudioPlaying; },
      .zip = [](const std::string &paths, const std::string &zipPath) { return ZipFiles(paths, zipPath); },
      .describe = []() { return DescribeDevice(); },
  });
  MonitorNetwork(weakModule);

  NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
  if (s_routeObserver) {
    [center removeObserver:s_routeObserver];
  }
  s_routeObserver = [center addObserverForName:AVAudioSessionRouteChangeNotification
                                        object:nil
                                         queue:nil
                                    usingBlock:^(NSNotification *note) {
                                      NSNumber *reason = note.userInfo[AVAudioSessionRouteChangeReasonKey];
                                      LogAudioSession([NSString
                                          stringWithFormat:@"Route changed (reason %@)", reason]);
                                      // Only a device coming or going: ducking itself changes the
                                      // category, which passes through the speaker for a moment.
                                      if (reason.unsignedIntegerValue ==
                                              AVAudioSessionRouteChangeReasonNewDeviceAvailable ||
                                          reason.unsignedIntegerValue ==
                                              AVAudioSessionRouteChangeReasonOldDeviceUnavailable) {
                                        RecheckOtherAppsDuck();
                                      }
                                      if (auto strong = weakModule.lock()) {
                                        strong->notifyBluetoothChanged(IsBluetoothConnected());
                                      }
                                    }];
  if (s_activeObserver) {
    [center removeObserver:s_activeObserver];
  }
  // A duck change refused in the background can go through once the app is in front.
  s_activeObserver = [center addObserverForName:UIApplicationDidBecomeActiveNotification
                                         object:nil
                                          queue:nil
                                     usingBlock:^(NSNotification *note) {
                                       RecheckOtherAppsDuck();
                                     }];
  if (!s_volumeObserver) {
    s_volumeObserver = [OpenAILiveToolkitVolumeObserver new];
    [[AVAudioSession sharedInstance] addObserver:s_volumeObserver
                                      forKeyPath:@"outputVolume"
                                         options:0
                                         context:nil];
  }
  return module;
}

@end
