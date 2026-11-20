require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# Switchboard SDK + extensions, downloaded into ios/Frameworks/ by the script below.
switchboard_packages = %w[SwitchboardSDK SwitchboardOnnx SwitchboardSileroVAD SwitchboardOpenAI]

Pod::Spec.new do |s|
  s.name         = "OpenAILiveToolkit"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/switchboard-sdk/openai-live-toolkit"
  s.license      = package["license"]
  s.authors      = package["author"]
  # React Native's minimum. Xcode 27 builds nothing older than iOS 15.
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/switchboard-sdk/openai-live-toolkit.git", :tag => "v#{s.version}" }

  # The shared C++ TurboModule (cpp/) + the iOS provider glue (ios/).
  s.source_files = "cpp/**/*.{h,hpp,cpp}", "ios/**/*.{h,mm}"
  # The native unit tests build on their own (scripts/test-ios.sh).
  s.exclude_files = "ios/Tests/**/*"

  # Privacy manifest, aggregated into the app's privacy report. Declares the
  # FileTimestamp required-reason API (stat/fstat) the bundled frameworks use.
  s.resource_bundles = { "OpenAILiveToolkit_privacy" => ["ios/PrivacyInfo.xcprivacy"] }

  # Fetch the Switchboard xcframeworks during `pod install` — keeps the binaries
  # out of git. Idempotent: skips if already present.
  s.prepare_command = "bash scripts/download-ios-frameworks.sh"

  s.vendored_frameworks = switchboard_packages.map do |pkg|
    "ios/Frameworks/#{pkg}/ios/#{pkg}.xcframework"
  end

  header_search_paths = switchboard_packages.map do |pkg|
    "\"${PODS_TARGET_SRCROOT}/ios/Frameworks/#{pkg}/ios/include\""
  end
  framework_search_paths = switchboard_packages.map do |pkg|
    "\"${PODS_TARGET_SRCROOT}/ios/Frameworks/#{pkg}/ios\""
  end

  s.pod_target_xcconfig = {
    "HEADER_SEARCH_PATHS"          => "$(inherited) " + header_search_paths.join(" "),
    "FRAMEWORK_SEARCH_PATHS"       => "$(inherited) " + framework_search_paths.join(" "),
    "CLANG_CXX_LANGUAGE_STANDARD"  => "c++20",
  }

  s.frameworks = "AVFoundation", "AudioToolbox", "MediaPlayer", "Network"

  # Pulls in React-Core and wires up the new architecture + codegen (generates
  # RNOpenAILiveToolkitSpecJSI.h, which cpp/NativeOpenAILiveToolkit.h includes).
  install_modules_dependencies(s)
end
