// React Native autolinking configuration.
//
// OpenAILiveToolkit is a C++ TurboModule. On iOS the module is provided through the
// podspec + codegenConfig.ios.modulesProvider. On Android it is registered via RN's
// C++ autolinking: the app's native build compiles android/CMakeLists.txt (target
// `react-native-openailivetoolkit`) and its generated autolinking provider constructs
// `facebook::react::NativeOpenAILiveToolkit` from cpp/NativeOpenAILiveToolkit.h.
module.exports = {
  dependency: {
    platforms: {
      android: {
        // Resolved relative to the android/ source dir, so not 'android/CMakeLists.txt'.
        cxxModuleCMakeListsModuleName: 'react-native-openailivetoolkit',
        cxxModuleCMakeListsPath: 'CMakeLists.txt',
        cxxModuleHeaderName: 'NativeOpenAILiveToolkit',
      },
    },
  },
}
