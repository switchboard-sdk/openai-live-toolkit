#import <XCTest/XCTest.h>

#import "OpenAILiveToolkitOtherAppsDuck.h"

#include <memory>
#include <vector>

using namespace openailivetoolkit;

// The session and the duck queue's timers.
struct FakeSystem {
  bool voiceProcessingRoute = false;
  bool refuses = false;
  bool otherAppPlays = false;
  // Each duckOthers change asked for, refused or not, and each one reported as taken.
  std::vector<bool> changes;
  std::vector<bool> reported;
  std::vector<std::string> logs;
  // Work for the duck queue later, with its delay.
  std::vector<std::pair<double, std::function<void()>>> later;

  OtherAppsDuck::System system() {
    return {
        .isVoiceProcessingRoute = [this] { return voiceProcessingRoute; },
        .setDuckOthers =
            [this](bool duck) {
              changes.push_back(duck);
              return !refuses;
            },
        .otherAppPlays = [this] { return otherAppPlays; },
        .later = [this](double seconds,
                        std::function<void()> block) { later.emplace_back(seconds, std::move(block)); },
        .changed = [this](bool ducked) { reported.push_back(ducked); },
        .log = [this](const std::string &line) { logs.push_back(line); },
    };
  }

  // Runs what waits for the duck queue; returns how much there was.
  size_t runLater() {
    std::vector<std::pair<double, std::function<void()>>> blocks;
    blocks.swap(later);
    for (auto &[seconds, block] : blocks) {
      block();
    }
    return blocks.size();
  }
};

// The duckOthers changes, e.g. "duck, unduck".
static NSString *Changes(const std::vector<bool> &changes) {
  NSMutableArray<NSString *> *names = [NSMutableArray array];
  for (bool duck : changes) {
    [names addObject:duck ? @"duck" : @"unduck"];
  }
  return [names componentsJoinedByString:@", "];
}

@interface OtherAppsDuckTests : XCTestCase
@end

@implementation OtherAppsDuckTests {
  FakeSystem _system;
  std::unique_ptr<OtherAppsDuck> _duck;
}

- (void)setUp {
  _duck = std::make_unique<OtherAppsDuck>(_system.system());
}

// Ducked, with the app playing again what plays.
- (void)duck {
  _duck->setResumable(true);
  _duck->setWanted(true);
  XCTAssertEqualObjects(Changes(_system.changes), @"duck");
}

- (void)testDucksAndReportsIt {
  [self duck];
  XCTAssertEqualObjects(Changes(_system.reported), @"duck");

  _duck->setWanted(false);
  XCTAssertEqualObjects(Changes(_system.reported), @"duck, unduck");
}

- (void)testLowersOnlyWhatTheAppPlaysAgain {
  _duck->setWanted(true);
  XCTAssertEqualObjects(Changes(_system.changes), @"");

  _duck->setResumable(true);
  XCTAssertEqualObjects(Changes(_system.changes), @"duck");
  // e.g. the Music app paused: nothing to change for.
  _duck->setResumable(false);
  XCTAssertEqualObjects(Changes(_system.changes), @"duck");
}

- (void)testLeavesItToVoiceProcessing {
  _system.voiceProcessingRoute = true;
  _duck->setResumable(true);
  _duck->setWanted(true);
  XCTAssertEqualObjects(Changes(_system.changes), @"");

  // e.g. headphones plugged in, then unplugged.
  _system.voiceProcessingRoute = false;
  _duck->update();
  XCTAssertEqualObjects(Changes(_system.changes), @"duck");
  _system.voiceProcessingRoute = true;
  _duck->update();
  XCTAssertEqualObjects(Changes(_system.changes), @"duck, unduck");
}

- (void)testChangesOnlyWhenNeeded {
  _duck->setResumable(true);
  _duck->setWanted(false);
  XCTAssertEqualObjects(Changes(_system.changes), @"");

  _duck->setWanted(true);
  _duck->setWanted(true);
  _duck->update();
  XCTAssertEqualObjects(Changes(_system.changes), @"duck");
}

- (void)testWaitsToRaiseThemWhileAnotherAppPlays {
  [self duck];
  // e.g. Spotify took over from the Music app: raising others would pause it.
  _duck->setResumable(false);
  _system.otherAppPlays = true;
  _duck->setWanted(false);
  for (int i = 0; i < 10; i++) {
    XCTAssertEqual(_system.runLater(), (size_t)1);
  }
  XCTAssertEqualObjects(Changes(_system.changes), @"duck");
  XCTAssertEqual(_system.logs.size(), (size_t)1);
  XCTAssertEqualObjects(@(_system.logs[0].c_str()), @"Another app plays, raising other apps once it stops");

  _system.otherAppPlays = false;
  XCTAssertEqual(_system.runLater(), (size_t)1);
  XCTAssertEqualObjects(Changes(_system.changes), @"duck, unduck");
  XCTAssertEqual(_system.later.size(), (size_t)0);
}

- (void)testRaisesThemWhileAnotherAppPlaysThatTheAppPlaysAgain {
  _system.otherAppPlays = true;
  [self duck];
  _duck->setWanted(false);
  XCTAssertEqualObjects(Changes(_system.changes), @"duck, unduck");
}

- (void)testAWaitingRaiseGoesThroughOnceTheAppPlaysItAgain {
  [self duck];
  _duck->setResumable(false);
  _system.otherAppPlays = true;
  _duck->setWanted(false);
  XCTAssertEqualObjects(Changes(_system.changes), @"duck");

  _duck->setResumable(true);
  XCTAssertEqualObjects(Changes(_system.changes), @"duck, unduck");
}

- (void)testTriesAgainAfterTheSessionRefuses {
  _system.refuses = true;
  _duck->setResumable(true);
  _duck->setWanted(true);
  XCTAssertEqualObjects(Changes(_system.changes), @"duck");
  XCTAssertEqualObjects(Changes(_system.reported), @"");

  _system.refuses = false;
  _duck->update();
  XCTAssertEqualObjects(Changes(_system.changes), @"duck, duck");
  XCTAssertEqualObjects(Changes(_system.reported), @"duck");
}

- (void)testRetriesARefusedChangeEvery10SecondsUpTo6Times {
  [self duck];
  _system.refuses = true;
  _duck->setWanted(false);
  XCTAssertEqual(_system.later.size(), (size_t)1);
  XCTAssertEqual(_system.later[0].first, OtherAppsDuck::RETRY_INTERVAL);
  // An update meanwhile doesn't add another.
  _duck->update();
  XCTAssertEqual(_system.later.size(), (size_t)1);

  int retries = 0;
  while (_system.runLater() > 0) {
    retries++;
  }
  XCTAssertEqual(retries, OtherAppsDuck::MAX_RETRIES);
  XCTAssertEqual(_system.changes.size(), (size_t)(1 + 2 + OtherAppsDuck::MAX_RETRIES));

  _system.refuses = false;
  _duck->update();
  XCTAssertFalse(_system.changes.back());
  _duck->update();
  XCTAssertEqual(_system.changes.size(), (size_t)(1 + 3 + OtherAppsDuck::MAX_RETRIES));
}

- (void)testStopsRetryingOnceTheChangeGoesThrough {
  [self duck];
  _system.refuses = true;
  _duck->setWanted(false);
  _system.refuses = false;
  XCTAssertEqual(_system.runLater(), (size_t)1);
  XCTAssertEqualObjects(Changes(_system.changes), @"duck, unduck, unduck");
  XCTAssertEqual(_system.later.size(), (size_t)0);
}

@end
