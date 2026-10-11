package com.golfpartner.wear.data

import kotlin.math.max
import kotlin.math.min

/**
 * What the Score and Stats pages collect for a hole, from Settings -> Stats
 * tracking: putting -> putts, teeShot -> lie (never on a par 3, which gets a
 * note instead), shortGame -> sand, penalties -> penalty.
 */
data class EntryPlan(
    val hasSand: Boolean,
    val hasPenalty: Boolean,
    val hasPutts: Boolean,
    val hasLie: Boolean,
    /** Tee shot tracking is on but the hole is a par 3: the Stats page says so. */
    val par3Note: Boolean,
) {
    /** Whether the Stats page has anything to edit. */
    val hasStatsPage: Boolean get() = hasLie || hasSand || hasPenalty
}

/** The values being entered; seeded from the phone's saved ones. Null = not set. */
data class EntryDraft(
    val strokes: Int?,
    val putts: Int?,
    val lie: String?,
    val sand: Int,
    val penalty: Int,
)

object Entry {
    const val STROKES_MAX = 15
    const val PUTTS_MAX = 10
    const val EXTRAS_MAX = 9

    /** First tap on putts lands here. */
    const val PUTTS_FIRST = 2

    val LIES = listOf("fairway", "rough", "sand", "trouble")

    fun plan(hole: HoleInfo, track: Track) = EntryPlan(
        hasSand = track.shortGame,
        hasPenalty = track.penalties,
        hasPutts = track.putting,
        hasLie = track.teeShot && !hole.isPar3,
        par3Note = track.teeShot && hole.isPar3,
    )

    /** Stableford: 2 + par + extraShots - strokes, never below 0. */
    fun points(hole: HoleInfo, strokes: Int): Int = max(0, 2 + hole.par + hole.extraShots - strokes)

    /** This hole's points (null while unscored) and the round total with it counted. */
    fun pointsAndTotal(hole: HoleInfo, me: Me, strokes: Int?): Pair<Int?, Int> {
        val pts = strokes?.let { points(hole, it) }
        return pts to me.totalPoints - (me.points ?: 0) + (pts ?: 0)
    }

    fun puttsMax(strokes: Int): Int = min(strokes, PUTTS_MAX)

    fun initialDraft(hole: HoleInfo, me: Me): EntryDraft {
        val strokes = me.strokes?.coerceIn(1, STROKES_MAX)
        return EntryDraft(
            strokes = strokes,
            putts = if (strokes == null) null else me.putts?.coerceIn(0, puttsMax(strokes)),
            lie = me.driveLie?.takeIf { it in LIES },
            sand = me.sandShots.coerceIn(0, EXTRAS_MAX),
            penalty = me.penalties.coerceIn(0, EXTRAS_MAX),
        )
    }

    // --- one step of each input (a +/- tap or a crown tick) ---

    /** Unset: the first step up lands on the hole's PAR (the phone's "first tap lands on par"); down stays unset. */
    fun stepStrokes(hole: HoleInfo, plan: EntryPlan, draft: EntryDraft, me: Me, delta: Int): EntryDraft {
        val cur = draft.strokes
        val next = when {
            cur == null -> if (delta > 0) hole.par.coerceIn(1, STROKES_MAX) else return draft
            else -> (cur + delta).coerceIn(1, STROKES_MAX)
        }
        return reconcile(plan, draft.copy(strokes = next), me)
    }

    /** Needs strokes. Unset: the first step up lands on 2 (or the strokes if fewer). */
    fun stepPutts(plan: EntryPlan, draft: EntryDraft, me: Me, delta: Int): EntryDraft {
        val strokes = draft.strokes ?: return draft
        val max = puttsMax(strokes)
        val cur = draft.putts
        val next = when {
            cur == null -> if (delta > 0) min(PUTTS_FIRST, max) else return draft
            else -> (cur + delta).coerceIn(0, max)
        }
        return fitExtras(plan, draft.copy(putts = next), me)
    }

