package com.golfpartner.watchbridge

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable

/**
 * Process-wide receiver for watch -> phone commands on [CMD_PATH].
 *
 * The MessageClient listener is registered once per process (on the application
 * context) rather than per module instance, so a JS reload — which destroys and
 * recreates the module — cannot open a gap in which a command is dropped. While no
 * JS listener is attached, commands wait in a small FIFO and are drained, in
 * arrival order, as soon as JS starts observing `onCommand` again — except
 * those older than [MAX_PENDING_AGE_MS]: the watch has had the phone's state
 * republished since, and a minutes-old command would be replayed over it.
 *
 * This only works while the process is alive (in a round, the round-tracking
 * foreground service keeps it alive). Waking a dead process needs a
 * WearableListenerService — out of scope for v1, see README.
 */
internal object WatchCommandHub {
  const val CMD_PATH = "/golf/cmd"
  private const val TAG = "GolfWatchBridge"
  private const val MAX_PENDING = 64
  private const val MAX_PENDING_AGE_MS = 30_000L

  private val lock = Any()
  private var registered = false
  private var sink: ((String) -> Unit)? = null
  /** Buffered commands with their arrival time ([SystemClock.elapsedRealtime]). */
  private val pending = ArrayDeque<Pair<String, Long>>()

  private val listener = MessageClient.OnMessageReceivedListener { event: MessageEvent ->
    if (event.path != CMD_PATH) return@OnMessageReceivedListener
    val json = try {
      String(event.data, Charsets.UTF_8)
    } catch (e: Exception) {
      Log.w(TAG, "Undecodable command from ${event.sourceNodeId}", e)
      return@OnMessageReceivedListener
    }
    deliver(json)
  }

  /** Registers the MessageClient listener once for the life of the process. */
  fun ensureListening(context: Context) {
    synchronized(lock) {
      if (registered) return
      registered = true
    }
    Wearable.getMessageClient(context.applicationContext)
      .addListener(listener)
      .addOnFailureListener { e ->
        Log.w(TAG, "Could not listen for watch commands", e)
        synchronized(lock) { registered = false }
      }
  }

  /** Attaches the JS-facing sink and flushes anything that arrived meanwhile. */
  fun attach(newSink: (String) -> Unit) {
    synchronized(lock) {
      sink = newSink
      val now = SystemClock.elapsedRealtime()
      while (pending.isNotEmpty()) {
        val (json, arrivedAt) = pending.removeFirst()
        if (now - arrivedAt <= MAX_PENDING_AGE_MS) newSink(json)
        else Log.i(TAG, "Dropped a watch command buffered for ${now - arrivedAt} ms")
      }
    }
  }

  /** Detaches [oldSink] if it is still the current one; later commands are buffered. */
  fun detach(oldSink: (String) -> Unit) {
    synchronized(lock) {
      if (sink === oldSink) sink = null
    }
  }

  private fun deliver(json: String) {
    synchronized(lock) {
      val current = sink
      if (current != null) {
        current(json)
        return
      }
      if (pending.size >= MAX_PENDING) {
        // Commands carry absolute values, so the newest ones are the ones that matter.
        pending.removeFirst()
        Log.w(TAG, "Command buffer full; dropped the oldest command")
      }
      pending.addLast(json to SystemClock.elapsedRealtime())
    }
  }
}
