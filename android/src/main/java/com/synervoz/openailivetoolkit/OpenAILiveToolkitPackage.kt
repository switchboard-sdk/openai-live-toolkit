package com.synervoz.openailivetoolkit

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * The core engine is a C++ TurboModule registered through RN's C++ autolinking, not
 * the JVM. This package still has to exist so autolinking treats the directory as an
 * Android library. It registers the one JVM module: [OpenAILiveToolkitAndroidModule].
 */
class OpenAILiveToolkitPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == OpenAILiveToolkitAndroidModule.NAME) {
      OpenAILiveToolkitAndroidModule(reactContext)
    } else {
      null
    }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      OpenAILiveToolkitAndroidModule.NAME to
        ReactModuleInfo(
          OpenAILiveToolkitAndroidModule.NAME, // name
          OpenAILiveToolkitAndroidModule.NAME, // className
          false, // canOverrideExistingModule
          false, // needsEagerInit
          false, // isCxxModule
          false, // isTurboModule
        )
    )
  }
}
