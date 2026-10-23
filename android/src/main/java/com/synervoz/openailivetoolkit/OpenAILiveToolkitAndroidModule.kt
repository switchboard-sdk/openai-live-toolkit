package com.synervoz.openailivetoolkit

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.RequiresApi
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Android platform glue for the C++ TurboModule, called from OpenAILiveToolkit.ts.
 *
 * While the engine runs it holds the audio session: a microphone foreground service so
 * the conversation survives the screen locking, and MODE_IN_COMMUNICATION (engages the
 * hardware AEC — Samsung keeps it off otherwise) routed to a connected headset, else the
 * built-in loudspeaker (never the earpiece). The route is fixed at start.
 */
class OpenAILiveToolkitAndroidModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  override fun getConstants(): Map<String, Any> =
    mapOf(
      "documentsPath" to reactContext.filesDir.absolutePath,
      "cachePath" to reactContext.cacheDir.absolutePath,
    )

  private val audioManager: AudioManager
    get() = reactContext.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private val mainHandler = Handler(Looper.getMainLooper())
  private var idleTimer: Pair<Runnable, Promise>? = null

  /** Start the foreground service and the communication route. Call with the mic granted. */
  @ReactMethod
  fun startAudioSession(promise: Promise) {
    try {
      val context = reactContext.applicationContext
      val intent = Intent(context, OpenAILiveToolkitService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      enableCommunicationRoute(promise)
    } catch (e: Exception) {
      promise.reject("audio_session_error", e)
    }
  }

  /** Restore the normal audio mode and route, and stop the foreground service. */
  @ReactMethod
  fun stopAudioSession(promise: Promise) {
    try {
      disableCommunicationRoute()
      val context = reactContext.applicationContext
      context.stopService(Intent(context, OpenAILiveToolkitService::class.java))
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("audio_session_error", e)
    }
  }

  /** Enter communication mode; route to a connected headset if present, else the loudspeaker. */
  private fun enableCommunicationRoute(promise: Promise) {
    val am = audioManager
    am.mode = AudioManager.MODE_IN_COMMUNICATION
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      routeLegacy(am)
      promise.resolve(null)
      return
    }
    val devices = am.availableCommunicationDevices
    val headset = PREFERRED_HEADSET_TYPES.firstNotNullOfOrNull { type ->
      devices.firstOrNull { it.type == type }
    }
    if (headset != null) {
      selectDeviceAndWait(am, headset, promise)
      return
    }
    devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
      ?.let { am.setCommunicationDevice(it) }
    promise.resolve(null)
  }

  /**
   * Select [device] and resolve only once the route is active (or times out).
   * Bluetooth SCO connects asynchronously — resolving early would let the engine
   * open its mic stream before capture is ready and silence it.
   */
  @RequiresApi(Build.VERSION_CODES.S)
  private fun selectDeviceAndWait(am: AudioManager, device: AudioDeviceInfo, promise: Promise) {
    if (am.communicationDevice?.id == device.id) {
      promise.resolve(null)
      return
    }
    val done = AtomicBoolean(false)
    val holder = arrayOfNulls<AudioManager.OnCommunicationDeviceChangedListener>(1)
    fun finish() {
      if (done.compareAndSet(false, true)) {
        holder[0]?.let { am.removeOnCommunicationDeviceChangedListener(it) }
        promise.resolve(null)
      }
    }
    val listener = AudioManager.OnCommunicationDeviceChangedListener { active ->
      if (active?.id == device.id) finish()
    }
    holder[0] = listener
    am.addOnCommunicationDeviceChangedListener(Executor { it.run() }, listener)
    if (!am.setCommunicationDevice(device)) {
      finish()
      return
    }
    // SCO can take a couple of seconds; don't block start forever.
    Handler(Looper.getMainLooper()).postDelayed({ finish() }, ROUTE_TIMEOUT_MS)
  }

  /**
   * Resolves true after [ms], or false once replaced or cancelled. Idle mode counts down here
   * because React Native stops JS timers while the app is in the background.
   */
  @ReactMethod
  fun setIdleTimer(ms: Double, promise: Promise) {
    mainHandler.post {
      cancelPendingIdleTimer()
      val runnable = Runnable {
        idleTimer = null
        promise.resolve(true)
      }
      idleTimer = runnable to promise
      mainHandler.postDelayed(runnable, ms.toLong())
    }
  }

  @ReactMethod
  fun cancelIdleTimer() {
    mainHandler.post { cancelPendingIdleTimer() }
  }

  // On the main looper, like everything that touches idleTimer.
  private fun cancelPendingIdleTimer() {
    val (runnable, promise) = idleTimer ?: return
    idleTimer = null
    mainHandler.removeCallbacks(runnable)
    promise.resolve(false)
  }

  /** Open the share sheet with [path], a file in the app's cache directory. */
  @ReactMethod
  fun shareFile(path: String, promise: Promise) {
    try {
      val context = reactContext.applicationContext
      val uri = FileProvider.getUriForFile(context, "${context.packageName}.openailivetoolkit.files", File(path))
      val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_STREAM, uri)
        // On the intent's clip data, the read grant carries over to the app picked in the chooser.
        clipData = ClipData.newRawUri(null, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      (reactContext.currentActivity ?: context).startActivity(chooser)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("share_error", e)
    }
  }

  private fun disableCommunicationRoute() {
    val am = audioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      am.clearCommunicationDevice()
    } else {
      @Suppress("DEPRECATION")
      run {
        am.stopBluetoothSco()
        am.isBluetoothScoOn = false
        am.isSpeakerphoneOn = false
      }
    }
    am.mode = AudioManager.MODE_NORMAL
  }

  /** Pre-API-31 routing: Bluetooth SCO > wired/USB headset > loudspeaker. */
  @Suppress("DEPRECATION")
  private fun routeLegacy(am: AudioManager) {
    val outputs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    val hasBluetooth = outputs.any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
    val hasWired = outputs.any {
      it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
        it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
        it.type == AudioDeviceInfo.TYPE_USB_HEADSET
    }
    when {
      hasBluetooth -> {
        // SCO connects asynchronously; best-effort on legacy devices.
        am.startBluetoothSco()
        am.isBluetoothScoOn = true
        am.isSpeakerphoneOn = false
      }
      // Wired/USB routes automatically in comm mode; just don't force speaker.
      hasWired -> am.isSpeakerphoneOn = false
      else -> am.isSpeakerphoneOn = true
    }
  }

  companion object {
    const val NAME = "OpenAILiveToolkitAndroid"

    private const val ROUTE_TIMEOUT_MS = 3000L

    // Headset output types, most-preferred first.
    private val PREFERRED_HEADSET_TYPES = listOf(
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
      AudioDeviceInfo.TYPE_BLE_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      AudioDeviceInfo.TYPE_USB_HEADSET,
    )
  }
}
