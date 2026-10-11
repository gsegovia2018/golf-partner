package com.golfpartner.wear.data

import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** A watch location fix. [accuracyM] null means the provider did not say. */
data class Fix(val lat: Double, val lng: Double, val accuracyM: Float?, val timeMs: Long)

enum class DistanceSource { Watch, Phone, None }

/** Why there is no reading, for the status line under the dash. */
enum class NoReading { NoFix, OffHole, NoGreen }

/**
 * Whole numbers in the display unit, ready to print. Parts may be missing individually.
 * [fromTee] = measured from the tee (the player is off the hole), like the phone's source 'tee'.
 */
data class DistanceReading(
    val front: Int?,
    val center: Int?,
    val back: Int?,
    val source: DistanceSource,
    val fromTee: Boolean = false,
    val reason: NoReading? = null,
) {
    val hasAny: Boolean get() = front != null || center != null || back != null

    companion object {
        val None = DistanceReading(null, null, null, DistanceSource.None)
    }
}

object Distances {
    /** Same figures as src/lib/geo.js (earth radius) and src/lib/units.js (M_TO_YD). */
    private const val EARTH_RADIUS_M = 6_371_000.0
    private const val M_TO_YD = 1.09361

    /** A fix less accurate than this is not trusted over the phone's figures. */
    const val MAX_ACCURACY_M = 30f

    /** A fix older than this is stale (the screen was off, the provider stalled). */
    const val MAX_FIX_AGE_MS = 30_000L

    fun haversineMeters(a: LatLng, b: LatLng): Double {
        val rad = PI / 180
        val dLat = (b.lat - a.lat) * rad
        val dLng = (b.lng - a.lng) * rad
        val s = sin(dLat / 2) * sin(dLat / 2) +
            cos(a.lat * rad) * cos(b.lat * rad) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * EARTH_RADIUS_M * asin(sqrt(s))
    }

    /** Metres -> the display unit, rounded to a whole number exactly as the phone's formatDistance does. */
    fun display(meters: Double, units: Units): Int =
        (if (units == Units.YD) meters * M_TO_YD else meters).roundToInt()

    fun fixIsUsable(fix: Fix?, nowMs: Long): Boolean =
        fix != null &&
            (fix.accuracyM ?: Float.MAX_VALUE) <= MAX_ACCURACY_M &&
            nowMs - fix.timeMs <= MAX_FIX_AGE_MS

    /** src/lib/flyoverModel.js ANCHOR_MAX_GPS_METERS. */
    const val ANCHOR_MAX_GPS_M = 1000.0

    private fun reading(from: LatLng, g: Green, units: Units, fromTee: Boolean) = DistanceReading(
        front = g.front?.let { display(haversineMeters(from, it), units) },
        center = g.center?.let { display(haversineMeters(from, it), units) },
        back = g.back?.let { display(haversineMeters(from, it), units) },
        source = DistanceSource.Watch,
        fromTee = fromTee,
    )

    /**
     * The phone's resolveScorecardDistances: a usable fix within 1000 m of the green centre gives
     * live distances; otherwise, when the hole has a tee, distances measured from the tee
     * (also while there is no fix yet); otherwise nothing, never a straight line from far away.
     * The phone's own figures (already ruled by it) fill in when the watch cannot decide.
     */
    fun resolve(hole: HoleInfo?, units: Units, fix: Fix?, nowMs: Long): DistanceReading {
        if (hole == null) return DistanceReading.None
        val green = hole.green
        val here = fix?.takeIf { fixIsUsable(it, nowMs) }?.let { LatLng(it.lat, it.lng) }
        if (green != null) {
            val center = green.center
            if (here != null && center != null && haversineMeters(here, center) <= ANCHOR_MAX_GPS_M) {
                return reading(here, green, units, fromTee = false)
            }
            hole.tee?.let { tee ->
                val r = reading(tee, green, units, fromTee = true)
                if (r.hasAny) return r
            }
        }
        hole.phone?.let { p ->
            val r = DistanceReading(
                front = p.front?.let { display(it, units) },
                center = p.center?.let { display(it, units) },
                back = p.back?.let { display(it, units) },
                source = DistanceSource.Phone,
                fromTee = p.source == "tee",
            )
            if (r.hasAny) return r
        }
        val why = when {
            green == null -> NoReading.NoGreen
            here == null -> NoReading.NoFix
            else -> NoReading.OffHole
        }
        return DistanceReading.None.copy(reason = why)
    }
}
