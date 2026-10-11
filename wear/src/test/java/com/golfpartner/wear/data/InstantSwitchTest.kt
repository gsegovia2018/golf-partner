package com.golfpartner.wear.data

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class InstantSwitchTest {
    private val course = """
        ,"course":{"holes":[
          {"number":6,"par":5,"si":1,"extraShots":2,"green":null},
          {"number":7,"par":4,"si":3,"extraShots":1,"green":{"front":[41.0,2.0],"center":[41.001,2.0],"back":[41.002,2.0]},"tee":[40.998,2.0]},
          {"number":8,"par":3,"si":11,"extraShots":0,"green":{"front":[42.0,2.0],"center":[42.001,2.0],"back":[42.002,2.0]},"tee":[41.999,2.0]}
        ]},
        "mine":{
          "6":{"strokes":6,"points":3,"shot":{"putts":2,"drive":"left","teeClub":"driver","sandShots":1,"approachBunker":true,"approachBucket":"50-100"}},
          "7":{"strokes":null,"points":null,"shot":null},
          "8":{"strokes":4,"points":1,"shot":{"putts":1,"teePenalties":1,"recoveryOutcome":"none","firstPuttBucket":"2-3"}}
        }
    """.trimIndent()

    private val s = Fixtures.state(Fixtures.activeJson(extra = course))

    @Test
    fun parsesCourseAndMine() {
        assertEquals(3, s.course.size)
        assertEquals(LatLng(40.998, 2.0), s.hole!!.tee) // the current hole's tee comes from the course
        assertTrue(s.mine.getValue(6).shot!!.approachBunker)
        assertNull(s.mine.getValue(7).shot)
        assertTrue(s.track.approach)
    }

    @Test
    fun switchingShowsTheTargetHolesValuesAtOnce() {
        val h8 = s.at(8)
        assertEquals(8, h8.hole!!.number)
        assertEquals(3, h8.hole!!.par)
        assertEquals(11, h8.hole!!.si)
        assertEquals(0, h8.hole!!.extraShots)
        assertEquals(LatLng(41.999, 2.0), h8.hole!!.tee)
        assertNull(h8.hole!!.phone) // the phone's distances belong to hole 7
        assertEquals(4, h8.me!!.strokes)
        assertEquals(1, h8.me!!.points)
        assertEquals(1, h8.me!!.shot.teePenalties)
        assertEquals("2-3", h8.me!!.shot.firstPuttBucket)
        assertEquals(14, h8.me!!.totalPoints) // the round total does not depend on the hole
        assertEquals(18, h8.hole!!.count)
        assertEquals("r1", h8.roundId)

        val h6 = s.at(6)
        assertEquals(5, h6.hole!!.par)
        assertEquals(2, h6.hole!!.extraShots)
        assertEquals("left", h6.me!!.shot.drive)
        assertNull(h6.me!!.shot.teeClub) // driver is unstored
        assertNull(h6.hole!!.green)
    }

    @Test
    fun anUnscoredTargetHoleIsEmptyAndPagesFollowItsPar() {
        val h7 = Fixtures.state(Fixtures.activeJson(number = 6, extra = course)).at(7)
        assertNull(h7.me!!.strokes)
        assertEquals(ShotDetail(), h7.me!!.shot)
        // par 3 target: no drive rows on the tee page, finish hidden on approach
        val plan = Entry.plan(s.at(8).hole!!, s.track)
        assertTrue(plan.par3 && !plan.drive && !plan.approachFinish)
    }

    @Test
    fun theCurrentHoleUnknownHolesAndOlderPhonesFallBack() {
        assertSame(s, s.at(7))
        assertSame(s, s.at(12)) // not in the course
        val old = Fixtures.state() // no course, no mine
        assertSame(old, old.at(8))
        assertTrue(old.course.isEmpty() && old.mine.isEmpty())
    }

    @Test
    fun pendingEditsShowOnTheirOwnHoleBeforeThePhoneCatchesUp() {
        val repo = StateRepository()
        repo.onPayload(Fixtures.activeJson(extra = course))
        repo.track(Commands.strokes("r1", 10, 8, 3, id = "a"), seq = 1) // hole 8, not the phone's hole
        repo.track(Commands.shot("r1", 10, 8, mapOf("sandShots" to 1), id = "b"), seq = 2)
        val shown = runBlocking { repo.state.first()!! }
        val h8 = shown.at(8)
        assertEquals(3, h8.me!!.strokes)
        assertEquals(2, h8.me!!.points) // par 3: 2 + 3 - 3
        assertEquals(1, h8.me!!.shot.sandShots)
        assertEquals(1, h8.me!!.shot.teePenalties) // the phone's value stays under the patch
        assertEquals(14 - 1 + 2, h8.me!!.totalPoints) // the round total follows the new score
        assertNull(shown.me!!.strokes) // hole 7 untouched
    }
}
