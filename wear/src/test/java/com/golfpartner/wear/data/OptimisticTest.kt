package com.golfpartner.wear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import kotlinx.coroutines.flow.first
import org.junit.Test

class OptimisticTest {
    private val state = Fixtures.state() // hole 7, unscored, total 14, rev 10

    @Test
    fun savedValuesShowAtOnce() {
        val cmds = listOf(
            Commands.strokes("r1", 10, 7, 5),
            Commands.shot("r1", 10, 7, mapOf("putts" to 2, "drive" to "fairway", "sandShots" to 1, "otherPenalties" to 1, "teePenalties" to 1, "approachBunker" to true)),
        )
        val me = Optimistic.apply(state, cmds).me!!
        assertEquals(5, me.strokes)
        assertEquals(2, me.points)
        assertEquals(16, me.totalPoints)
        assertEquals(2, me.shot.putts)
        assertEquals("fairway", me.shot.drive)
        assertEquals(1, me.shot.sandShots)
        assertEquals(1, me.shot.otherPenalties)
        assertEquals(1, me.shot.teePenalties)
        assertEquals(true, me.shot.approachBunker)
    }

    @Test
    fun otherHolesAndRoundsAreIgnored() {
        val cmds = listOf(Commands.strokes("r1", 10, 8, 5), Commands.strokes("other", 10, 7, 5))
        assertNull(Optimistic.apply(state, cmds).me!!.strokes)
    }

    private fun shown(repo: StateRepository) = kotlinx.coroutines.runBlocking { repo.state.first() }!!

    @Test
    fun revIsParsedAs64BitMillis() {
        val s = Fixtures.state(Fixtures.activeJson(rev = 1_760_000_000_123))
        assertEquals(1_760_000_000_123L, s.rev)
    }

    @Test
    fun overlayStaysThroughRevBumpsUntilItsAck() {
        val repo = StateRepository()
        repo.onPayload(Fixtures.activeJson(rev = 10))
        repo.track(Commands.strokes("r1", 10, 7, 5, id = "c1"), seq = 1)
        repo.onPayload(Fixtures.activeJson(rev = 11)) // a distance push, old ack
        assertEquals(5, shown(repo).me!!.strokes)
        repo.onPayload(Fixtures.activeJson(rev = 12, ack = "other"))
        assertEquals(5, shown(repo).me!!.strokes)
        repo.onPayload(Fixtures.activeJson(rev = 13, ack = "c1", strokes = "4", points = "3"))
        assertEquals(4, shown(repo).me!!.strokes)
    }

    @Test
    fun aLaterAckEndsEarlierOverlaysToo() {
        val repo = StateRepository()
        repo.onPayload(Fixtures.activeJson(rev = 10))
        repo.track(Commands.strokes("r1", 10, 7, 5, id = "c1"), seq = 1)
        repo.track(Commands.shot("r1", 10, 7, mapOf("putts" to 2), id = "c2"), seq = 2)
        repo.track(Commands.strokes("r1", 10, 8, 4, id = "c3"), seq = 3)
        repo.onPayload(Fixtures.activeJson(rev = 11, ack = "c2", number = 8)) // c3 still pending
        assertEquals(4, shown(repo).me!!.strokes)
        repo.track(Commands.strokes("r1", 11, 9, 6, id = "c4"), seq = 4)
        repo.onPayload(Fixtures.activeJson(rev = 12, ack = "c4", number = 8)) // beyond c3 as well
        assertNull(shown(repo).me!!.strokes)
    }

    @Test
    fun overlayOrderIsSeqOrderSoAnAckClearsOnlyWhatWasQueuedBefore() {
        // A re-save of hole 7 (seq 5) after hole 8 (seq 3) sits AFTER it, as in the outbox:
        // an ack of hole 8's command must not clear the newer hole-7 overlay.
        val repo = StateRepository()
        repo.onPayload(Fixtures.activeJson(rev = 10))
        repo.track(Commands.strokes("r1", 10, 7, 5, id = "a"), seq = 1)
        repo.track(Commands.strokes("r1", 10, 8, 4, id = "b"), seq = 3)
        repo.track(Commands.strokes("r1", 10, 7, 6, id = "c"), seq = 5) // supersedes "a"
        repo.onPayload(Fixtures.activeJson(rev = 11, ack = "b"))
        assertEquals(6, shown(repo).me!!.strokes)
    }

