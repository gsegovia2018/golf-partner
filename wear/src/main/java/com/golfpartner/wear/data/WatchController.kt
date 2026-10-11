package com.golfpartner.wear.data

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** An edit pinned to the round and hole it was made on ([opened]). */
data class PendingEdit(val opened: WatchState, val plan: EntryPlan, val draft: EntryDraft)

/**
 * Wires the Data Layer, the outbox and location together for the Activity.
 * [start]/[stop] follow the Activity's started state: while it is in the
 * foreground we listen, poll the link and hold the GPS; otherwise nothing runs.
 */
class WatchController(context: Context, private val scope: CoroutineScope) {
    private val link = WearLink(context)
    private val location = WatchLocation(context)
    private val repository: StateRepository = StateRepository { id -> outbox.seqOf(id) }
    private val outbox: CommandOutbox = CommandOutbox(PrefsCommandStore(context), link, onHandedOff = { repository.handedOff(it) })
    private val _connected = MutableStateFlow(false)
    private var jobs: List<Job> = emptyList()
    private var debounce: Job? = null
    private val _edit = MutableStateFlow<PendingEdit?>(null)

    val state = repository.state
    val unsupported = repository.unsupported
    val fix: StateFlow<Fix?> = location.fix
    val pending = outbox.pending

    /** Edits made on the watch and not yet handed to the outbox; null when none. */
    val edit: StateFlow<PendingEdit?> = _edit.asStateFlow()

    /** Whether the phone is reachable right now (re-checked every few seconds while foreground). */
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    init {
        // Scores that survived a restart show again until the phone confirms them.
        outbox.pending.value.filter { it.command.type != CommandType.Hole }.forEach { repository.track(it.command, it.seq) }
    }

    fun hasLocationPermission() = location.hasPermission()

    fun start() {
        if (jobs.isNotEmpty()) return
        // Coming back to the foreground is a reconnect: accept the next state whatever its
        // rev, and re-send whatever was handed off before (it may have died in the phone's hub).
        _connected.value = false
        repository.markReconnected()
        location.start()
        link.listen { json -> onPayload(json) }
        jobs = listOf(
            scope.launch {
                outbox.markReconnected()
                link.readState()?.let { onPayload(it) }
            },
            scope.launch {
                while (true) {
                    val now = link.isPhoneConnected()
                    if (now && !_connected.value) {
                        repository.markReconnected()
                        outbox.markReconnected()
                    }
                    _connected.value = now
                    if (now && outbox.pending.value.isNotEmpty()) outbox.flush()
                    repository.expire(System.currentTimeMillis(), now)
                    delay(POLL_MS)
                }
            },
        )
    }

    /** Permission granted after start(). */
    fun locationPermissionGranted() = location.start()

    fun stop() {
        flushEdits()
        jobs.forEach { it.cancel() }
        jobs = emptyList()
        link.stopListening()
        location.stop()
    }

    private fun onPayload(json: String) {
        repository.onPayload(json)
        val s = repository.current
        val ack = s?.ack
        // The phone moved to another hole or round: the edits go out now, for the hole they belong to.
        _edit.value?.let { if (!Entry.stillOn(it.opened, s)) flushEdits() }
        scope.launch {
            // Only an active state's round is sent to; another round's commands wait.
            outbox.onState(if (s?.active == true) s.roundId else null)
            ack?.let { outbox.onAck(it) }
            // A state arriving proves the phone is there: send anything due now.
            if (outbox.pending.value.isNotEmpty()) outbox.flush()
        }
    }

    /**
     * Change the draft for the hole on screen. [opened] is the state shown (with the
     * optimistic overlay); the first change pins the edit to its round and hole, and later
     * changes keep that pin. [change] gets the current draft, so several crown ticks in one
     * frame all land. Sent [EDIT_DEBOUNCE_MS] after the last change.
     */
    fun edit(opened: WatchState, change: (EntryDraft) -> EntryDraft) {
        val hole = opened.hole ?: return
        val me = opened.me ?: return
        var cur = _edit.value
        if (cur != null && !Entry.sameHole(cur.opened, opened)) {
            sendEdits() // edits for another hole go out first, for that hole
            cur = null
        }
        val plan = cur?.plan ?: Entry.plan(hole, opened.track)
        val draft = change(cur?.draft ?: Entry.initialDraft(hole, me))
        _edit.value = PendingEdit(cur?.opened ?: opened, plan, draft)
        debounce?.cancel()
        debounce = scope.launch {
            delay(EDIT_DEBOUNCE_MS)
            sendEdits()
        }
    }

    /** Send any pending edits now (for the hole they were made on). */
    fun flushEdits() {
        debounce?.cancel()
        debounce = null
        sendEdits()
    }

    /** `strokes` then `shot` of the pending edit, then [after], in one outbox call so the order holds. */
    private fun sendEdits(after: List<Command> = emptyList()) {
        val e = _edit.value
        _edit.value = null
        val edits = e?.let { Entry.saveCommands(it.opened, it.plan, it.draft) }.orEmpty()
        if (edits.isEmpty() && after.isEmpty()) return
        val items = (edits + after).map { it to outbox.nextSeq() }
        items.filter { it.first.type != CommandType.Hole }.forEach { (c, seq) -> repository.track(c, seq) }
        scope.launch { outbox.enqueueAll(items) }
    }

    fun goToHole(state: WatchState, to: Int) {
        val roundId = state.roundId ?: return
        val command = Commands.hole(roundId, repository.rev, to)
        debounce?.cancel()
        debounce = null
        sendEdits(listOf(command)) // edits for the current hole go ahead of the move
    }

    private companion object {
        const val POLL_MS = 4_000L
        const val EDIT_DEBOUNCE_MS = 1_000L
    }
}
