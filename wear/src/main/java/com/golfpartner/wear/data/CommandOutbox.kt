package com.golfpartner.wear.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONException
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

/** Sends one serialized command to the phone. true = handed to a connected node. */
fun interface CommandTransport {
    suspend fun send(payload: ByteArray): Boolean
}

/** Durable storage for the queue, one JSON string per entry, oldest first. */
interface CommandStore {
    fun load(): List<String>
    fun save(items: List<String>)
}

/**
 * One queued command. [seq] orders everything the watch writes (assigned at
 * enqueue, a re-save gets a new one); [sentAtMs] is the last hand-off to the
 * phone, null while it still has to go (again).
 */
data class Queued(val command: Command, val seq: Long, val queuedAtMs: Long, val sentAtMs: Long? = null) {
    fun toJson(): String = JSONObject()
        .put("seq", seq)
        .put("at", queuedAtMs)
        .put("sent", sentAtMs ?: JSONObject.NULL)
        .put("cmd", command.toJson())
        .toString()

    companion object {
        fun fromJson(raw: String, fallbackSeq: Long, nowMs: Long): Queued? = try {
            val o = JSONObject(raw)
            val cmd = o.optJSONObject("cmd")
            if (cmd == null) {
                // A queue written before the envelope: the command itself.
                Command.fromJson(raw)?.let { Queued(it, fallbackSeq, nowMs) }
            } else {
                Command.fromJson(cmd.toString())?.let {
                    Queued(
                        command = it,
                        seq = o.getLong("seq"),
                        queuedAtMs = o.optLong("at", nowMs),
                        sentAtMs = if (o.isNull("sent")) null else o.optLong("sent"),
                    )
                }
            }
        } catch (e: JSONException) {
            null
        }
    }
}

/**
 * Commands wait here until the phone acknowledges them, not merely until it
 * takes them: the phone's hub drops what its scorecard did not pick up within
 * 30 s, so a hand-off proves nothing. Ordered by [Queued.seq] (strokes before
 * the shot of the same hole; the phone replays in arrival order and dedupes
 * ids), coalesced by [Command.key] since values are absolute, and persisted so
 * a watch app restart loses nothing.
 *
 * - Sent only while the phone's state is active, and only the commands of its
 *   round ([onState]); another round's commands wait, and go after [STALE_MS].
 * - A command leaves on an `ack` naming it or anything queued after it in the
 *   same round ([onAck]). Until then it is re-sent with the SAME id after
 *   [RESEND_MS], on reconnect ([markReconnected]) and when the round becomes
 *   active again; a re-send also re-sends everything queued after it, so order
 *   holds.
 * - `hole` navigation is only meaningful right now: sent once, never re-sent,
 *   and dropped if it cannot go at once.
 */
