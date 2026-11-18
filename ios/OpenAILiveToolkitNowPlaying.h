#pragma once

#import <Foundation/Foundation.h>
#import <MediaPlayer/MediaPlayer.h>

#include <string>

namespace openailivetoolkit {

// The JSON info JS sends as an object; nil for "" or anything else, which clears Now Playing.
NSDictionary *ParseNowPlaying(const std::string &info);

// Shows the info as the system's Now Playing and enables the media buttons it allows. Main thread
// only.
void ShowNowPlaying(NSDictionary *fields);

// The system's media buttons: lock screen, Control Center, headphones, car. Taken on the first Now
// Playing info and let go when it's cleared, so an app that doesn't use it keeps the default. Each
// press sends RemoteCommandMessage. Main thread only.
void AddRemoteCommandTargets(void (^send)(NSString *command));

// Main thread only.
void ClearNowPlaying();

// The button's name, or "seek:<seconds>" for a new position.
NSString *RemoteCommandMessage(NSString *name, MPRemoteCommandEvent *event);

} // namespace openailivetoolkit
