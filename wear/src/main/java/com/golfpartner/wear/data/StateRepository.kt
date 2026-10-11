package com.golfpartner.wear.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlin.math.max

/**
 * The latest `/golf/state`, with the watch's own unacknowledged writes laid
 * over it so a save shows at once.
 *
 * Overlays are ordered by the outbox's seq. One ends when a state's `ack`
 * names that command or any command of the round queued after it (the phone
 * processes in arrival order; [seqOf] resolves ids the overlay list no longer
 * holds, e.g. a superseded save or a `hole` move), when the round changes, or
 * [OVERLAY_TIMEOUT_MS] after the command was first handed to the phone,
 * counted only while connected (the fallback for an ack that never comes; the
 * outbox keeps re-sending meanwhile). Never on a rev bump: a distance push can
 * overtake a command and still carries the old ack.
 *
 * Within one round a state with a lower rev than the one held is an
 * out-of-order delivery and is ignored, except the first state after the app
 * starts or the phone reconnects (the phone's clock can step backwards).
 */
class StateRepository(private val seqOf: (String) -> Long? = { null }) {
    private val raw = MutableStateFlow<WatchState?>(null)
    private val unacked = MutableStateFlow<List<Tracked>>(emptyList())
    private val _unsupported = MutableStateFlow(false)
    private var acceptNext = true

    private data class Tracked(val command: Command, val seq: Long, val handedOffAtMs: Long? = null)

    /** The phone speaks a protocol version this watch app does not. */
    val unsupported: StateFlow<Boolean> = _unsupported.asStateFlow()

    /** Null until the first payload (DataItem read or change) arrives. */
    val state: Flow<WatchState?> = combine(raw, unacked) { s, tracked ->
        s?.let { Optimistic.apply(it, tracked.map { t -> t.command }) }
    }

    /** The phone's own state, no overlay: what a new command's baseRev is taken from. */
    val rev: Long get() = raw.value?.rev ?: 0
    val current: WatchState? get() = raw.value

    /** The phone (re)connected: the next state is accepted whatever its rev. */
    fun markReconnected() {
        acceptNext = true
    }

    fun onPayload(json: String) {
        when (val parsed = WatchStateParser.parse(json)) {
            is StateParse.Ok -> adopt(parsed.state)
            is StateParse.UnsupportedVersion -> _unsupported.value = true
            StateParse.Invalid -> Unit // keep showing the last good state
        }
    }

    private fun adopt(incoming: WatchState) {
        _unsupported.value = false
        val held = raw.value
        val newRound = held != null && held.roundId != incoming.roundId
        if (held != null && !newRound && !acceptNext && incoming.rev < held.rev) return
        acceptNext = false
        raw.value = incoming
        if (newRound) {
            unacked.value = emptyList()
            return
        }
        val ack = incoming.ack ?: return
        val list = unacked.value
        val seq = list.firstOrNull { it.command.id == ack }?.seq ?: seqOf(ack) ?: return
        val kept = list.filterNot { it.command.roundId == incoming.roundId && it.seq <= seq }
        if (kept.size != list.size) unacked.value = kept
    }

    /** Show [command]'s values until the phone acknowledges it; [seq] is its outbox seq. */
    fun track(command: Command, seq: Long) {
        unacked.value = (unacked.value.filter { it.command.key != command.key } + Tracked(command, seq)).sortedBy { it.seq }
    }

    /** [command] was handed to the phone: its overlay timeout starts now (the first hand-off only). */
    fun handedOff(command: Command, nowMs: Long = System.currentTimeMillis()) {
        val list = unacked.value
        if (list.none { it.command.id == command.id && it.handedOffAtMs == null }) return
        unacked.value = list.map { if (it.command.id == command.id && it.handedOffAtMs == null) it.copy(handedOffAtMs = nowMs) else it }
    }

    /** Fallback for an ack that never matches; only counts while the phone is reachable. */
    fun expire(nowMs: Long, connected: Boolean) {
        if (!connected) return
        val list = unacked.value
        val kept = list.filter { t -> t.handedOffAtMs.let { it == null || nowMs - it < OVERLAY_TIMEOUT_MS } }
        if (kept.size != list.size) unacked.value = kept
    }

    companion object {
        /** Above the outbox's re-send interval, so one re-send gets its chance to be acked. */
        const val OVERLAY_TIMEOUT_MS = 45_000L
    }
}

object Optimistic {
    fun apply(state: WatchState, commands: List<Command>): WatchState {
        val hole = state.hole ?: return state
        var me = state.me ?: return state
        for (c in commands) {
            if (c.roundId != state.roundId || c.hole != hole.number) continue
            when (c.type) {
                CommandType.Strokes -> {
                    val pts = c.value?.let { Entry.points(hole, it) }
                    me = me.copy(
                        strokes = c.value,
                        points = pts,
                        totalPoints = me.totalPoints - (me.points ?: 0) + (pts ?: 0),
                    )
                }
                CommandType.Shot -> c.patch.forEach { (k, v) ->
                    me = when (k) {
                        ShotKeys.PUTTS -> me.copy(putts = v as? Int)
                        ShotKeys.DRIVE_LIE -> me.copy(driveLie = v as? String)
                        ShotKeys.SAND_SHOTS -> me.copy(sandShots = max(0, v as? Int ?: 0))
                        ShotKeys.OTHER_PENALTIES -> me.copy(penalties = max(0, v as? Int ?: 0))
                        else -> me
                    }
                }
                CommandType.Hole -> Unit
            }
        }
        return state.copy(me = me)
    }
}
