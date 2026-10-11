package com.golfpartner.wear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchStateTest {
    @Test
    fun parsesAnActiveState() {
        val s = Fixtures.state()
        assertTrue(s.active)
        assertEquals(10L, s.rev)
        assertEquals("r1", s.roundId)
        assertEquals("El Saler", s.courseName)
        assertNull(s.blocked)
        assertEquals(Units.M, s.units)
        val h = s.hole!!
        assertEquals(7, h.number)
        assertEquals(18, h.count)
        assertEquals(4, h.par)
        assertEquals(3, h.si)
        assertEquals(1, h.extraShots)
        assertEquals(5, h.netPar)
        assertEquals(LatLng(41.001, 2.0), h.green!!.center)
        assertEquals(131.5, h.phone!!.center!!, 0.0)
        assertEquals("gps", h.phone!!.source)
        val me = s.me!!
        assertNull(me.strokes)
        assertEquals(14, me.totalPoints)
        assertEquals(6, me.thru)
        assertTrue(s.track.putting && s.track.teeShot && s.track.shortGame && s.track.penalties)
        assertTrue(s.canEnter)
    }

    @Test
    fun parsesTheInactiveShape() {
        val s = (WatchStateParser.parse("""{"v":1,"rev":3,"active":false,"roundId":null,"courseName":null,"blocked":null}""")
            as StateParse.Ok).state
        assertFalse(s.active)
        assertEquals(3L, s.rev)
        assertNull(s.hole)
        assertNull(s.roundId)
        assertFalse(s.canEnter)
    }

    @Test
    fun toleratesNullGreenAndNullParts() {
        val noGreen = Fixtures.state(Fixtures.activeJson(green = "null", phone = "null"))
        assertNull(noGreen.hole!!.green)
        assertNull(noGreen.hole!!.phone)

        val partial = Fixtures.state(
            Fixtures.activeJson(
                green = """{"front":null,"center":[41.001,2.0],"back":null}""",
                phone = """{"front":null,"center":90.0,"back":null,"source":"tee"}""",
            ),
        )
        val g = partial.hole!!.green!!
        assertNull(g.front)
        assertNotNull(g.center)
        assertNull(g.back)
        assertNull(partial.hole!!.phone!!.front)
        assertEquals("tee", partial.hole!!.phone!!.source)
    }

    @Test
    fun toleratesUnknownFieldsAndUnknownBlockedReasons() {
        val s = Fixtures.state(Fixtures.activeJson(blocked = "somethingNew", extra = ""","future":{"a":1}"""))
        assertEquals(Blocked.Other, s.blocked)
        assertFalse(s.canEnter)
    }

    @Test
    fun mapsKnownBlockedReasons() {
        assertEquals(Blocked.Dispute, Fixtures.state(Fixtures.activeJson(blocked = "dispute")).blocked)
        assertEquals(Blocked.ViewOnly, Fixtures.state(Fixtures.activeJson(blocked = "viewOnly")).blocked)
        assertEquals(Blocked.Official, Fixtures.state(Fixtures.activeJson(blocked = "official")).blocked)
    }

    @Test
    fun rejectsAnUnknownVersion() {
        val r = WatchStateParser.parse(Fixtures.activeJson(v = 2))
        assertEquals(StateParse.UnsupportedVersion(2), r)
        assertEquals(StateParse.UnsupportedVersion(null), WatchStateParser.parse("""{"rev":1,"active":false}"""))
    }

    @Test
    fun rejectsGarbageAndIncompleteActiveStates() {
        assertEquals(StateParse.Invalid, WatchStateParser.parse("not json"))
        assertEquals(StateParse.Invalid, WatchStateParser.parse("""{"v":1,"rev":1,"active":true,"roundId":"r"}"""))
    }

    @Test
    fun carriesSavedValues() {
        val s = Fixtures.state(Fixtures.activeJson(strokes = "5", points = "2", putts = "2"))
        assertEquals(5, s.me!!.strokes)
        assertEquals(2, s.me!!.points)
        assertEquals(2, s.me!!.shot.putts) // an older phone: putts on `me`
    }
}