    @Test
    fun aSecondShotSaveKeepsTheFirstPickShownUntilItsAck() {
        // Chip, pause (sent), another chip: the second patch only carries what changed.
        val repo = StateRepository()
        repo.onPayload(Fixtures.activeJson(rev = 10))
        repo.track(Commands.shot("r1", 10, 7, mapOf("driveDistBucket" to "150-180"), id = "s1"), seq = 1)
        repo.track(Commands.shot("r1", 10, 7, mapOf("teeClub" to "wood"), id = "s2"), seq = 2)
        val shot = shown(repo).me!!.shot
        assertEquals("150-180", shot.driveDistBucket)
        assertEquals("wood", shot.teeClub)
    }

    @Test
    fun anAckOfAnIdNoLongerTrackedIsResolvedThroughTheOutboxSeq() {
        val seqs = mapOf("nav" to 4L) // a `hole` move, sent and retired by the outbox
        val repo = StateRepository { seqs[it] }
        repo.onPayload(Fixtures.activeJson(rev = 10))
        repo.track(Commands.strokes("r1", 10, 7, 5, id = "c1"), seq = 2)
        repo.track(Commands.shot("r1", 10, 7, mapOf("putts" to 2), id = "c2"), seq = 6)
        repo.onPayload(Fixtures.activeJson(rev = 11, ack = "nav"))
        val me = shown(repo).me!!
        assertNull(me.strokes) // seq 2 <= 4: done
        assertEquals(2, me.shot.putts) // seq 6 > 4: still showing
    }

    @Test
    fun overlayEndsOnANewRound() {
        val repo = StateRepository()
        repo.onPayload(Fixtures.activeJson(rev = 10))
        repo.track(Commands.strokes("r1", 10, 7, 5, id = "c1"), seq = 1)
        repo.onPayload(Fixtures.activeJson(rev = 5, roundId = "r2")) // lower rev, new round: adopted
        assertEquals("r2", repo.current!!.roundId)
        assertNull(shown(repo).me!!.strokes)
    }

    @Test
    fun overlayExpiresAfterTheTimeoutFromHandOffOnlyWhileConnected() {
        val repo = StateRepository()
        repo.onPayload(Fixtures.activeJson(rev = 10))
        val c1 = Commands.strokes("r1", 10, 7, 5, id = "c1")
        repo.track(c1, seq = 1)
        repo.expire(1_000_000, connected = true) // never handed off: the clock has not started
        assertEquals(5, shown(repo).me!!.strokes)
        repo.handedOff(c1, nowMs = 1_000)
        repo.handedOff(c1, nowMs = 30_000) // a re-send does not restart it
        repo.expire(1_000 + StateRepository.OVERLAY_TIMEOUT_MS + 1, connected = false)
        assertEquals(5, shown(repo).me!!.strokes)
        repo.expire(1_000 + StateRepository.OVERLAY_TIMEOUT_MS - 1, connected = true)
        assertEquals(5, shown(repo).me!!.strokes)
        repo.expire(1_000 + StateRepository.OVERLAY_TIMEOUT_MS, connected = true)
        assertNull(shown(repo).me!!.strokes)
    }

    @Test
    fun lowerRevInTheSameRoundIsDroppedExceptFirstAfterStartOrReconnect() {
        val repo = StateRepository()
        repo.onPayload(Fixtures.activeJson(rev = 50, number = 7)) // first after start
        repo.onPayload(Fixtures.activeJson(rev = 40, number = 9)) // out of order
        assertEquals(7, repo.current!!.hole!!.number)
        assertEquals(50L, repo.rev)
        repo.onPayload(Fixtures.activeJson(rev = 60, number = 8))
        assertEquals(8, repo.current!!.hole!!.number)

        repo.markReconnected() // phone clock stepped back
        repo.onPayload(Fixtures.activeJson(rev = 20, number = 9))
        assertEquals(9, repo.current!!.hole!!.number)
        repo.onPayload(Fixtures.activeJson(rev = 10, number = 3)) // only the first is free
        assertEquals(9, repo.current!!.hole!!.number)
    }

    @Test
    fun firstStateAfterStartIsAcceptedEvenWithAnyRev() {
        val repo = StateRepository()
        repo.onPayload(Fixtures.activeJson(rev = 1))
        assertEquals(1L, repo.rev)
    }

    @Test
    fun unsupportedVersionIsFlaggedAndKeepsTheLastGoodState() {
        val repo = StateRepository()
        repo.onPayload(Fixtures.activeJson(rev = 10))
        repo.onPayload(Fixtures.activeJson(v = 2))
        assertEquals(10L, repo.current!!.rev)
        assertEquals(true, repo.unsupported.value)
        repo.onPayload(Fixtures.activeJson(rev = 11))
        assertEquals(false, repo.unsupported.value)
    }
}
