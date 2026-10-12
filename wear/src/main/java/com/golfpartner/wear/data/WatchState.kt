package com.golfpartner.wear.data

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** A point on the globe, as the phone sends it: `[lat, lng]`. */
data class LatLng(val lat: Double, val lng: Double)

/**
 * Green geometry for the current hole; any part may be missing. [outline] is the traced green,
 * sent only when there are no front/back points: front/back are then its nearest/farthest vertex.
 */
data class Green(val front: LatLng?, val center: LatLng?, val back: LatLng?, val outline: List<LatLng> = emptyList())

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
    /** Where the hole starts, for distances from the tee when the player is not on the hole. */
    val tee: LatLng? = null,
) {
    /** The score that earns 2 Stableford points. */
    val netPar: Int get() = par + extraShots
    val isPar3: Boolean get() = par == 3
}

/**
 * The watch-visible subset of the phone's per-hole shot detail (DEFAULT_SHOT).
 * Option strings are the phone's own storage keys; unknown values parse to null.
 */
data class ShotDetail(
    val putts: Int? = null,
    val drive: String? = null,
    /** Null means driver, like the phone. */
    val teeClub: String? = null,
    val driveDistBucket: String? = null,
    val teePenalties: Int = 0,
    val otherPenalties: Int = 0,
    val sandShots: Int = 0,
    val recoveryOutcome: String? = null,
    val firstPuttBucket: String? = null,
    val approachBucket: String? = null,
    val approachResult: String? = null,
    val approachMiss: String? = null,
    val approachBunker: Boolean = false,
)

data class Me(
    val playerId: String?,
    val name: String,
    val strokes: Int?,
    val points: Int?,
    val totalPoints: Int,
    val thru: Int,
    val shot: ShotDetail = ShotDetail(),
)

/** One hole of the whole-course state (`state.course.holes`). */
data class CourseHole(
    val number: Int,
    val par: Int,
    val si: Int?,
    val extraShots: Int,
    val green: Green?,
    val tee: LatLng?,
)

/** What the phone shows for me on one hole (`state.mine["<hole>"]`). */
data class MineHole(val strokes: Int?, val points: Int?, val shot: ShotDetail?)

