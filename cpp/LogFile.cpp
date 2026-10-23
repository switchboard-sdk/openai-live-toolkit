#include "LogFile.hpp"

#include <chrono>
#include <cstdio>
#include <ctime>
#include <thread>

#include <switchboard_core/Logger.hpp>

namespace openailivetoolkit {

namespace {

constexpr std::streamoff kMaxBytes = 1024 * 1024;
// Drops lines rather than grow without bound if the writer falls behind.
constexpr size_t kMaxPendingLines = 10000;

// Lives for the process once started.
LogFile* instance = nullptr;
std::mutex instanceMutex;

std::string timestamp() {
  using namespace std::chrono;
  const auto now = system_clock::now();
  const std::time_t seconds = system_clock::to_time_t(now);
  const auto millis = duration_cast<milliseconds>(now.time_since_epoch()).count() % 1000;
  std::tm local{};
  localtime_r(&seconds, &local);
  char date[24];
  std::strftime(date, sizeof(date), "%Y-%m-%d %H:%M:%S", &local);
  char result[32];
  std::snprintf(result, sizeof(result), "%s.%03lld", date, static_cast<long long>(millis));
  return result;
}

const char* levelName(switchboard::LogLevel level) {
  switch (level) {
    case switchboard::LogLevel::Error:
      return "error";
    case switchboard::LogLevel::Warning:
      return "warning";
    case switchboard::LogLevel::Info:
      return "info";
    case switchboard::LogLevel::Debug:
      return "debug";
    case switchboard::LogLevel::Trace:
      return "trace";
    default:
      return "none";
  }
}

} // namespace

LogFile::LogFile(switchboard::LogDestination* next, std::string directory)
    : next(next),
      directory(std::move(directory)),
      path(this->directory + "/openai-live-toolkit.log"),
      file(path, std::ios::out | std::ios::app) {}

void LogFile::start(const std::string& directory) {
  std::lock_guard<std::mutex> lock(instanceMutex);
  if (instance || directory.empty()) {
    return;
  }
  instance = new LogFile(switchboard::Logger::getLogDestination(), directory);
  std::thread([logFile = instance] { logFile->run(); }).detach();
  switchboard::Logger::setLogDestination(instance);
}

std::string LogFile::exportFile() {
  LogFile* logFile;
  {
    std::lock_guard<std::mutex> lock(instanceMutex);
    logFile = instance;
  }
  if (!logFile) {
    return "";
  }
  std::lock_guard<std::mutex> fileLock(logFile->fileMutex);
  logFile->writePending();
  const std::string exported = logFile->directory + "/openai-live-toolkit-log.txt";
  std::ofstream out(exported, std::ios::out | std::ios::trunc);
  for (const auto& part : {logFile->path + ".1", logFile->path}) {
    std::ifstream in(part);
    if (in.is_open()) {
      out << in.rdbuf();
    }
  }
  return out.good() ? exported : "";
}

void LogFile::log(switchboard::LogLevel level, const std::string& message) {
  if (next) {
    next->log(level, message);
  }
  std::string line = timestamp() + " [" + levelName(level) + "] " + message + "\n";
  {
    std::lock_guard<std::mutex> lock(mutex);
    if (pending.size() >= kMaxPendingLines) {
      return;
    }
    pending.push_back(std::move(line));
  }
  wakeup.notify_one();
}

void LogFile::run() {
  for (;;) {
    {
      std::unique_lock<std::mutex> lock(mutex);
      wakeup.wait(lock, [this] { return !pending.empty(); });
    }
    std::lock_guard<std::mutex> fileLock(fileMutex);
    writePending();
  }
}

void LogFile::writePending() {
  std::deque<std::string> lines;
  {
    std::lock_guard<std::mutex> lock(mutex);
    lines.swap(pending);
  }
  for (const auto& line : lines) {
    file << line;
  }
  file.flush();
  if (file.tellp() < kMaxBytes) {
    return;
  }
  file.close();
  std::rename(path.c_str(), (path + ".1").c_str());
  file.open(path, std::ios::out | std::ios::trunc);
}

} // namespace openailivetoolkit