    fun stepSand(plan: EntryPlan, draft: EntryDraft, me: Me, delta: Int): EntryDraft {
        if (draft.strokes == null) return draft
        val next = if (delta > 0) min(draft.sand + delta, max(sandMax(plan, draft, me), draft.sand)) else max(0, draft.sand + delta)
        return draft.copy(sand = next)
    }

    fun stepPenalty(plan: EntryPlan, draft: EntryDraft, me: Me, delta: Int): EntryDraft {
        if (draft.strokes == null) return draft
        val next = if (delta > 0) min(draft.penalty + delta, max(penaltyMax(plan, draft, me), draft.penalty)) else max(0, draft.penalty + delta)
        return draft.copy(penalty = next)
    }

    /** Tapping the selected lie clears it. Needs strokes (the phone refuses a shot without them). */
    fun toggleLie(draft: EntryDraft, lie: String): EntryDraft =
        if (draft.strokes == null) draft else draft.copy(lie = if (draft.lie == lie) null else lie)

    /** Only the stats the plan collects; null when none are. Putts are left out while unset. */
    fun shotPatch(plan: EntryPlan, draft: EntryDraft): Map<String, Any?>? {
        val strokes = draft.strokes ?: return null
        val patch = LinkedHashMap<String, Any?>()
        if (plan.hasPutts) draft.putts?.let { patch[ShotKeys.PUTTS] = it.coerceIn(0, puttsMax(strokes)) }
        if (plan.hasLie) patch[ShotKeys.DRIVE_LIE] = draft.lie
        if (plan.hasSand) patch[ShotKeys.SAND_SHOTS] = draft.sand
        if (plan.hasPenalty) patch[ShotKeys.OTHER_PENALTIES] = draft.penalty
        return patch.ifEmpty { null }
    }

    /*
     * Shot detail vs strokes, mirroring the phone's reconcileShotDetail
     * (src/store/scoring.js): putts + sand + other penalties + tee penalties
     * never exceed strokes; when they do, the phone trims putts, then sand,
     * then other penalties. Fields this plan does not collect count with the
     * phone's values; tee penalties are a phone-only input the watch cannot
     * see, so they count as 0 here (the phone may still trim on top of them).
     */
    private fun counted(plan: EntryPlan, draft: EntryDraft, me: Me) = Triple(
        if (plan.hasPutts) draft.putts ?: 0 else me.putts ?: 0,
        if (plan.hasSand) draft.sand else me.sandShots,
        if (plan.hasPenalty) draft.penalty else me.penalties,
    )

    /** The sand stepper's ceiling: what the strokes leave after putts and penalties. */
    fun sandMax(plan: EntryPlan, draft: EntryDraft, me: Me): Int {
        val (putts, _, penalty) = counted(plan, draft, me)
        return ((draft.strokes ?: 0) - putts - penalty).coerceIn(0, EXTRAS_MAX)
    }

    /** The penalty stepper's ceiling: what the strokes leave after putts and sand. */
    fun penaltyMax(plan: EntryPlan, draft: EntryDraft, me: Me): Int {
        val (putts, sand, _) = counted(plan, draft, me)
        return ((draft.strokes ?: 0) - putts - sand).coerceIn(0, EXTRAS_MAX)
    }

    /** A sand or penalty "+" is disabled by the strokes cap (not by [EXTRAS_MAX]). */
    fun extrasCapped(plan: EntryPlan, draft: EntryDraft, me: Me): Boolean {
        if (draft.strokes == null) return false
        val sand = plan.hasSand && sandMax(plan, draft, me).let { it < EXTRAS_MAX && draft.sand >= it }
        val pen = plan.hasPenalty && penaltyMax(plan, draft, me).let { it < EXTRAS_MAX && draft.penalty >= it }
        return sand || pen
    }

