package com.golfpartner.wear.data

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

private class MemStore(var items: List<String> = emptyList()) : CommandStore {
    override fun load() = items
    override fun save(items: List<String>) { this.items = items }
}

private class FakeTransport(var up: Boolean = true) : CommandTransport {
    val sent = mutableListOf<JSONObject>()
    override suspend fun send(payload: ByteArray): Boolean {
        if (!up) return false
        sent += JSONObject(String(payload, Charsets.UTF_8))
        return true
    }
}

private class Clock(var now: Long = 1_000_000) {
    fun read() = now
}

class CommandOutboxTest {
    private val clock = Clock()

    private fun outbox(t: FakeTransport = FakeTransport(), s: MemStore = MemStore()) =
        Triple(CommandOutbox(s, t, clock::read), t, s)

    private fun CommandOutbox.holes() = pending.value.map { it.command.hole }

    @Test
    fun sendsWhenActiveButKeepsTheCommandUntilItsAck() = runBlocking {
        val (box, t) = outbox()
        box.onState("r1")
        box.enqueue(Commands.strokes("r1", 1, 7, 5, id = "c1"))
        assertEquals(1, t.sent.size)
        assertEquals(1, box.pending.value.size) // handed off is not done
        assertEquals(0, CommandOutbox.pendingHoles(box.pending.value)) // but no longer "waiting"
        box.onAck("c1")
        assertTrue(box.pending.value.isEmpty())
    }

    @Test
    fun nothingIsSentWhileThePhoneStateIsInactiveOrUnknown() = runBlocking {
        val (box, t) = outbox()
        box.enqueue(Commands.strokes("r1", 1, 7, 5)) // no state yet
        box.onState(null) // scorecard closed
        box.flush()
        assertTrue(t.sent.isEmpty())
        box.onState("r1")
        box.flush()
        assertEquals(1, t.sent.size)
    }

    @Test
    fun anotherRoundsCommandsWaitUnsentAndGoAfterTwelveHours() = runBlocking {
        val (box, t) = outbox()
        box.onState("r1")
        box.enqueue(Commands.strokes("old", 1, 7, 5, id = "o"))
        box.enqueue(Commands.strokes("r1", 1, 3, 4, id = "n"))
        assertEquals(listOf("n"), t.sent.map { it.getString("id") }) // "old" not sent, not blocking
        assertEquals(listOf("old", "r1"), box.pending.value.map { it.command.roundId })

        clock.now += CommandOutbox.STALE_MS
        box.onState("r1")
        assertEquals(listOf("r1"), box.pending.value.map { it.command.roundId })
    }

    @Test
    fun aRoundThatComesBackGetsItsCommandsAgain() = runBlocking {
        val (box, t) = outbox()
        box.onState("r1")
        box.enqueue(Commands.strokes("r1", 1, 7, 5, id = "c1"))
        box.onState("r2") // the phone showed another game for a while
        box.onState("r1")
        box.flush()
        assertEquals(listOf("c1", "c1"), t.sent.map { it.getString("id") })
    }

    @Test
    fun resendsWithTheSameIdAfterTheIntervalAndOnReconnect() = runBlocking {
        val (box, t) = outbox()
        box.onState("r1")
        box.enqueue(Commands.strokes("r1", 1, 7, 5, id = "c1"))
        box.flush() // in flight: not again yet
        clock.now += CommandOutbox.RESEND_MS - 1
        box.flush()
        assertEquals(1, t.sent.size)
        clock.now += 1
        box.flush()
        assertEquals(2, t.sent.size)
        box.markReconnected()
        box.flush()
        assertEquals(listOf("c1", "c1", "c1"), t.sent.map { it.getString("id") })
    }

    @Test
    fun aResendKeepsOrderBySendingEverythingAfterIt() = runBlocking {
        val (box, t) = outbox()
        box.onState("r1")
        box.enqueue(Commands.strokes("r1", 1, 7, 5, id = "s"))
        clock.now += CommandOutbox.RESEND_MS - 5
        box.enqueue(Commands.shot("r1", 1, 7, mapOf("putts" to 2), id = "p")) // sent just now
        clock.now += 5
        t.sent.clear()
        box.flush() // "s" is due: "p" must follow it again, not precede it
        assertEquals(listOf("s", "p"), t.sent.map { it.getString("id") })
    }

