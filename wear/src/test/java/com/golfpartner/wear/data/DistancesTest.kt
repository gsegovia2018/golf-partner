package com.golfpartner.wear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DistancesTest {
    // 0.001 deg of latitude = 111.195 m with R = 6371000.
    private val here = LatLng(41.0, 2.0)

    @Test
    fun haversineKnownPair() {
        assertEquals(111.195, Distances.haversineMeters(here, LatLng(41.001, 2.0)), 0.01)
        assertEquals(0.0, Distances.haversineMeters(here, here), 0.0)
        // Madrid -> Barcelona is ~505 km.
        val km = Distances.haversineMeters(LatLng(40.4168, -3.7038), LatLng(41.3874, 2.1686)) / 1000
        assertEquals(505.0, km, 2.0)
    }

    @Test
    fun displayRoundsLikeThePhone() {
        assertEquals(131, Distances.display(130.9, Units.M))
        assertEquals(100, Distances.display(99.5, Units.M)) // half rounds up, like Math.round
        assertEquals(109, Distances.display(100.0, Units.YD)) // 109.361
        assertEquals(144, Distances.display(131.5, Units.YD)) // 143.8
    }

    private fun hole(green: Green? = Green(LatLng(41.0005, 2.0), LatLng(41.001, 2.0), LatLng(41.0015, 2.0)),
                     phone: PhoneDistances? = PhoneDistances(120.4, 131.5, 142.0, "gps")) =
        HoleInfo(7, 18, 4, 3, 1, green, phone)

    private val now = 1_000_000L

    @Test
    fun watchFixWinsWhenAccurate() {
        val r = Distances.resolve(hole(), Units.M, Fix(41.0, 2.0, 12f, now - 1_000), now)
        assertEquals(DistanceSource.Watch, r.source)
        assertEquals(56, r.front) // 55.6 m
        assertEquals(111, r.center)
        assertEquals(167, r.back) // 166.8 m
    }

    @Test
    fun unitsApplyToWatchFixToo() {
        val r = Distances.resolve(hole(), Units.YD, Fix(41.0, 2.0, 12f, now), now)
        assertEquals(122, r.center) // 111.195 * 1.09361 = 121.6
    }

    @Test
    fun poorOrStaleFixFallsBackToThePhone() {
        val poor = Distances.resolve(hole(), Units.M, Fix(41.0, 2.0, 31f, now), now)
        assertEquals(DistanceSource.Phone, poor.source)
        assertEquals(132, poor.center) // 131.5 rounds up
        assertEquals(120, poor.front)

        val stale = Distances.resolve(hole(), Units.M, Fix(41.0, 2.0, 5f, now - 31_000), now)
        assertEquals(DistanceSource.Phone, stale.source)

        assertFalse(Distances.fixIsUsable(null, now))
        assertTrue(Distances.fixIsUsable(Fix(41.0, 2.0, 30f, now), now))
        assertTrue(Distances.fixIsUsable(Fix(41.0, 2.0, null, now), now).not()) // unknown accuracy is not trusted
    }

    @Test
    fun noGreenUsesPhoneAndNothingGivesNone() {
        val fix = Fix(41.0, 2.0, 5f, now)
        assertEquals(DistanceSource.Phone, Distances.resolve(hole(green = null), Units.M, fix, now).source)
        val none = Distances.resolve(hole(green = null, phone = null), Units.M, fix, now)
        assertFalse(none.hasAny)
        assertEquals(NoReading.NoGreen, none.reason)
        assertEquals(DistanceReading.None, Distances.resolve(null, Units.M, fix, now))
    }

    @Test
    fun partialGreenWithoutACentreCannotApplyTheOnHoleRule() {
        // The phone needs a finite centre to decide "on the hole"; front/back alone give nothing.
        val g = Green(LatLng(41.0005, 2.0), null, LatLng(41.0015, 2.0))
        val r = Distances.resolve(hole(green = g, phone = null), Units.M, Fix(41.0, 2.0, 5f, now), now)
        assertFalse(r.hasAny)
    }

    // --- the phone's rule: live within 1000 m of the centre, else from the tee, else nothing ---

    private val tee = LatLng(40.998, 2.0) // 333.6 m from the centre (0.003 deg)
    private val farAway = Fix(41.5, 2.0, 5f, now) // ~55 km north

    @Test
    fun withinAKilometreOfTheGreenIsLive() {
        val near = Fix(41.001 - 1000.0 / 111_195.0 + 0.00001, 2.0, 5f, now) // just inside 1000 m
        val r = Distances.resolve(hole(phone = null).copy(tee = tee), Units.M, near, now)
        assertFalse(r.fromTee)
        assertEquals(DistanceSource.Watch, r.source)
        assertTrue(r.center!! in 990..1000)
    }

    @Test
    fun beyondAKilometreItMeasuresFromTheTee() {
        val h = hole(phone = null).copy(tee = tee)
        val r = Distances.resolve(h, Units.M, farAway, now)
        assertTrue(r.fromTee)
        assertEquals(334, r.center) // tee -> centre, not the 55 km from the player
        assertEquals(278, r.front) // 0.0025 deg = 278 m
        assertEquals(389, r.back)
        // exactly at the limit still counts as on the hole (<=)
        val edge = Fix(41.001 - 1000.0 / 111_195.0 - 0.0005, 2.0, 5f, now)
        assertTrue(Distances.resolve(h, Units.M, edge, now).fromTee)
    }

    @Test
    fun noFixYetStillMeasuresFromTheTeeLikeThePhone() {
        val r = Distances.resolve(hole(phone = null).copy(tee = tee), Units.M, null, now)
        assertTrue(r.fromTee)
        assertEquals(334, r.center)
        assertTrue(Distances.resolve(hole(phone = null).copy(tee = tee), Units.M, Fix(41.0, 2.0, 80f, now), now).fromTee)
    }

    @Test
    fun beyondAKilometreWithoutATeeShowsNothingNeverAFarLine() {
        val r = Distances.resolve(hole(phone = null), Units.M, farAway, now)
        assertFalse(r.hasAny)
        assertEquals(NoReading.OffHole, r.reason)
        assertEquals(NoReading.NoFix, Distances.resolve(hole(phone = null), Units.M, null, now).reason)
    }

    @Test
    fun theTeeReadingBeatsTheWatchFixWhenOffTheHoleAndUnitsApply() {
        val h = hole(phone = null).copy(tee = tee)
        assertEquals(365, Distances.resolve(h, Units.YD, farAway, now).center) // 333.6 m = 364.8 yd
    }

    @Test
    fun phoneFiguresKeepTheirTeeLabel() {
        val h = hole(green = null, phone = PhoneDistances(300.0, 326.0, 339.0, "tee"))
        val r = Distances.resolve(h, Units.M, farAway, now)
        assertEquals(DistanceSource.Phone, r.source)
        assertTrue(r.fromTee)
        assertEquals(326, r.center)
    }
}
