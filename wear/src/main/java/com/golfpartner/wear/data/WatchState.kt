package com.golfpartner.wear.data

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** A point on the globe, as the phone sends it: `[lat, lng]`. */
data class LatLng(val lat: Double, val lng: Double)

/** Green geometry for the current hole; any part may be missing. */
data class Green(val front: LatLng?, val center: LatLng?, val back: LatLng?)

/** The phone's own distances to the green, always in metres. */
data class PhoneDistances(val front: Double?, val center: Double?, val back: Double?, val source: String)

data class HoleInfo(
    val number: Int,
    val count: Int,
    val par: Int,
    val si: Int?,
    val extraShots: Int,
    val green: Green?,
    val phone: PhoneDistances?,
) {
    /** The score that earns 2 Stableford points. */
    val netPar: Int get() = par + extraShots
    val isPar3: Boolean get() = par == 3
}

data class Me(
    val playerId: String?,
    val name: String,
    val strokes: Int?,
    val points: Int?,
    val totalPoints: Int,
    val thru: Int,
    val putts: Int?,
    val driveLie: String?,
    val sandShots: Int,
    val penalties: Int,
)

/** Settings -> Stats tracking: which entry steps exist. */
data class Track(val putting: Boolean, val teeShot: Boolean, val shortGame: Boolean, val penalties: Boolean) {
    companion object {
        val None = Track(putting = false, teeShot = false, shortGame = false, penalties = false)
    }
}

enum class Blocked {
    /** Leaving the hole opened the dispute sheet on the phone. */
    Dispute,
    ViewOnly,
    Official,
    /** A reason a newer phone invented; treat as "no entry". */
    Other,
}

enum class Units { M, YD }

/** One `/golf/state` payload. When [active] is false everything but [rev] is empty. */
data class WatchState(
    val rev: Long,
    /** Id of the last command the phone finished (applied, rejected or duplicate); null until it processed one. */
    val ack: String?,
    val active: Boolean,
    val roundId: String?,
    val courseName: String?,
    val blocked: Blocked?,
    val units: Units,
    val hole: HoleInfo?,
    val me: Me?,
    val track: Track,
) {
    /** Entry (the pill, the crown) is available only on an unblocked live round. */
    val canEnter: Boolean get() = active && blocked == null && hole != null && me != null

    companion object {
        val Inactive = WatchState(
            rev = 0, ack = null, active = false, roundId = null, courseName = null, blocked = null,
            units = Units.M, hole = null, me = null, track = Track.None,
        )
    }
}

sealed interface StateParse {
    data class Ok(val state: WatchState) : StateParse

    /** `v` is not one we speak: the watch app is older or newer than the phone's. */
    data class UnsupportedVersion(val v: Int?) : StateParse

    data object Invalid : StateParse
}

object WatchStateParser {
    fun parse(json: String): StateParse {
        val o = try {
            JSONObject(json)
        } catch (e: JSONException) {
            return StateParse.Invalid
        }
        val v = o.intOrNull("v")
        if (v != Protocol.VERSION) return StateParse.UnsupportedVersion(v)
        return try {
            StateParse.Ok(parseV1(o))
        } catch (e: JSONException) {
            StateParse.Invalid
        } catch (e: IllegalArgumentException) {
            StateParse.Invalid
        }
    }

    private fun parseV1(o: JSONObject): WatchState {
        val rev = o.longOrNull("rev") ?: throw IllegalArgumentException("rev")
        if (o.optBoolean("active", false).not()) {
            return WatchState.Inactive.copy(rev = rev, ack = o.stringOrNull("ack"))
        }
        val holeObj = o.optJSONObject("hole") ?: throw IllegalArgumentException("hole")
        val meObj = o.optJSONObject("me") ?: throw IllegalArgumentException("me")
        val trackObj = o.optJSONObject("track")
        return WatchState(
            rev = rev,
            ack = o.stringOrNull("ack"),
            active = true,
            roundId = o.stringOrNull("roundId") ?: throw IllegalArgumentException("roundId"),
            courseName = o.stringOrNull("courseName"),
            blocked = when (o.stringOrNull("blocked")) {
                null -> null
                "dispute" -> Blocked.Dispute
                "viewOnly" -> Blocked.ViewOnly
                "official" -> Blocked.Official
                else -> Blocked.Other
            },
            units = if (o.stringOrNull("units") == "yd") Units.YD else Units.M,
            hole = parseHole(holeObj),
            me = parseMe(meObj),
            track = Track(
                putting = trackObj?.optBoolean("putting", false) ?: false,
                teeShot = trackObj?.optBoolean("teeShot", false) ?: false,
                shortGame = trackObj?.optBoolean("shortGame", false) ?: false,
                penalties = trackObj?.optBoolean("penalties", false) ?: false,
            ),
        )
    }

    private fun parseHole(h: JSONObject): HoleInfo {
        val green = h.optJSONObject("green")?.let {
            Green(it.latLngOrNull("front"), it.latLngOrNull("center"), it.latLngOrNull("back"))
        }
        val phone = h.optJSONObject("phone")?.let {
            PhoneDistances(
                front = it.doubleOrNull("front"),
                center = it.doubleOrNull("center"),
                back = it.doubleOrNull("back"),
                source = it.stringOrNull("source") ?: "gps",
            )
        }
        return HoleInfo(
            number = h.intOrNull("number") ?: throw IllegalArgumentException("number"),
            count = h.intOrNull("count") ?: throw IllegalArgumentException("count"),
            par = h.intOrNull("par") ?: throw IllegalArgumentException("par"),
            si = h.intOrNull("si"),
            extraShots = h.intOrNull("extraShots") ?: 0,
            green = green,
            phone = phone,
        )
    }

    private fun parseMe(m: JSONObject) = Me(
        playerId = m.stringOrNull("playerId"),
        name = m.stringOrNull("name") ?: "",
        strokes = m.intOrNull("strokes"),
        points = m.intOrNull("points"),
        totalPoints = m.intOrNull("totalPoints") ?: 0,
        thru = m.intOrNull("thru") ?: 0,
        putts = m.intOrNull("putts"),
        driveLie = m.stringOrNull("driveLie"),
        sandShots = m.intOrNull("sandShots") ?: 0,
        penalties = m.intOrNull("penalties") ?: 0,
    )
}

// org.json's opt* helpers coerce (optInt turns null into 0); these keep null as null.
private fun JSONObject.rawOrNull(key: String): Any? = if (!has(key) || isNull(key)) null else opt(key)

private fun JSONObject.intOrNull(key: String): Int? = (rawOrNull(key) as? Number)?.toInt()

private fun JSONObject.longOrNull(key: String): Long? = (rawOrNull(key) as? Number)?.toLong()

private fun JSONObject.doubleOrNull(key: String): Double? = (rawOrNull(key) as? Number)?.toDouble()

private fun JSONObject.stringOrNull(key: String): String? = rawOrNull(key) as? String

private fun JSONObject.latLngOrNull(key: String): LatLng? {
    val a = rawOrNull(key) as? JSONArray ?: return null
    if (a.length() != 2) return null
    val lat = (a.opt(0) as? Number)?.toDouble() ?: return null
    val lng = (a.opt(1) as? Number)?.toDouble() ?: return null
    return LatLng(lat, lng)
}
