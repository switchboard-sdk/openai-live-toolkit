#pragma once

#include <condition_variable>
#include <deque>
#include <fstream>
#include <mutex>
#include <string>

#include <switchboard_core/LogDestination.hpp>

namespace openailivetoolkit {

/**
 * The SDK's log destination while the toolkit runs: passes each line on to the previous
 * destination (the console) and appends it, timestamped, to `openai-live-toolkit.log` in a
 * directory. Lines are queued and written on a thread of their own, since the SDK also logs
 * from the audio thread. Past 1 MB the file moves to `.1` and a new one starts.
 */
class LogFile : public switchboard::LogDestination {
public:
  /** Installs it once, writing into `directory`. Later calls keep the first directory. */
  static void start(const std::string& directory);

  /** The previous and current file joined into one for sharing; its path, or empty before start(). */
  static std::string exportFile();

  void log(switchboard::LogLevel level, const std::string& message) override;

private:
  LogFile(switchboard::LogDestination* next, std::string directory);

  void run();
  // With fileMutex held.
  void writePending();

  switchboard::LogDestination* next;
  std::string directory;
  std::string path;
  std::ofstream file;
  // Guards pending.
  std::mutex mutex;
  std::condition_variable wakeup;
  std::deque<std::string> pending;
  // Guards file.
  std::mutex fileMutex;
};

} // namespace openailivetoolkit