class CommandOutbox(
    private val store: CommandStore,
    private val transport: CommandTransport,
    private val clock: () -> Long = System::currentTimeMillis,
    /** Told the id of each command handed to the phone (overlay timeouts start here). */
    private val onHandedOff: (Command) -> Unit = {},
) {
    private val mutex = Mutex()
    private val _pending = MutableStateFlow(
        store.load().mapIndexedNotNull { i, raw -> Queued.fromJson(raw, i.toLong(), clock()) }.sortedBy { it.seq },
    )
    private val seqs = AtomicLong((_pending.value.maxOfOrNull { it.seq } ?: -1) + 1)

    /** Ids no longer queued (superseded after a send, or `hole` sent) -> seq, so their ack still orders. */
    private val retired = object : LinkedHashMap<String, Pair<String, Long>>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<String, Long>>?) = size > RETIRED_MAX
    }

    @Volatile private var activeRound: String? = null

    val pending: StateFlow<List<Queued>> = _pending.asStateFlow()

    /** The next sequence number; take it before showing a command so overlay and queue agree. */
    fun nextSeq(): Long = seqs.getAndIncrement()

    /** The seq of a command id this outbox queued (still queued or recently retired). */
    fun seqOf(id: String): Long? =
        _pending.value.firstOrNull { it.command.id == id }?.seq ?: synchronized(retired) { retired[id]?.second }

    suspend fun enqueue(command: Command, seq: Long = nextSeq()) = enqueueAll(listOf(command to seq))

    /**
     * Queue [items] at once (a save's `strokes` then `shot`), then try to send.
     * An older entry for the same hole and type is removed and the new one
     * appended, so a re-saved hole's `strokes` goes before its new `shot`.
     */
    suspend fun enqueueAll(items: List<Pair<Command, Long>>) {
        mutex.withLock {
            val now = clock()
            val list = _pending.value.toMutableList()
            for ((command, seq) in items) {
                val old = list.firstOrNull { it.command.key == command.key }
                var merged = command
                if (old != null) {
                    list.remove(old)
                    if (old.sentAtMs != null) retire(old)
                    merged = old.command.supersededBy(command)
                }
                list += Queued(merged, seq, now)
            }
            commit(list.sortedBy { it.seq })
        }
        flush()
    }

    /**
     * The phone's state changed: [roundId] is its active round, null when its
     * scorecard is closed. Nothing is sent while null.
     */
    suspend fun onState(roundId: String?) {
        mutex.withLock {
            val previous = activeRound
            activeRound = roundId
            if (roundId == null) return
            val now = clock()
            val list = _pending.value
            val kept = list
                .filter { it.command.roundId == roundId || now - it.queuedAtMs < STALE_MS }
                // The round (re)appeared: whatever was handed off meanwhile may be gone, send again.
                .map { if (previous != roundId && it.command.roundId == roundId) it.copy(sentAtMs = null) else it }
            if (kept != list) commit(kept)
        }
    }

    /** The phone finished [id] (and so everything of its round queued before it). */
    suspend fun onAck(id: String) {
        mutex.withLock {
            val list = _pending.value
            val hit = list.firstOrNull { it.command.id == id }
            val (round, seq) = hit?.let { it.command.roundId to it.seq }
                ?: synchronized(retired) { retired[id] } ?: return
            val kept = list.filterNot { it.command.roundId == round && it.seq <= seq }
            synchronized(retired) { retired.entries.removeAll { it.value.first == round && it.value.second <= seq } }
            if (kept.size != list.size) commit(kept)
        }
    }

    /** The phone (re)connected or the app restarted: what was handed off may be lost, send it all again. */
    suspend fun markReconnected() {
        mutex.withLock {
            val list = _pending.value
            if (list.any { it.sentAtMs != null }) commit(list.map { it.copy(sentAtMs = null) })
        }
    }

    /**
     * Send the active round's commands that are due: from the first one never
     * sent or last sent [RESEND_MS] ago, everything after it in order, until a
     * send fails. `hole` commands not sent in this pass are dropped.
     */
    suspend fun flush() {
        mutex.withLock {
            val round = activeRound
            var list = _pending.value
            if (round != null) {
                val now = clock()
                val mine = list.filter { it.command.roundId == round }
                val from = mine.indexOfFirst { it.sentAtMs == null || now - it.sentAtMs >= RESEND_MS }
                if (from >= 0) {
                    for (item in mine.drop(from)) {
                        if (!send(item.command)) break
                        list = if (item.command.type == CommandType.Hole) {
                            retire(item)
                            list - item
                        } else {
                            list.map { if (it === item) it.copy(sentAtMs = now) else it }
                        }
                        commit(list)
                        onHandedOff(item.command)
                    }
                }
            }
            // Navigation sent a day later would yank the phone's pager. Scores and stats wait; hole moves do not.
            if (list.any { it.command.type == CommandType.Hole }) commit(list.filter { it.command.type != CommandType.Hole })
        }
    }

    private suspend fun send(command: Command): Boolean = try {
        transport.send(command.toJson().toString().toByteArray(Charsets.UTF_8))
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Exception) {
        false
    }

    private fun retire(item: Queued) {
        synchronized(retired) { retired[item.command.id] = item.command.roundId to item.seq }
    }

    private fun commit(list: List<Queued>) {
        _pending.value = list
        store.save(list.map { it.toJson() })
    }

    companion object {
        /** Re-send a command the phone has not acked after this long (its hub keeps one 30 s). */
        const val RESEND_MS = 35_000L

        /** A command for a round the phone no longer shows is dropped after this long. */
        const val STALE_MS = 12 * 60 * 60 * 1000L

        private const val RETIRED_MAX = 64

        /**
         * Distinct holes with a score or stat not yet handed to the phone ("2 holes
         * waiting"); navigation does not count. [roundId] narrows to one round.
         */
        fun pendingHoles(pending: List<Queued>, roundId: String? = null): Int =
            pending.asSequence()
                .filter { it.sentAtMs == null && it.command.type != CommandType.Hole }
                .filter { roundId == null || it.command.roundId == roundId }
                .mapNotNull { it.command.hole }
                .distinct()
                .count()
    }
}