    @Test
    fun keepsCommandsWhileOfflineAndFlushesInOrderOnReconnect() = runBlocking {
        val (box, t, store) = outbox(FakeTransport(up = false))
        box.onState("r1")
        box.enqueue(Commands.strokes("r1", 1, 7, 5))
        box.enqueue(Commands.shot("r1", 1, 7, mapOf("putts" to 2)))
        assertEquals(2, box.pending.value.size)
        assertEquals(2, store.items.size) // persisted
        assertEquals(1, CommandOutbox.pendingHoles(box.pending.value))

        t.up = true
        box.flush()
        assertEquals(listOf("strokes", "shot"), t.sent.map { it.getString("type") })
        assertEquals(2, box.pending.value.size) // until acked
    }

    @Test
    fun anAckClearsEverythingOfItsRoundQueuedBeforeIt() = runBlocking {
        val (box) = outbox()
        box.onState("r1")
        box.enqueue(Commands.strokes("other", 1, 2, 5, id = "x"))
        box.enqueue(Commands.strokes("r1", 1, 7, 5, id = "a"))
        box.enqueue(Commands.shot("r1", 1, 7, mapOf("putts" to 2), id = "b"))
        box.enqueue(Commands.strokes("r1", 1, 8, 4, id = "c"))
        box.onAck("b")
        assertEquals(listOf("x", "c"), box.pending.value.map { it.command.id })
        box.onAck("unknown")
        assertEquals(2, box.pending.value.size)
    }

    @Test
    fun anAckOfASentHoleMoveStillOrders() = runBlocking {
        val (box) = outbox()
        box.onState("r1")
        box.enqueue(Commands.strokes("r1", 1, 7, 5, id = "a"))
        box.enqueue(Commands.hole("r1", 1, 8, id = "nav"))
        assertEquals(listOf("a"), box.pending.value.map { it.command.id }) // navigation is never kept
        box.onAck("nav")
        assertTrue(box.pending.value.isEmpty())
    }

    @Test
    fun restartRestoresTheQueueWithItsOrderAndResendsTheSameIds() = runBlocking {
        val store = MemStore()
        val first = CommandOutbox(store, FakeTransport(), clock::read)
        first.onState("r1")
        first.enqueue(Commands.strokes("r1", 1, 7, 5, id = "a"))
        first.enqueue(Commands.strokes("r1", 1, 8, 4, id = "b"))
        val t = FakeTransport()
        val reborn = CommandOutbox(store, t, clock::read)
        assertEquals(listOf("a", "b"), reborn.pending.value.map { it.command.id })
        assertTrue(reborn.nextSeq() > reborn.pending.value.maxOf { it.seq })
        reborn.markReconnected()
        reborn.onState("r1")
        reborn.flush()
        assertEquals(listOf("a", "b"), t.sent.map { it.getString("id") })
    }

    @Test
    fun aResaveMovesToTheBackSoStrokesStayAheadOfTheShot() = runBlocking {
        // Hole 7's strokes already acked, its shot still queued, then hole 8. Re-saving hole 7
        // used to replace the shot in place, sending it ahead of the new strokes (refused).
        val (box, t) = outbox()
        box.onState("r1")
        box.enqueue(Commands.strokes("r1", 1, 7, 5, id = "s7"))
        box.onAck("s7")
        box.enqueue(Commands.shot("r1", 1, 7, mapOf("putts" to 2), id = "p7"))
        box.enqueue(Commands.strokes("r1", 1, 8, 4, id = "s8"))
        box.enqueueAll(
            listOf(
                Commands.strokes("r1", 2, 7, 4, id = "s7b") to box.nextSeq(),
                Commands.shot("r1", 2, 7, mapOf("putts" to 1), id = "p7b") to box.nextSeq(),
            ),
        )
        assertEquals(listOf("s8", "s7b", "p7b"), box.pending.value.map { it.command.id })
        t.sent.clear()
        box.markReconnected()
        box.flush()
        assertEquals(listOf("s8", "s7b", "p7b"), t.sent.map { it.getString("id") })
    }

