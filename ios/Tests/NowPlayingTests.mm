#import <XCTest/XCTest.h>

#import "OpenAILiveToolkitNowPlaying.h"

using namespace openailivetoolkit;

// MPRemoteCommandEvent's init throws: the system makes events only for a real button press. So
// these are allocated and never initialized.
@interface FakeEvent : MPRemoteCommandEvent
+ (instancetype)event;
@end

@implementation FakeEvent
+ (instancetype)event {
  return [self alloc];
}
@end

@interface FakePositionEvent : MPChangePlaybackPositionCommandEvent
+ (instancetype)eventAt:(NSTimeInterval)time;
@property (nonatomic) NSTimeInterval time;
@end

@implementation FakePositionEvent
+ (instancetype)eventAt:(NSTimeInterval)time {
  FakePositionEvent *event = [self alloc];
  event.time = time;
  return event;
}

- (NSTimeInterval)positionTime {
  return self.time;
}
@end

// The info JS sends, as systemNowPlayingInfo() builds it.
static const std::string LIVE_STATION =
    R"({"title":"Tequila Moon","artist":"Smooth Jazz","live":true,"duration":0,"position":0,"playing":true,)"
    R"("next":false,"previous":false,"skipForward":0,"skipBackward":0,"seek":false})";
static const std::string LIVE_STATIONS =
    R"({"title":"Tequila Moon","artist":"Smooth Jazz","live":true,"duration":0,"position":0,"playing":true,)"
    R"("next":true,"previous":true,"skipForward":0,"skipBackward":0,"seek":false})";
static const std::string FILE_PAUSED =
    R"({"title":"https://pod.example/episode.mp3","artist":"","live":false,"duration":120,"position":40,)"
    R"("playing":false,"next":false,"previous":false,"skipForward":30,"skipBackward":15,"seek":true})";

static NSDictionary *Shown() {
  return MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo;
}

static MPRemoteCommandCenter *Buttons() {
  return MPRemoteCommandCenter.sharedCommandCenter;
}

@interface NowPlayingTests : XCTestCase
@end

@implementation NowPlayingTests

- (void)tearDown {
  ClearNowPlaying();
}

- (void)testParsesAJSONObject {
  XCTAssertEqualObjects(ParseNowPlaying(LIVE_STATION)[@"title"], @"Tequila Moon");
}

- (void)testParsesNothingElse {
  for (const std::string &info : {"", "null", "[]", "\"Jazz\"", "42", "{\"title\":"}) {
    XCTAssertNil(ParseNowPlaying(info), @"%s", info.c_str());
  }
}

- (void)testParsesNothingFromInvalidUTF8 {
  XCTAssertNil(ParseNowPlaying("{\"title\":\"\xFF\"}"));
}

- (void)testShowsALiveStation {
  ShowNowPlaying(ParseNowPlaying(LIVE_STATION));

  XCTAssertEqualObjects(Shown()[MPMediaItemPropertyTitle], @"Tequila Moon");
  XCTAssertEqualObjects(Shown()[MPMediaItemPropertyArtist], @"Smooth Jazz");
  XCTAssertEqualObjects(Shown()[MPNowPlayingInfoPropertyMediaType], @(MPNowPlayingInfoMediaTypeAudio));
  XCTAssertEqualObjects(Shown()[MPNowPlayingInfoPropertyIsLiveStream], @YES);
  XCTAssertNil(Shown()[MPMediaItemPropertyPlaybackDuration]);
  XCTAssertEqualObjects(Shown()[MPNowPlayingInfoPropertyElapsedPlaybackTime], @0);
  XCTAssertEqualObjects(Shown()[MPNowPlayingInfoPropertyPlaybackRate], @1);

  XCTAssertTrue(Buttons().playCommand.enabled);
  XCTAssertTrue(Buttons().pauseCommand.enabled);
  XCTAssertTrue(Buttons().togglePlayPauseCommand.enabled);
  XCTAssertFalse(Buttons().nextTrackCommand.enabled);
  XCTAssertFalse(Buttons().previousTrackCommand.enabled);
  XCTAssertFalse(Buttons().skipForwardCommand.enabled);
  XCTAssertFalse(Buttons().skipBackwardCommand.enabled);
  XCTAssertFalse(Buttons().changePlaybackPositionCommand.enabled);
}

