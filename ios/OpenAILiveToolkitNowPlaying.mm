#import "OpenAILiveToolkitNowPlaying.h"

namespace openailivetoolkit {

static NSArray<id> *s_remoteCommandTargets;

static NSArray<MPRemoteCommand *> *RemoteCommands() {
  MPRemoteCommandCenter *center = MPRemoteCommandCenter.sharedCommandCenter;
  return @[
    center.playCommand, center.pauseCommand, center.togglePlayPauseCommand, center.nextTrackCommand,
    center.previousTrackCommand, center.skipForwardCommand, center.skipBackwardCommand,
    center.changePlaybackPositionCommand
  ];
}

static NSString *StringField(NSDictionary *fields, NSString *key) {
  id value = fields[key];
  return [value isKindOfClass:NSString.class] ? value : @"";
}

static double NumberField(NSDictionary *fields, NSString *key) {
  id value = fields[key];
  return [value isKindOfClass:NSNumber.class] ? [value doubleValue] : 0;
}

NSDictionary *ParseNowPlaying(const std::string &info) {
  // Empty for "" or a string that isn't UTF-8.
  NSData *data = [[NSString stringWithUTF8String:info.c_str()] dataUsingEncoding:NSUTF8StringEncoding];
  if (data.length == 0) {
    return nil;
  }
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  return [parsed isKindOfClass:NSDictionary.class] ? parsed : nil;
}

void ShowNowPlaying(NSDictionary *fields) {
  MPRemoteCommandCenter *center = MPRemoteCommandCenter.sharedCommandCenter;
  center.playCommand.enabled = YES;
  center.pauseCommand.enabled = YES;
  center.togglePlayPauseCommand.enabled = YES;
  center.nextTrackCommand.enabled = NumberField(fields, @"next") != 0;
  center.previousTrackCommand.enabled = NumberField(fields, @"previous") != 0;
  double skipForward = NumberField(fields, @"skipForward");
  center.skipForwardCommand.enabled = skipForward > 0;
  if (skipForward > 0) {
    center.skipForwardCommand.preferredIntervals = @[ @(skipForward) ];
  }
  double skipBackward = NumberField(fields, @"skipBackward");
  center.skipBackwardCommand.enabled = skipBackward > 0;
  if (skipBackward > 0) {
    center.skipBackwardCommand.preferredIntervals = @[ @(skipBackward) ];
  }
  center.changePlaybackPositionCommand.enabled = NumberField(fields, @"seek") != 0;

  NSMutableDictionary *nowPlaying = [NSMutableDictionary dictionary];
  nowPlaying[MPMediaItemPropertyTitle] = StringField(fields, @"title");
  nowPlaying[MPMediaItemPropertyArtist] = StringField(fields, @"artist");
  nowPlaying[MPNowPlayingInfoPropertyMediaType] = @(MPNowPlayingInfoMediaTypeAudio);
  nowPlaying[MPNowPlayingInfoPropertyIsLiveStream] = @(NumberField(fields, @"live") != 0);
  double duration = NumberField(fields, @"duration");
  if (duration > 0) {
    nowPlaying[MPMediaItemPropertyPlaybackDuration] = @(duration);
  }
  nowPlaying[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(NumberField(fields, @"position"));
  nowPlaying[MPNowPlayingInfoPropertyPlaybackRate] = @(NumberField(fields, @"playing") != 0 ? 1.0 : 0.0);
  MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nowPlaying;
}

static id AddRemoteCommandTarget(MPRemoteCommand *command, NSString *name, void (^send)(NSString *command)) {
  return [command addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
    send(RemoteCommandMessage(name, event));
    return MPRemoteCommandHandlerStatusSuccess;
  }];
}

void AddRemoteCommandTargets(void (^send)(NSString *command)) {
  if (s_remoteCommandTargets) {
    return;
  }
  MPRemoteCommandCenter *center = MPRemoteCommandCenter.sharedCommandCenter;
  s_remoteCommandTargets = @[
    AddRemoteCommandTarget(center.playCommand, @"play", send),
    AddRemoteCommandTarget(center.pauseCommand, @"pause", send),
    AddRemoteCommandTarget(center.togglePlayPauseCommand, @"toggle", send),
    AddRemoteCommandTarget(center.nextTrackCommand, @"next", send),
    AddRemoteCommandTarget(center.previousTrackCommand, @"previous", send),
    AddRemoteCommandTarget(center.skipForwardCommand, @"skipForward", send),
    AddRemoteCommandTarget(center.skipBackwardCommand, @"skipBackward", send),
    AddRemoteCommandTarget(center.changePlaybackPositionCommand, @"seek", send),
  ];
}

void ClearNowPlaying() {
  MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nil;
  for (MPRemoteCommand *command in RemoteCommands()) {
    [command removeTarget:nil];
    command.enabled = NO;
  }
  s_remoteCommandTargets = nil;
}

NSString *RemoteCommandMessage(NSString *name, MPRemoteCommandEvent *event) {
  if (![event isKindOfClass:MPChangePlaybackPositionCommandEvent.class]) {
    return name;
  }
  return [NSString stringWithFormat:@"seek:%f", ((MPChangePlaybackPositionCommandEvent *)event).positionTime];
}

} // namespace openailivetoolkit
