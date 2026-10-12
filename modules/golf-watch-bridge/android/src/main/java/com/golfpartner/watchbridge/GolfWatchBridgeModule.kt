package com.golfpartner.watchbridge

import android.content.Context
import android.util.Log
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Phone side of the Wear OS bridge.
 *
 *  - setState(json, urgent): publishes the round state as the DataItem
 *    `/golf/state` (key `json`; `setUrgent` unless it is a distance-only
 *    refresh). Calls made while a put is in flight are coalesced: only the
 *    latest JSON is put next, urgent if any coalesced call was. Failures are
 *    logged, never thrown. On a phone without the Wear OS app the Wearable API
 *    is not connected at all: the first such failure switches publishing off
 *    for the life of the module, instead of logging a warning on every push.
 *  - onCommand { json }: watch -> phone messages on `/golf/cmd`, see [WatchCommandHub].
 *  - getConnectedNodes(): the watches currently reachable, as [{ id, name }].
 */
class GolfWatchBridgeModule : Module() {
  private val stateLock = Any()
  private var putInFlight = false
  private var nextState: String? = null
  private var nextUrgent = false
  @Volatile private var wearableUnavailable = false

  private val commandSink: (String) -> Unit = { json ->
    sendEvent(EVENT_COMMAND, mapOf("json" to json))
  }

  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("GolfWatchBridge")

    Events(EVENT_COMMAND)

    OnCreate {
      context?.let { WatchCommandHub.ensureListening(it) }
        ?: Log.w(TAG, "No context; watch commands not received")
    }

    OnStartObserving(EVENT_COMMAND) {
      context?.let { WatchCommandHub.ensureListening(it) }
      WatchCommandHub.attach(commandSink)
    }

    OnStopObserving(EVENT_COMMAND) {
      WatchCommandHub.detach(commandSink)
    }

    OnDestroy {
      WatchCommandHub.detach(commandSink)
    }

    Function("setState") { json: String, urgent: Boolean ->
      if (wearableUnavailable) return@Function
      synchronized(stateLock) {
        if (putInFlight) {
          nextUrgent = nextUrgent || urgent
          nextState = json
          return@Function
        }
        putInFlight = true
      }
      put(json, urgent)
    }

    AsyncFunction("getConnectedNodes") { promise: Promise ->
      val ctx = context
      if (ctx == null) {
        promise.reject(CodedException("ERR_NO_CONTEXT", "React context is not available", null))
        return@AsyncFunction
      }
      Wearable.getNodeClient(ctx).connectedNodes
        .addOnSuccessListener { nodes ->
          promise.resolve(nodes.map { mapOf("id" to it.id, "name" to it.displayName) })
        }
        .addOnFailureListener { e ->
          promise.reject(CodedException("ERR_WEARABLE", e.message ?: "Wearable API unavailable", e))
        }
    }
  }

  private fun put(json: String, urgent: Boolean) {
    val ctx = context
    if (ctx == null) {
      Log.w(TAG, "No context; dropping state")
      onPutDone()
      return
    }
    try {
      val request = PutDataMapRequest.create(STATE_PATH).apply {
        dataMap.putString(KEY_JSON, json)
      }.asPutDataRequest()
      if (urgent) request.setUrgent()
      Wearable.getDataClient(ctx).putDataItem(request)
        .addOnFailureListener { e ->
          if (e is ApiException && e.statusCode == CommonStatusCodes.API_NOT_CONNECTED) {
            wearableUnavailable = true
            Log.i(TAG, "Wearable API not available on this phone; watch state publishing off")
          } else {
            Log.w(TAG, "Publishing state to the watch failed", e)
          }
        }
        .addOnCompleteListener { onPutDone() }
    } catch (e: Exception) {
      Log.w(TAG, "Publishing state to the watch failed", e)
      onPutDone()
    }
  }

  private fun onPutDone() {
    val next: String
    val urgent: Boolean
    synchronized(stateLock) {
      next = nextState?.takeUnless { wearableUnavailable } ?: run {
        nextState = null
        putInFlight = false
        return
      }
      urgent = nextUrgent
      nextState = null
      nextUrgent = false
    }
    put(next, urgent)
  }

  companion object {
    private const val TAG = "GolfWatchBridge"
    private const val EVENT_COMMAND = "onCommand"
    private const val STATE_PATH = "/golf/state"
    private const val KEY_JSON = "json"
  }
}
