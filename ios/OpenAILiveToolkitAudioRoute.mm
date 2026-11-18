#import "OpenAILiveToolkitAudioRoute.h"

namespace openailivetoolkit {

bool IsBluetoothPort(AVAudioSessionPort port) {
  return [port isEqualToString:AVAudioSessionPortBluetoothHFP] ||
      [port isEqualToString:AVAudioSessionPortBluetoothA2DP] ||
      [port isEqualToString:AVAudioSessionPortBluetoothLE];
}

bool IsVoiceProcessingRoute(AVAudioSessionPort output, bool echoCancelledInput) {
  if (echoCancelledInput) {
    return false;
  }
  return [output isEqualToString:AVAudioSessionPortBuiltInSpeaker] ||
         [output isEqualToString:AVAudioSessionPortBuiltInReceiver];
}

} // namespace openailivetoolkit
