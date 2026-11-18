package com.synervoz.openailivetoolkit

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities

/** Whether the device has a network to reach the internet through, and [changed] whenever that changes. */
internal class OpenAILiveToolkitNetwork(context: Context, private val changed: (Boolean) -> Unit) {

  private val connectivity = context.getSystemService(ConnectivityManager::class.java)
  private var callback: ConnectivityManager.NetworkCallback? = null
  private var defaultNetwork: Network? = null
  private var available = true

  @Synchronized
  fun isAvailable(): Boolean = if (callback != null) available else hasInternet()

  /** Start calling [changed]. Calling it again does nothing. */
  @Synchronized
  fun watch() {
    if (callback != null) {
      return
    }
    available = hasInternet()
    val watching = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        synchronized(this@OpenAILiveToolkitNetwork) { defaultNetwork = network }
        update(true)
      }

      // A switch to another network reports the new one as available, maybe before this.
      override fun onLost(network: Network) {
        synchronized(this@OpenAILiveToolkitNetwork) {
          if (network != defaultNetwork) {
            return
          }
          defaultNetwork = null
        }
        update(false)
      }
    }
    connectivity.registerDefaultNetworkCallback(watching)
    callback = watching
  }

  @Synchronized
  fun stop() {
    callback?.let { connectivity.unregisterNetworkCallback(it) }
    callback = null
    defaultNetwork = null
  }

  private fun update(now: Boolean) {
    synchronized(this) {
      if (callback == null || available == now) {
        return
      }
      available = now
    }
    changed(now)
  }

  private fun hasInternet(): Boolean {
    val network = connectivity.activeNetwork ?: return false
    val capabilities = connectivity.getNetworkCapabilities(network) ?: return false
    return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
  }
}
