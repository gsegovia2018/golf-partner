package com.golfpartner.wear.data

import android.content.Context
import android.net.Uri
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout

/** The Wearable Data Layer as this app uses it: read/listen to the state, send commands. */
class WearLink(context: Context) : CommandTransport {
    private val dataClient = Wearable.getDataClient(context.applicationContext)
    private val nodeClient = Wearable.getNodeClient(context.applicationContext)
    private val messageClient = Wearable.getMessageClient(context.applicationContext)
    private var listener: DataClient.OnDataChangedListener? = null

    /** The state DataItem currently stored, if the phone ever wrote one. */
    suspend fun readState(): String? = try {
        val uri = Uri.Builder().scheme("wear").path(Protocol.STATE_PATH).build()
        val buffer = dataClient.getDataItems(uri).await()
        try {
            buffer.mapNotNull { jsonOf(DataMapItem.fromDataItem(it)) }.lastOrNull()
        } finally {
            buffer.release()
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    fun listen(onJson: (String) -> Unit) {
        stopListening()
        val l = DataClient.OnDataChangedListener { events ->
            try {
                for (event in events) {
                    if (event.type != DataEvent.TYPE_CHANGED) continue
                    if (event.dataItem.uri.path != Protocol.STATE_PATH) continue
                    jsonOf(DataMapItem.fromDataItem(event.dataItem))?.let(onJson)
                }
            } finally {
                events.release()
            }
        }
        listener = l
        dataClient.addListener(l)
    }

    fun stopListening() {
        listener?.let { dataClient.removeListener(it) }
        listener = null
    }

    private fun jsonOf(item: DataMapItem): String? = item.dataMap.getString(Protocol.STATE_KEY)

    private suspend fun nodes(): List<Node> = try {
        withTimeout(NODE_TIMEOUT_MS) { nodeClient.connectedNodes.await() }
    } catch (e: CancellationException) {
        if (e is kotlinx.coroutines.TimeoutCancellationException) emptyList() else throw e
    } catch (e: Exception) {
        emptyList()
    }

    suspend fun isPhoneConnected(): Boolean = nodes().isNotEmpty()

    override suspend fun send(payload: ByteArray): Boolean {
        val all = nodes()
        val node = all.firstOrNull { it.isNearby } ?: all.firstOrNull() ?: return false
        return try {
            withTimeout(SEND_TIMEOUT_MS) {
                messageClient.sendMessage(node.id, Protocol.COMMAND_PATH, payload).await()
            }
            true
        } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
            false
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            false
        }
    }

    private companion object {
        const val NODE_TIMEOUT_MS = 3_000L
        const val SEND_TIMEOUT_MS = 5_000L
    }
}