    /** The phone's trim (putts, then sand, then penalty), applied to the fields this plan collects. */
    fun reconcile(plan: EntryPlan, draft: EntryDraft, me: Me): EntryDraft {
        val strokes = draft.strokes ?: return draft
        val (putts, sand, penalty) = counted(plan, draft, me)
        var over = putts + sand + penalty - strokes
        if (over <= 0) return draft
        fun trim(v: Int): Int = (v - minOf(v, over)).also { over -= v - it }
        val p = trim(putts)
        val sa = trim(sand)
        val pe = trim(penalty)
        return draft.copy(
            putts = if (plan.hasPutts) p else draft.putts,
            sand = if (plan.hasSand) sa else draft.sand,
            penalty = if (plan.hasPenalty) pe else draft.penalty,
        )
    }

    /**
     * After the putts are chosen: seeded sand/penalty that no longer fit give
     * way (sand first), so the putts just entered are not what the phone trims.
     */
    fun fitExtras(plan: EntryPlan, draft: EntryDraft, me: Me): EntryDraft {
        val sand = if (plan.hasSand) minOf(draft.sand, sandMax(plan, draft.copy(sand = 0), me)) else draft.sand
        val fitted = draft.copy(sand = sand)
        val penalty = if (plan.hasPenalty) minOf(draft.penalty, penaltyMax(plan, fitted, me)) else draft.penalty
        return fitted.copy(penalty = penalty)
    }

    /** Whether [a] and [b] are the same round and hole. */
    fun sameHole(a: WatchState, b: WatchState): Boolean =
        a.roundId == b.roundId && a.hole?.number == b.hole?.number

    /**
     * Whether edits made on [opened] still belong to the phone's [now]: same
     * round, same hole, still active. If not, they are sent as they are (for
     * [opened]'s hole) and never re-targeted.
     */
    fun stillOn(opened: WatchState, now: WatchState?): Boolean =
        now != null && now.active && now.roundId == opened.roundId && now.hole?.number == opened.hole?.number

    /** `strokes` first, then one `shot` if there is anything to say. Nothing while strokes are unset. */
    fun saveCommands(state: WatchState, plan: EntryPlan, draft: EntryDraft): List<Command> {
        val hole = state.hole ?: return emptyList()
        val roundId = state.roundId ?: return emptyList()
        val strokes = draft.strokes ?: return emptyList()
        val out = mutableListOf(Commands.strokes(roundId, state.rev, hole.number, strokes))
        shotPatch(plan, draft)?.let { out += Commands.shot(roundId, state.rev, hole.number, it) }
        return out
    }
}

/** Page kinds of the pager, in swipe order. */
enum class PageKind { Distances, Score, Stats }

object Pages {
    /**
     * Distances always. Score and Stats only where the watch may enter (not
     * viewOnly/official/unknown blocks); Stats only if it has any row. A
     * dispute keeps the pages (they say "Resolve on phone") with inputs off.
     */
    fun of(state: WatchState): List<PageKind> {
        val hole = state.hole
        val enter = state.active && state.me != null &&
            (state.blocked == null || state.blocked == Blocked.Dispute)
        if (hole == null || !enter) return listOf(PageKind.Distances)
        return buildList {
            add(PageKind.Distances)
            add(PageKind.Score)
            if (Entry.plan(hole, state.track).hasStatsPage) add(PageKind.Stats)
        }
    }
}

/** Turns a stream of scroll deltas (crown, vertical drag) into whole steps; the remainder carries over. */
class StepAccumulator(private val stepPx: Float) {
    private var carry = 0f

    /** Feeds [delta]; returns the signed number of steps now due (usually 0 or +-1). */
    fun feed(delta: Float): Int {
        if (delta != 0f && (delta > 0) != (carry > 0) && carry != 0f) carry = 0f // reversed: start over
        carry += delta
        val steps = (carry / stepPx).toInt()
        carry -= steps * stepPx
        return steps
    }

    fun reset() {
        carry = 0f
    }
}
