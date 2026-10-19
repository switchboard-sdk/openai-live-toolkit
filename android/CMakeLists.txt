# Android native build for the OpenAILiveToolkit C++ TurboModule.
#
# This file is pulled into the consuming app's native build by RN autolinking
# (react-native.config.js → android.cxxModuleCMakeListsPath). It compiles the
# shared C++ (../cpp) and links it against the codegen-generated spec and the
# Switchboard SDK + extensions (resolved via Prefab from the AAR dependencies).
cmake_minimum_required(VERSION 3.13)
project(OpenAILiveToolkit)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(OPENAILIVETOOLKIT_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../cpp")

# Module name must match react-native.config.js `cxxModuleCMakeListsModuleName`.
add_library(react-native-openailivetoolkit SHARED
    "${OPENAILIVETOOLKIT_CPP_DIR}/NativeOpenAILiveToolkit.cpp"
)

target_include_directories(react-native-openailivetoolkit PUBLIC "${OPENAILIVETOOLKIT_CPP_DIR}")

# There is no Android build of the AICoustics extension, so no speaker isolation.
target_compile_definitions(react-native-openailivetoolkit PRIVATE OPENAI_LIVE_TOOLKIT_AICOUSTICS=0)

# Switchboard SDK + extensions via Prefab, from the AARs in android/libs.
find_package(SwitchboardSDK REQUIRED CONFIG)
find_package(SwitchboardOpenAI REQUIRED CONFIG)
# Silero VAD and the Onnx runtime it runs on, for idle mode.
find_package(SwitchboardOnnx REQUIRED CONFIG)
find_package(SwitchboardSileroVAD REQUIRED CONFIG)

target_link_libraries(react-native-openailivetoolkit
    # Codegen-generated spec (RNOpenAILiveToolkitSpecJSI.h) — provides jsi/TurboModule.
    react_codegen_RNOpenAILiveToolkitSpec
    SwitchboardSDK::SwitchboardSDK
    SwitchboardOpenAI::SwitchboardOpenAI
    SwitchboardOnnx::SwitchboardOnnx
    SwitchboardSileroVAD::SwitchboardSileroVAD
)
