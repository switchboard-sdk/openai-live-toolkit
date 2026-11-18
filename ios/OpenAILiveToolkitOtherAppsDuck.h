#pragma once

#include <functional>
#include <string>

namespace openailivetoolkit {

// Lowering other apps through the session's duckOthers. Changing the session's options pauses
// whatever other app plays ("interrupted"), so other apps are lowered only while the app plays
// again what plays, as an app that controls the Music app can, and raising them waits while another
// app plays.
class OtherAppsDuck {
public:
  // The session and clock it works with, replaced in tests.
  struct System {
    std::function<bool()> isVoiceProcessingRoute;
    // Adds or removes the session's duckOthers option; false when the session refuses.
    std::function<bool(bool)> setDuckOthers;
    std::function<bool()> otherAppPlays;
    // Runs it on the duck queue after this many seconds.
    std::function<void(double, std::function<void()>)> later;
    // After each change the session took: whether other apps are lowered now.
    std::function<void(bool)> changed;
    std::function<void(const std::string&)> log;
  };

  // A change that waits for another app to stop is checked this often, and one the session refused
  // is tried again as often, this many times, besides on update.
  static constexpr double RETRY_INTERVAL = 10;
  static constexpr int MAX_RETRIES = 6;

  explicit OtherAppsDuck(System system);

  // Whether the toolkit wants other apps lowered. Duck queue only.
  void setWanted(bool duck);
  // Whether the app plays again what a change pauses. Duck queue only.
  void setResumable(bool resumable);
  // Also after a device comes or goes, since voice processing's route lowers other apps already, and
  // when the app becomes active, since iOS can refuse a change in the background. Duck queue only.
  void update();

private:
  void checkLater();

  System system;
  // Duck queue only: whether the toolkit wants other apps lowered, whether they are, and whether
  // the app plays again what a change pauses.
  bool wanted = false;
  bool ducked = false;
  bool resumable = false;
  // Duck queue only: retries of a refused change, whether a check waits, and whether waiting for
  // another app was logged.
  int retries = 0;
  bool checkWaiting = false;
  bool waitLogged = false;
};

} // namespace openailivetoolkit
