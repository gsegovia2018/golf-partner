package com.golfpartner.wear.ui

import com.golfpartner.wear.data.Notice
import com.golfpartner.wear.data.Units

/** All user-facing English copy, as written in the plan. */
object Copy {
    const val INACTIVE = "Open a round on your phone to start."
    const val RESOLVE_ON_PHONE = "Resolve on phone"
    const val PHONE_NOT_CONNECTED = "Phone not connected"
    const val KEPT_ON_WATCH = "Scores are kept on the watch and sent when the phone is back."
    const val GETTING_FIX = "Getting GPS fix"
    const val LOCATION_OFF = "Allow location"
    const val TEE_SHOT = "TEE SHOT"
    const val PAR3_NOTE = "Par 3 · no tee shot"
    const val SET_STROKES_FIRST = "Set strokes first"
    const val STROKES = "STROKES"
    const val PUTTS = "Putts"
    const val SAND = "Sand"
    const val PENALTY = "Penalty"
    const val UPDATE_WATCH = "Update the watch app"

    fun holeHeader(number: Int, par: Int) = "HOLE $number · PAR $par"

    fun strokeIndex(si: Int?, extraShots: Int): String? {
        if (si == null) return null
        val shots = if (extraShots > 0) " · +$extraShots ${if (extraShots == 1) "shot" else "shots"}" else ""
        return "SI $si$shots"
    }

    fun points(n: Int) = "$n ${if (n == 1) "pt" else "pts"}"

    fun waiting(holes: Int) = "$holes ${if (holes == 1) "hole" else "holes"} waiting"

    fun scoreAndTotal(pts: Int, total: Int) = "${points(pts)} · $total total"

    /** The score page's footer; no points while the hole is unscored. */
    fun footer(pts: Int?, total: Int) = if (pts == null) "$total total" else scoreAndTotal(pts, total)

    /** Under the inputs of a hole shown ahead of the phone: they wait for the phone to arrive. */
    fun movingToHole(number: Int) = "Moving to hole $number…"

    const val MOVE_FAILED = "Couldn't change hole — check phone"

    fun notSaved(hole: Int) = "Not saved — hole $hole"

    fun notice(n: Notice) = when (n) {
        is Notice.NotSaved -> notSaved(n.hole)
        Notice.MoveFailed -> MOVE_FAILED
        Notice.ResolveOnPhone -> RESOLVE_ON_PHONE
    }

    /** The hole being moved to, before the phone confirms (its par is not known here). */
    fun movingTo(number: Int) = "HOLE $number"

    fun maxFor(strokes: Int) = "Max for $strokes ${if (strokes == 1) "stroke" else "strokes"}"

    const val STROKES_LABEL = "Strokes"
    const val SET_DISTANCE_FIRST = "Set distance first"
    const val SET_PUTTS_FIRST = "Set putts first"
    const val FROM_TEE = "FROM TEE"
    const val OFF_HOLE = "Away from the hole"
    const val NO_GREEN = "No green data"
    const val TEE_PENALTIES = "Tee pen."
    const val OTHER_PENALTIES = "Other pen."
    const val CLUB = "Club"
    const val NOT_SET = "–"
    const val ON_GREEN = "On green"
    const val BUNKER = "Bunker"
    const val FINISH = "Finished"
    const val DIRECTION = "Direction"
    const val FIRST_PUTT = "First putt"
    const val SHORT_GAME = "SHORT GAME"
    const val APPROACH = "APPROACH"
    const val HOLE_DISTANCE = "HOLE DISTANCE"

    fun driveLabel(key: String) = when (key) {
        "left" -> "Left"
        "fairway" -> "Fairway"
        "right" -> "Right"
        "short" -> "Short"
        "super" -> "Super"
        else -> key
    }

    fun clubLabel(key: String) = key.replaceFirstChar { it.uppercase() }

    fun finishLabel(key: String) = when (key) {
        "green" -> ON_GREEN
        "bunker" -> BUNKER
        else -> key.replaceFirstChar { it.uppercase() }
    }

    fun recoveryLabel(key: String) = if (key == "up-and-down") "Up & Down" else "Sand Save"

    /** Bucket labels as the phone prints them (constants.js), metres or the yard equivalents. */
    fun driveDistLabel(key: String, units: Units) = if (units == Units.YD) {
        mapOf("0-150" to "<165", "150-180" to "165-195", "180-210" to "195-230", "210-240" to "230-260", "240+" to "260+")[key] ?: key
    } else {
        if (key == "0-150") "<150" else key
    }

    fun approachLabel(key: String, units: Units) = if (units == Units.YD) {
        mapOf("0-50" to "0-55", "50-100" to "55-110", "100-150" to "110-165", "150-200" to "165-220", "200+" to "220+")[key] ?: key
    } else {
        key
    }

    fun firstPuttLabel(key: String, units: Units) = if (units == Units.YD) {
        mapOf("3-6" to "3-7", "6+" to "7+")[key] ?: key
    } else {
        key
    }

    fun unitWord(units: Units) = if (units == Units.YD) "yards" else "metres"
}
