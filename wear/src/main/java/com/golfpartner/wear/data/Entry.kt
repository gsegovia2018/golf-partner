package com.golfpartner.wear.data

import kotlin.math.max
import kotlin.math.min

enum class Step { Strokes, Putts, Tee, Extras }

/**
 * Which entry screens a hole gets. Strokes is always first. Settings -> Stats
 * tracking decides the rest: putting -> Putts, teeShot -> Tee (never on a
 * par 3), shortGame -> sand, penalties -> penalty. Sand and penalty live on
 * Extras: reached through "More" on Tee, or as the third step when Tee is
 * absent.
 */
data class EntryPlan(
    val steps: List<Step>,
    val hasSand: Boolean,
    val hasPenalty: Boolean,
    val hasPutts: Boolean,
    val hasLie: Boolean,
) {
    /** Tee shows a "More" button leading to Extras. */
    val teeHasMore: Boolean get() = hasLie && (hasSand || hasPenalty)

    /** The step a "Next" leads to, or null when [step] is the last (its button says Save). */
    fun after(step: Step): Step? {
        val i = steps.indexOf(step)
        return if (i < 0) null else steps.getOrNull(i + 1)
    }
}

/** The values being entered; seeded from the phone's saved ones. */
data class EntryDraft(
    val strokes: Int,
    val putts: Int,
    val lie: String?,
    val sand: Int,
    val penalty: Int,
)

object Entry {
    const val STROKES_MAX = 15
    const val PUTTS_MAX = 10
    const val EXTRAS_MAX = 9

    val LIES = listOf("fairway", "rough", "sand", "trouble")

    fun plan(hole: HoleInfo, track: Track): EntryPlan {
        val lie = track.teeShot && !hole.isPar3
        val extras = track.shortGame || track.penalties
        val steps = buildList {
            add(Step.Strokes)
            if (track.putting) add(Step.Putts)
            if (lie) add(Step.Tee) else if (extras) add(Step.Extras)
        }
        return EntryPlan(
            steps = steps,
            hasSand = track.shortGame,
            hasPenalty = track.penalties,
            hasPutts = track.putting,
            hasLie = lie,
        )
    }

    /** Stableford: 2 + par + extraShots - strokes, never below 0. */
    fun points(hole: HoleInfo, strokes: Int): Int = max(0, 2 + hole.par + hole.extraShots - strokes)

    fun isNetPar(hole: HoleInfo, strokes: Int): Boolean = strokes == hole.netPar

    fun puttsMax(strokes: Int): Int = min(strokes, PUTTS_MAX)

    fun initialStrokes(hole: HoleInfo, me: Me): Int = (me.strokes ?: hole.netPar).coerceIn(1, STROKES_MAX)

    fun initialPutts(me: Me, strokes: Int): Int = (me.putts ?: 2).coerceIn(0, puttsMax(strokes))

    fun initialDraft(hole: HoleInfo, me: Me): EntryDraft {
        val strokes = initialStrokes(hole, me)
        return EntryDraft(
            strokes = strokes,
            putts = initialPutts(me, strokes),
            lie = me.driveLie?.takeIf { it in LIES },
            sand = me.sandShots.coerceIn(0, EXTRAS_MAX),
            penalty = me.penalties.coerceIn(0, EXTRAS_MAX),
        )
    }

    /** Only the stats the plan collects; null when none are (no `shot` command then). */
    fun shotPatch(plan: EntryPlan, draft: EntryDraft): Map<String, Any?>? {
        val patch = LinkedHashMap<String, Any?>()
        if (plan.hasPutts) patch[ShotKeys.PUTTS] = draft.putts.coerceIn(0, puttsMax(draft.strokes))
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
        if (plan.hasPutts) draft.putts else me.putts ?: 0,
        if (plan.hasSand) draft.sand else me.sandShots,
        if (plan.hasPenalty) draft.penalty else me.penalties,
    )

    /** The sand stepper's ceiling: what the strokes leave after putts and penalties. */
    fun sandMax(plan: EntryPlan, draft: EntryDraft, me: Me): Int {
        val (putts, _, penalty) = counted(plan, draft, me)
        return (draft.strokes - putts - penalty).coerceIn(0, EXTRAS_MAX)
    }

    /** The penalty stepper's ceiling: what the strokes leave after putts and sand. */
    fun penaltyMax(plan: EntryPlan, draft: EntryDraft, me: Me): Int {
        val (putts, sand, _) = counted(plan, draft, me)
        return (draft.strokes - putts - sand).coerceIn(0, EXTRAS_MAX)
    }

    /** The phone's trim (putts, then sand, then penalty), applied to the fields this plan collects. */
    fun reconcile(plan: EntryPlan, draft: EntryDraft, me: Me): EntryDraft {
        val (putts, sand, penalty) = counted(plan, draft, me)
        var over = putts + sand + penalty - draft.strokes
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

    /**
     * Whether an entry (or its Saved screen) opened on [opened] still stands
     * against the phone's [now]: same round, same hole, still active. If the
     * phone moved on, the screen goes home and nothing is written.
     */
    fun stillOn(opened: WatchState, now: WatchState?): Boolean =
        now != null && now.active && now.roundId == opened.roundId && now.hole?.number == opened.hole?.number

    /** `strokes` first, then one `shot` if there is anything to say. */
    fun saveCommands(state: WatchState, plan: EntryPlan, draft: EntryDraft): List<Command> {
        val hole = state.hole ?: return emptyList()
        val roundId = state.roundId ?: return emptyList()
        val out = mutableListOf(Commands.strokes(roundId, state.rev, hole.number, draft.strokes))
        shotPatch(plan, draft)?.let { out += Commands.shot(roundId, state.rev, hole.number, it) }
        return out
    }
}

/** What the Saved screen shows, frozen at save time. */
data class SavedSummary(
    val hole: Int,
    val holeCount: Int,
    val strokes: Int,
    val points: Int,
    val totalPoints: Int,
    val putts: Int?,
    val lie: String?,
) {
    val hasNext: Boolean get() = hole < holeCount

    companion object {
        fun of(state: WatchState, plan: EntryPlan, draft: EntryDraft): SavedSummary? {
            val hole = state.hole ?: return null
            val me = state.me ?: return null
            val pts = Entry.points(hole, draft.strokes)
            return SavedSummary(
                hole = hole.number,
                holeCount = hole.count,
                strokes = draft.strokes,
                points = pts,
                totalPoints = me.totalPoints - (me.points ?: 0) + pts,
                putts = if (plan.hasPutts) draft.putts else null,
                lie = if (plan.hasLie) draft.lie else null,
            )
        }
    }
}
