package com.synervoz.openailivetoolkit

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * Microphone foreground service, running while the engine does. Android cuts a
 * background app off from the mic, so without it the model stops hearing the user
 * when the screen locks or another app comes to the front.
 */
class OpenAILiveToolkitService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(NOTIFICATION_ID, notification())
      }
    } catch (e: Exception) {
      // Not allowed from the background, or no mic permission. The conversation
      // still runs while the app is in front.
      Log.w(TAG, "Couldn't start the foreground service", e)
      stopSelf()
    }
    return START_NOT_STICKY
  }

  private fun notification(): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Voice conversation", NotificationManager.IMPORTANCE_LOW)
      )
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    builder
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(packageManager.getApplicationLabel(applicationInfo))
      .setContentText("Conversation in progress")
      .setOngoing(true)
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      builder.setContentIntent(
        PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE)
      )
    }
    return builder.build()
  }

  companion object {
    private const val TAG = "OpenAILiveToolkit"
    private const val CHANNEL_ID = "openai_live_toolkit"
    private const val NOTIFICATION_ID = 0x4c495645 // "LIVE"
  }
}