/** Settings -> Stats tracking: which entry steps exist. */
data class Track(
    val putting: Boolean,
    val teeShot: Boolean,
    val shortGame: Boolean,
    val penalties: Boolean,
    val approach: Boolean = false,
) {
    companion object {
        val None = Track(putting = false, teeShot = false, shortGame = false, penalties = false, approach = false)
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

/**
 * The most recent watch command the phone refused (`state.lastReject`). [reason] is the
 * phone's ('hole', 'blocked', 'stale', 'refused', ...); [hole] is the hole the command was for
 * (a move's target).
 */
data class Reject(val id: String, val reason: String, val hole: Int?)

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
    /** Every hole of the round; empty from an older phone (then no instant hole switch). */
    val course: List<CourseHole> = emptyList(),
    /** What the phone shows for me on every hole, by hole number. */
    val mine: Map<Int, MineHole> = emptyMap(),
    /** The last command the phone refused; null from an older phone or before any. */
    val lastReject: Reject? = null,
) {
    /** Entry (the pill, the crown) is available only on an unblocked live round. */
    val canEnter: Boolean get() = active && blocked == null && hole != null && me != null

    /**
     * This state as if the phone were on hole [number]: par, SI, shots, green, tee and my
     * strokes/points/stats come from [course] and [mine] at once. The phone's own distances
     * belong to its hole and are dropped. Falls back to `this` for the phone's hole, an
     * unknown hole, or a phone that sends no course.
     */
    fun at(number: Int): WatchState {
        val cur = hole ?: return this
        if (number == cur.number) return this
        val ch = course.firstOrNull { it.number == number } ?: return this
        val m = me ?: return this
        val entry = mine[number]
        val strokes = entry?.strokes
        return copy(
            hole = HoleInfo(number, cur.count, ch.par, ch.si, ch.extraShots, ch.green, null, ch.tee),
            me = m.copy(
                strokes = strokes,
                points = entry?.points ?: strokes?.let { Entry.points(ch.par, ch.extraShots, it) },
                shot = entry?.shot ?: ShotDetail(),
            ),
        )
    }

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
            return WatchState.Inactive.copy(rev = rev, ack = o.stringOrNull("ack"), lastReject = parseReject(o.optJSONObject("lastReject")))
        }
        val holeObj = o.optJSONObject("hole") ?: throw IllegalArgumentException("hole")
        val meObj = o.optJSONObject("me") ?: throw IllegalArgumentException("me")
        val trackObj = o.optJSONObject("track")
        val course = parseCourse(o.optJSONObject("course"))
        val mine = parseMine(o.optJSONObject("mine"))
        val holeNumber = holeObj.intOrNull("number") ?: throw IllegalArgumentException("number")
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
            hole = parseHole(holeObj, course.firstOrNull { it.number == holeNumber }),
            me = parseMe(meObj, mine[holeNumber]),
            track = Track(
                putting = trackObj?.optBoolean("putting", true) ?: false,
                teeShot = trackObj?.optBoolean("teeShot", true) ?: false,
                shortGame = trackObj?.optBoolean("shortGame", true) ?: false,
                penalties = trackObj?.optBoolean("penalties", true) ?: false,
                approach = trackObj?.optBoolean("approach", true) ?: false,
            ),
            course = course,
            mine = mine,
            lastReject = parseReject(o.optJSONObject("lastReject")),
        )
    }

    private fun parseReject(r: JSONObject?): Reject? {
        val id = r?.stringOrNull("id") ?: return null
        return Reject(id, r.stringOrNull("reason") ?: "", r.intOrNull("hole"))
    }

    private fun parseGreen(g: JSONObject?) =
        g?.let { Green(it.latLngOrNull("front"), it.latLngOrNull("center"), it.latLngOrNull("back"), parseOutline(it.optJSONArray("outline"))) }

    private fun parseOutline(a: JSONArray?): List<LatLng> {
        if (a == null) return emptyList()
        return (0 until a.length()).mapNotNull { i ->
            val p = a.optJSONArray(i) ?: return@mapNotNull null
            if (p.length() != 2) return@mapNotNull null
            val lat = (p.opt(0) as? Number)?.toDouble() ?: return@mapNotNull null
            val lng = (p.opt(1) as? Number)?.toDouble() ?: return@mapNotNull null
            LatLng(lat, lng)
        }
    }

    private fun parseCourse(c: JSONObject?): List<CourseHole> {
        val arr = c?.optJSONArray("holes") ?: return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            val h = arr.optJSONObject(i) ?: return@mapNotNull null
            CourseHole(
                number = h.intOrNull("number") ?: return@mapNotNull null,
                par = h.intOrNull("par") ?: return@mapNotNull null,
                si = h.intOrNull("si"),
                extraShots = h.intOrNull("extraShots") ?: 0,
                green = parseGreen(h.optJSONObject("green")),
                tee = h.latLngOrNull("tee"),
            )
        }
    }

    private fun parseMine(m: JSONObject?): Map<Int, MineHole> {
        if (m == null) return emptyMap()
        val out = LinkedHashMap<Int, MineHole>()
        m.keys().forEach { key ->
            val n = key.toIntOrNull() ?: return@forEach
            val e = m.optJSONObject(key) ?: return@forEach
            out[n] = MineHole(e.intOrNull("strokes"), e.intOrNull("points"), e.optJSONObject("shot")?.let { parseShot(it) })
        }
        return out
    }

    private fun parseShot(o: JSONObject) = ShotDetail(
        putts = o.intOrNull("putts"),
        drive = o.optionOrNull("drive", Options.DRIVES),
        teeClub = o.optionOrNull("teeClub", Options.CLUBS)?.takeIf { it != "driver" },
        driveDistBucket = o.optionOrNull("driveDistBucket", Options.DRIVE_DIST),
        teePenalties = o.intOrNull("teePenalties") ?: 0,
        otherPenalties = o.intOrNull("otherPenalties") ?: 0,
        sandShots = o.intOrNull("sandShots") ?: 0,
        recoveryOutcome = o.optionOrNull("recoveryOutcome", Options.RECOVERY),
        firstPuttBucket = o.optionOrNull("firstPuttBucket", Options.FIRST_PUTT),
        approachBucket = o.optionOrNull("approachBucket", Options.APPROACH),
        approachResult = o.optionOrNull("approachResult", Options.APPROACH_RESULTS),
        approachMiss = o.optionOrNull("approachMiss", Options.MISS_DIRS),
        approachBunker = (o.rawOrNull("approachBunker") as? Boolean) ?: false,
    )

    private fun parseHole(h: JSONObject, fromCourse: CourseHole?): HoleInfo {
        val green = parseGreen(h.optJSONObject("green"))
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
            tee = h.latLngOrNull("tee") ?: fromCourse?.tee,
        )
    }

    /** The current hole's detail comes from `mine`; an older phone only sends putts/sand/penalties on `me`. */
    private fun parseMe(m: JSONObject, mineNow: MineHole?) = Me(
        playerId = m.stringOrNull("playerId"),
        name = m.stringOrNull("name") ?: "",
        strokes = m.intOrNull("strokes"),
        points = m.intOrNull("points"),
        totalPoints = m.intOrNull("totalPoints") ?: 0,
        thru = m.intOrNull("thru") ?: 0,
        shot = mineNow?.shot ?: ShotDetail(
            putts = m.intOrNull("putts"),
            sandShots = m.intOrNull("sandShots") ?: 0,
            otherPenalties = m.intOrNull("penalties") ?: 0,
        ),
    )
}

// org.json's opt* helpers coerce (optInt turns null into 0); these keep null as null.
private fun JSONObject.rawOrNull(key: String): Any? = if (!has(key) || isNull(key)) null else opt(key)

private fun JSONObject.intOrNull(key: String): Int? = (rawOrNull(key) as? Number)?.toInt()

private fun JSONObject.longOrNull(key: String): Long? = (rawOrNull(key) as? Number)?.toLong()

private fun JSONObject.doubleOrNull(key: String): Double? = (rawOrNull(key) as? Number)?.toDouble()

private fun JSONObject.stringOrNull(key: String): String? = rawOrNull(key) as? String

private fun JSONObject.optionOrNull(key: String, allowed: List<String>): String? =
    stringOrNull(key)?.takeIf { it in allowed }

private fun JSONObject.latLngOrNull(key: String): LatLng? {
    val a = rawOrNull(key) as? JSONArray ?: return null
    if (a.length() != 2) return null
    val lat = (a.opt(0) as? Number)?.toDouble() ?: return null
    val lng = (a.opt(1) as? Number)?.toDouble() ?: return null
    return LatLng(lat, lng)
}
