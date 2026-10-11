package com.golfpartner.wear.ui

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

    /** The hole being moved to, before the phone confirms (its par is not known here). */
    fun movingTo(number: Int) = "HOLE $number"

    fun maxFor(strokes: Int) = "Max for $strokes ${if (strokes == 1) "stroke" else "strokes"}"

    /** Short tee-shot labels, one per [com.golfpartner.wear.data.Entry.LIES]. */
    fun lieLabel(lie: String) = when (lie) {
        "fairway" -> "Fwy"
        "rough" -> "Rgh"
        "sand" -> "Sand"
        "trouble" -> "Trbl"
        else -> lie.replaceFirstChar { it.uppercase() }
    }
}
