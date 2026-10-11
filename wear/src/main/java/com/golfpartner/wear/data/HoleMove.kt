package com.golfpartner.wear.data

/** A short notice over the round screens; the UI words it (Copy.notice). */
sealed interface Notice {
    /** The phone refused a strokes/shot save for [hole]; its values show again. */
    data class NotSaved(val hole: Int) : Notice

    /** A hole picked on the watch never arrived on the phone. */
    data object MoveFailed : Notice

    /** The phone stayed put because leaving the hole opened its dispute sheet. */
    data object ResolveOnPhone : Notice
}

/**
 * The watch shows a hole picked by crown or swipe at once ([WatchState.at]), ahead of the
 * phone. The phone only takes strokes/stats for the hole it is on, so until it confirms the
 * move the picked hole is look-only.
 */
object HoleMove {
    /** The hole being moved to while the phone is still elsewhere, else null. */
    fun movingTo(target: Int?, phoneHole: Int): Int? = target?.takeIf { it != phoneHole }

    /** Inputs are live only on an enterable state whose hole is the phone's own. */
    fun inputsOn(shown: WatchState, movingTo: Int?): Boolean = shown.canEnter && movingTo == null

    /**
     * A move in flight that the phone's state shows will not happen: blocked by a dispute
     * (leaving the hole opened the sheet) or anything else. Null while it may still land.
     */
    fun failure(phone: WatchState): Notice? = when (phone.blocked) {
        null -> null
        Blocked.Dispute -> Notice.ResolveOnPhone
        else -> Notice.MoveFailed
    }
}