- (void)testGivesSeveralStationsNextAndPrevious {
  ShowNowPlaying(ParseNowPlaying(LIVE_STATIONS));

  XCTAssertTrue(Buttons().nextTrackCommand.enabled);
  XCTAssertTrue(Buttons().previousTrackCommand.enabled);
  XCTAssertFalse(Buttons().skipForwardCommand.enabled);
  XCTAssertFalse(Buttons().skipBackwardCommand.enabled);
  XCTAssertFalse(Buttons().changePlaybackPositionCommand.enabled);
}

- (void)testGivesAFileSkipsAndSeeking {
  ShowNowPlaying(ParseNowPlaying(FILE_PAUSED));

  XCTAssertEqualObjects(Shown()[MPMediaItemPropertyTitle], @"https://pod.example/episode.mp3");
  XCTAssertEqualObjects(Shown()[MPMediaItemPropertyArtist], @"");
  XCTAssertEqualObjects(Shown()[MPNowPlayingInfoPropertyIsLiveStream], @NO);
  XCTAssertEqualObjects(Shown()[MPMediaItemPropertyPlaybackDuration], @120);
  XCTAssertEqualObjects(Shown()[MPNowPlayingInfoPropertyElapsedPlaybackTime], @40);
  XCTAssertEqualObjects(Shown()[MPNowPlayingInfoPropertyPlaybackRate], @0);

  XCTAssertTrue(Buttons().playCommand.enabled);
  XCTAssertTrue(Buttons().pauseCommand.enabled);
  XCTAssertTrue(Buttons().togglePlayPauseCommand.enabled);
  XCTAssertFalse(Buttons().nextTrackCommand.enabled);
  XCTAssertFalse(Buttons().previousTrackCommand.enabled);
  XCTAssertTrue(Buttons().skipForwardCommand.enabled);
  XCTAssertEqualObjects(Buttons().skipForwardCommand.preferredIntervals, @[ @30 ]);
  XCTAssertTrue(Buttons().skipBackwardCommand.enabled);
  XCTAssertEqualObjects(Buttons().skipBackwardCommand.preferredIntervals, @[ @15 ]);
  XCTAssertTrue(Buttons().changePlaybackPositionCommand.enabled);
}

- (void)testFillsInMissingAndMistypedFields {
  ShowNowPlaying(ParseNowPlaying(R"({"title":5,"artist":null,"playing":"yes","duration":-1})"));

  XCTAssertEqualObjects(Shown()[MPMediaItemPropertyTitle], @"");
  XCTAssertEqualObjects(Shown()[MPMediaItemPropertyArtist], @"");
  XCTAssertEqualObjects(Shown()[MPNowPlayingInfoPropertyIsLiveStream], @NO);
  XCTAssertNil(Shown()[MPMediaItemPropertyPlaybackDuration]);
  XCTAssertEqualObjects(Shown()[MPNowPlayingInfoPropertyElapsedPlaybackTime], @0);
  XCTAssertEqualObjects(Shown()[MPNowPlayingInfoPropertyPlaybackRate], @0);
  XCTAssertFalse(Buttons().nextTrackCommand.enabled);
  XCTAssertFalse(Buttons().skipForwardCommand.enabled);
  XCTAssertFalse(Buttons().changePlaybackPositionCommand.enabled);
}

- (void)testClearsTheInfoAndEveryButton {
  ShowNowPlaying(ParseNowPlaying(LIVE_STATIONS));
  ShowNowPlaying(ParseNowPlaying(FILE_PAUSED));

  ClearNowPlaying();

  XCTAssertNil(Shown());
  for (MPRemoteCommand *command in @[
         Buttons().playCommand, Buttons().pauseCommand, Buttons().togglePlayPauseCommand,
         Buttons().nextTrackCommand, Buttons().previousTrackCommand, Buttons().skipForwardCommand,
         Buttons().skipBackwardCommand, Buttons().changePlaybackPositionCommand
       ]) {
    XCTAssertFalse(command.enabled, @"%@", command);
  }
}

- (void)testSendsTheButtonsName {
  XCTAssertEqualObjects(RemoteCommandMessage(@"toggle", [FakeEvent event]), @"toggle");
  XCTAssertEqualObjects(RemoteCommandMessage(@"skipForward", [FakeEvent event]), @"skipForward");
}

- (void)testSendsTheNewPositionForASeek {
  XCTAssertEqualObjects(RemoteCommandMessage(@"seek", [FakePositionEvent eventAt:75.5]), @"seek:75.500000");
}

@end
