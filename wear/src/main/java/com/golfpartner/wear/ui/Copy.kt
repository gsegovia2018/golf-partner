package com.golfpartner.wear.ui

/** All user-facing English copy, as written in the plan. */
object Copy {
    const val INACTIVE = "Open a round on your phone to start."
    const val RESOLVE_ON_PHONE = "Resolve on phone"
    const val PHONE_NOT_CONNECTED = "Phone not connected"
    const val KEPT_ON_WATCH = "Scores are kept on the watch and sent when the phone is back."
    const val GETTING_FIX = "Getting GPS fix"
    const val LOCATION_OFF = "Allow location"
    const val SCORE_HOLE = "Score hole"
    const val UPDATE_WATCH = "Update the watch app"
    const val NEXT = "Next"
    const val SAVE = "Save"
    const val MORE = "More"

    fun holeHeader(number: Int, par: Int) = "HOLE $number · PAR $par"

    fun strokeIndex(si: Int?, extraShots: Int): String? {
        if (si == null) return null
        val shots = if (extraShots > 0) " · +$extraShots ${if (extraShots == 1) "shot" else "shots"}" else ""
        return "SI $si$shots"
    }

    fun points(n: Int) = "$n ${if (n == 1) "pt" else "pts"}"

    fun ghostPill(strokes: Int, pts: Int) = "$strokes · ${points(pts)}"

    fun waiting(holes: Int) = "$holes ${if (holes == 1) "hole" else "holes"} waiting"

    fun saved(hole: Int) = "Hole $hole saved"

    fun scoreAndTotal(pts: Int, total: Int) = "${points(pts)} · $total total"

    fun putts(n: Int) = "$n ${if (n == 1) "putt" else "putts"}"

    fun nextHole(n: Int) = "Hole $n ›"

    fun lieLabel(lie: String) = lie.replaceFirstChar { it.uppercase() }
}
