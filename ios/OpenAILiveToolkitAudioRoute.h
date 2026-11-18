#pragma once

#import <AVFAudio/AVFAudio.h>

namespace openailivetoolkit {

bool IsBluetoothPort(AVAudioSessionPort port);

// Voice processing runs on the device's own speaker and receiver and lowers other apps itself,
// without pausing them. Not when the engine uses echo-cancelled input instead.
bool IsVoiceProcessingRoute(AVAudioSessionPort output, bool echoCancelledInput);

} // namespace openailivetoolkit
