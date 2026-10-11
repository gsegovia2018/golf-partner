package com.golfpartner.wear.data

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

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

    val state = repository.state
    val unsupported = repository.unsupported
    val fix: StateFlow<Fix?> = location.fix
    val pending = outbox.pending

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
        jobs.forEach { it.cancel() }
        jobs = emptyList()
        link.stopListening()
        location.stop()
    }

    private fun onPayload(json: String) {
        repository.onPayload(json)
        val s = repository.current
        val ack = s?.ack
        scope.launch {
            // Only an active state's round is sent to; another round's commands wait.
            outbox.onState(if (s?.active == true) s.roundId else null)
            ack?.let { outbox.onAck(it) }
            // A state arriving proves the phone is there: send anything due now.
            if (outbox.pending.value.isNotEmpty()) outbox.flush()
        }
    }

    /**
     * Save the entry flow for the hole it was opened on ([opened], not whatever
     * the phone shows now): show the values at once, send `strokes` then `shot`.
     */
    fun save(opened: WatchState, plan: EntryPlan, draft: EntryDraft) {
        val commands = Entry.saveCommands(opened, plan, draft).map { it to outbox.nextSeq() }
        commands.forEach { (c, seq) -> repository.track(c, seq) }
        scope.launch { outbox.enqueueAll(commands) }
    }

    fun goToHole(state: WatchState, to: Int) {
        val roundId = state.roundId ?: return
        val command = Commands.hole(roundId, repository.rev, to)
        scope.launch { outbox.enqueue(command) }
    }

    private companion object {
        const val POLL_MS = 4_000L
    }
}