    @Test
    fun aSupersededSentCommandsAckStillClearsWhatCameBefore() = runBlocking {
        val (box) = outbox()
        box.onState("r1")
        box.enqueue(Commands.strokes("r1", 1, 6, 5, id = "s6"))
        box.enqueue(Commands.strokes("r1", 1, 7, 5, id = "s7"))
        box.enqueue(Commands.strokes("r1", 2, 7, 4, id = "s7b")) // supersedes the sent "s7"
        box.onAck("s7")
        assertEquals(listOf("s7b"), box.pending.value.map { it.command.id })
    }

    @Test
    fun queueIsOrderedBySeqNotByArrival() = runBlocking {
        val (box) = outbox(FakeTransport(up = false))
        val early = box.nextSeq()
        val late = box.nextSeq()
        box.enqueue(Commands.strokes("r1", 1, 8, 4, id = "late"), late)
        box.enqueue(Commands.strokes("r1", 1, 7, 5, id = "early"), early)
        assertEquals(listOf("early", "late"), box.pending.value.map { it.command.id })
    }

    @Test
    fun shotPatchesMergeWithLatestWinning() = runBlocking {
        val (box) = outbox(FakeTransport(up = false))
        box.enqueue(Commands.shot("r1", 1, 7, mapOf("putts" to 2, "driveLie" to "rough")))
        box.enqueue(Commands.shot("r1", 2, 7, mapOf("putts" to 3)))
        val only = box.pending.value.single().command
        assertEquals(mapOf("putts" to 3, "driveLie" to "rough"), only.patch)
        assertEquals(2L, only.baseRev)
    }

    @Test
    fun pendingHolesCountsUnsentHolesOfTheRound() = runBlocking {
        val (box) = outbox(FakeTransport(up = false))
        box.enqueue(Commands.strokes("r1", 1, 7, 5))
        box.enqueue(Commands.shot("r1", 1, 7, mapOf("putts" to 2)))
        box.enqueue(Commands.strokes("r1", 1, 8, 4))
        box.enqueue(Commands.strokes("old", 1, 2, 4))
        assertEquals(3, CommandOutbox.pendingHoles(box.pending.value))
        assertEquals(2, CommandOutbox.pendingHoles(box.pending.value, "r1"))
    }

    @Test
    fun holeNavigationIsDroppedNotKeptWhenItCannotBeSent() = runBlocking {
        val (box) = outbox(FakeTransport(up = false))
        box.onState("r1")
        box.enqueue(Commands.strokes("r1", 1, 7, 5))
        box.enqueue(Commands.hole("r1", 1, 8))
        assertEquals(listOf(CommandType.Strokes), box.pending.value.map { it.command.type })
    }

    @Test
    fun aFailureStopsTheQueueAtTheHead() = runBlocking {
        val t = object : CommandTransport {
            var calls = 0
            override suspend fun send(payload: ByteArray): Boolean = (calls++ == 0)
        }
        val box = CommandOutbox(MemStore(), t, clock::read)
        box.onState("r1")
        box.enqueue(Commands.strokes("r1", 1, 7, 5))
        box.enqueue(Commands.strokes("r1", 1, 8, 4)) // second send fails
        assertEquals(listOf(true, false), box.pending.value.map { it.sentAtMs != null })
    }

    @Test
    fun aThrowingTransportKeepsTheCommand() = runBlocking {
        val box = CommandOutbox(MemStore(), CommandTransport { error("boom") }, clock::read)
        box.onState("r1")
        box.enqueue(Commands.strokes("r1", 1, 7, 5))
        assertEquals(listOf(null), box.pending.value.map { it.sentAtMs })
    }

    @Test
    fun handOffIsReported() = runBlocking {
        val handed = mutableListOf<String>()
        val box = CommandOutbox(MemStore(), FakeTransport(), clock::read) { handed += it.id }
        box.enqueue(Commands.strokes("r1", 1, 7, 5, id = "c1"))
        assertTrue(handed.isEmpty()) // inactive: not handed off
        box.onState("r1")
        box.flush()
        assertEquals(listOf("c1"), handed)
    }
}
