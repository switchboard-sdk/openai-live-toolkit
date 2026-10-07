require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# Speaker isolation is opt-in: OPENAI_LIVE_AICOUSTICS=1 at `pod install` links the
# private AICoustics extension. The download script reads the same variable.
aicoustics = ENV["OPENAI_LIVE_AICOUSTICS"] == "1"

# Switchboard SDK + extensions, downloaded into ios/Frameworks/ by the script below.
switchboard_packages = %w[SwitchboardSDK SwitchboardOnnx SwitchboardSileroVAD SwitchboardOpenAI]
switchboard_packages << "SwitchboardAICoustics" if aicoustics

# Quail speaker isolation model. The AICoustics node resolves a bare filename
# against the app's main bundle, so it's shipped as a plain resource.
quail_model = "quail_vf_2_1_l_16khz_8xope536_v11.aicmodel"

Pod::Spec.new do |s|
  s.name         = "OpenAILiveToolkit"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/switchboard-sdk/openai-live-toolkit"
  s.license      = package["license"]
  s.authors      = package["author"]
  s.platforms    = { :ios => "13.4" }
  s.source       = { :git => "https://github.com/switchboard-sdk/openai-live-toolkit.git", :tag => "v#{s.version}" }

  # The shared C++ TurboModule (cpp/) + the iOS provider glue (ios/).
  s.source_files = "cpp/**/*.{h,hpp,cpp}", "ios/**/*.{h,mm}"

  # Privacy manifest, aggregated into the app's privacy report. Declares the
  # FileTimestamp required-reason API (stat/fstat) the bundled frameworks use.
  s.resource_bundles = { "OpenAILiveToolkit_privacy" => ["ios/PrivacyInfo.xcprivacy"] }
  s.resources = "ios/Frameworks/SwitchboardAICoustics/ios/models/#{quail_model}" if aicoustics

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
    "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) OPENAI_LIVE_TOOLKIT_AICOUSTICS=#{aicoustics ? 1 : 0}",
  }

  s.frameworks = "AVFoundation", "AudioToolbox"

  # Pulls in React-Core and wires up the new architecture + codegen (generates
  # RNOpenAILiveToolkitSpecJSI.h, which cpp/NativeOpenAILiveToolkit.h includes).
  install_modules_dependencies(s)
end
