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

/** Whole numbers in the display unit, ready to print. Parts may be missing individually. */
data class DistanceReading(val front: Int?, val center: Int?, val back: Int?, val source: DistanceSource) {
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

    /** Watch fix (accurate enough) -> phone's figures from the state -> nothing. */
    fun resolve(hole: HoleInfo?, units: Units, fix: Fix?, nowMs: Long): DistanceReading {
        if (hole == null) return DistanceReading.None
        val green = hole.green
        if (green != null && fixIsUsable(fix, nowMs)) {
            val here = LatLng(fix!!.lat, fix.lng)
            val reading = DistanceReading(
                front = green.front?.let { display(haversineMeters(here, it), units) },
                center = green.center?.let { display(haversineMeters(here, it), units) },
                back = green.back?.let { display(haversineMeters(here, it), units) },
                source = DistanceSource.Watch,
            )
            if (reading.hasAny) return reading
        }
        val phone = hole.phone
        if (phone != null) {
            val reading = DistanceReading(
                front = phone.front?.let { display(it, units) },
                center = phone.center?.let { display(it, units) },
                back = phone.back?.let { display(it, units) },
                source = DistanceSource.Phone,
            )
            if (reading.hasAny) return reading
        }
        return DistanceReading.None
    }
}
