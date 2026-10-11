package com.golfpartner.wear.data

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** The phone's option lists (src/components/scorecard/constants.js), as storage keys. */
object Options {
    /** Display order of the drive direction row. */
    val DRIVES = listOf("left", "fairway", "right", "short", "super")
    val CLUBS = listOf("driver", "wood", "hybrid", "iron")
    val DRIVE_DIST = listOf("0-150", "150-180", "180-210", "210-240", "240+")
    val FIRST_PUTT = listOf("0-1", "1-2", "2-3", "3-6", "6+")
    val APPROACH = listOf("0-50", "50-100", "100-150", "150-200", "200+")
    val RECOVERY = listOf("up-and-down", "sand-save", "none")
    val APPROACH_RESULTS = listOf("green", "miss")
    val MISS_DIRS = listOf("long", "short", "left", "right")
}

/**
 * What the entry pages collect for a hole, from Settings -> Stats tracking and the phone's
 * ShotDetailPanel par-3 rules: the panel hides tee club / drive direction / drive distance
 * and the approach finish rows on a par 3 (the approach distance stays, as "hole distance"),
 * but keeps the penalty and short-game rows.
 */
data class EntryPlan(
    val par3: Boolean,
    val putts: Boolean,
    /** Shown only once there are putts (the draft decides). */
    val firstPutt: Boolean,
    /** Direction, club and distance of the tee shot. */
    val drive: Boolean,
    val teePenalties: Boolean,
    val otherPenalties: Boolean,
    val sand: Boolean,
    /** Shown only on a missed green in regulation (the draft decides). */
    val recovery: Boolean,
    val approach: Boolean,
    /** Where the approach finished; shown only once an approach distance is set. */
    val approachFinish: Boolean,
    /** Tee shot tracking is on but the hole is a par 3. */
    val par3Note: Boolean,
) {
    val hasTeePage: Boolean get() = drive || teePenalties
    val hasApproachPage: Boolean get() = approach
    val hasShortPage: Boolean get() = firstPutt || sand || recovery || otherPenalties
}

/** The values being entered; seeded from the phone's saved ones. */
data class EntryDraft(val strokes: Int?, val shot: ShotDetail)

enum class Extra { Sand, Other, Tee }

object Entry {
    const val STROKES_MAX = 15
    const val PUTTS_MAX = 10
    const val EXTRAS_MAX = 9

    /** First tap on putts lands here. */
    const val PUTTS_FIRST = 2

    fun plan(hole: HoleInfo, track: Track) = EntryPlan(
        par3 = hole.isPar3,
        putts = track.putting,
        firstPutt = track.putting,
        drive = track.teeShot && !hole.isPar3,
        teePenalties = track.penalties,
        otherPenalties = track.penalties,
        sand = track.shortGame,
        recovery = track.shortGame,
        approach = track.approach,
        approachFinish = track.approach && !hole.isPar3,
        par3Note = track.teeShot && hole.isPar3,
    )

    /** Stableford: 2 + par + extraShots - strokes, never below 0. */
    fun points(par: Int, extraShots: Int, strokes: Int): Int = max(0, 2 + par + extraShots - strokes)

    fun points(hole: HoleInfo, strokes: Int): Int = points(hole.par, hole.extraShots, strokes)

    /** This hole's points (null while unscored) and the round total with it counted. */
    fun pointsAndTotal(hole: HoleInfo, me: Me, strokes: Int?): Pair<Int?, Int> {
        val pts = strokes?.let { points(hole, it) }
        return pts to me.totalPoints - (me.points ?: 0) + (pts ?: 0)
    }

    fun puttsMax(strokes: Int): Int = min(strokes, PUTTS_MAX)

    fun initialDraft(me: Me): EntryDraft {
        val strokes = me.strokes?.coerceIn(1, STROKES_MAX)
        val s = me.shot
        return EntryDraft(
            strokes = strokes,
            shot = s.copy(
                putts = if (strokes == null) null else s.putts?.coerceIn(0, puttsMax(strokes)),
                sandShots = s.sandShots.coerceIn(0, EXTRAS_MAX),
                otherPenalties = s.otherPenalties.coerceIn(0, EXTRAS_MAX),
                teePenalties = s.teePenalties.coerceIn(0, EXTRAS_MAX),
            ),
        )
    }

    // --- strokes and the counters that share them ---

    private fun ShotDetail.extra(which: Extra) = when (which) {
        Extra.Sand -> sandShots
        Extra.Other -> otherPenalties
        Extra.Tee -> teePenalties
    }

    private fun ShotDetail.withExtra(which: Extra, v: Int) = when (which) {
        Extra.Sand -> copy(sandShots = v)
        Extra.Other -> copy(otherPenalties = v)
        Extra.Tee -> copy(teePenalties = v)
    }

    /** putts + sand + other penalties + tee penalties, as the phone's shotDetailStrokeCount. */
    fun used(shot: ShotDetail): Int = (shot.putts ?: 0) + shot.sandShots + shot.otherPenalties + shot.teePenalties

    /** Unset: the first step up lands on the hole's PAR (the phone's "first tap lands on par"); down stays unset. */
    fun stepStrokes(hole: HoleInfo, draft: EntryDraft, delta: Int): EntryDraft {
        val cur = draft.strokes
        val next = when {
            cur == null -> if (delta > 0) hole.par.coerceIn(1, STROKES_MAX) else return draft
            else -> (cur + delta).coerceIn(1, STROKES_MAX)
        }
        return reconcile(draft.copy(strokes = next))
    }

    /** Needs strokes. Unset: the first step up lands on 2 (or the strokes if fewer). */
    fun stepPutts(draft: EntryDraft, delta: Int): EntryDraft {
        val strokes = draft.strokes ?: return draft
        val max = puttsMax(strokes)
        val cur = draft.shot.putts
        val next = when {
            cur == null -> if (delta > 0) min(PUTTS_FIRST, max) else return draft
            else -> (cur + delta).coerceIn(0, max)
        }
        val shot = draft.shot.copy(putts = next, firstPuttBucket = if (next == 0) null else draft.shot.firstPuttBucket)
        return fitExtras(draft.copy(shot = shot))
    }

    /** The ceiling of one counter: what the strokes leave after the others. */
    fun extraMax(draft: EntryDraft, which: Extra): Int =
        ((draft.strokes ?: 0) - (used(draft.shot) - draft.shot.extra(which))).coerceIn(0, EXTRAS_MAX)

    fun stepExtra(draft: EntryDraft, which: Extra, delta: Int): EntryDraft {
        if (draft.strokes == null) return draft
        val cur = draft.shot.extra(which)
        val next = if (delta > 0) min(cur + delta, max(extraMax(draft, which), cur)) else max(0, cur + delta)
        return draft.copy(shot = draft.shot.withExtra(which, next))
    }

    /** A counter's "+" is disabled by the strokes cap (not by [EXTRAS_MAX]) for any of [which]. */
    fun extrasCapped(draft: EntryDraft, which: Set<Extra>): Boolean {
        if (draft.strokes == null) return false
        return which.any { w -> extraMax(draft, w).let { it < EXTRAS_MAX && draft.shot.extra(w) >= it } }
    }

    /**
     * The phone's reconcileShotDetail (src/store/scoring.js): the counters never exceed the
     * strokes; when they do it trims putts, then sand, then other penalties, then tee penalties,
     * and clears the first-putt distance if putts drop to 0.
     */
    fun reconcile(draft: EntryDraft): EntryDraft {
        val strokes = draft.strokes ?: return draft
        var over = used(draft.shot) - strokes
        if (over <= 0) return draft
        fun trim(v: Int): Int = (v - minOf(v, over)).also { over -= v - it }
        val putts = trim(draft.shot.putts ?: 0)
        val sand = trim(draft.shot.sandShots)
        val other = trim(draft.shot.otherPenalties)
        val tee = trim(draft.shot.teePenalties)
        val s = draft.shot
        return draft.copy(
            shot = s.copy(
                putts = if (s.putts == null) null else putts,
                sandShots = sand,
                otherPenalties = other,
                teePenalties = tee,
                firstPuttBucket = if (s.putts != null && putts == 0) null else s.firstPuttBucket,
            ),
        )
    }

    /**
     * After the putts are chosen: seeded sand/penalties that no longer fit give way
     * (sand, other, tee), so the putts just entered are not what the phone trims.
     */
    private fun fitExtras(draft: EntryDraft): EntryDraft {
        var d = draft
        for (w in listOf(Extra.Sand, Extra.Other, Extra.Tee)) {
            val fit = min(d.shot.extra(w), extraMax(d, w))
            d = d.copy(shot = d.shot.withExtra(w, fit))
        }
        return d
    }

    // --- option pickers (all need strokes: the phone refuses a shot without them) ---

    /** Next/previous of [options] with "unset" as one more stop, wrapping around. */
    fun cycle(options: List<String>, current: String?, delta: Int): String? {
        val all = listOf<String?>(null) + options
        val i = all.indexOf(current).coerceAtLeast(0)
        return all[Math.floorMod(i + delta, all.size)]
    }

    /** Tapping the selected direction clears it. */
    fun toggleDrive(draft: EntryDraft, key: String): EntryDraft =
        if (draft.strokes == null) draft else draft.copy(shot = draft.shot.copy(drive = if (draft.shot.drive == key) null else key))

    /** Driver is the default and stays unstored (null), like the phone. */
    fun cycleClub(draft: EntryDraft, delta: Int): EntryDraft {
        if (draft.strokes == null) return draft
        val cur = draft.shot.teeClub ?: "driver"
        val i = Options.CLUBS.indexOf(cur).coerceAtLeast(0)
        val next = Options.CLUBS[Math.floorMod(i + delta, Options.CLUBS.size)]
        return draft.copy(shot = draft.shot.copy(teeClub = if (next == "driver") null else next))
    }

    fun cycleDriveDist(draft: EntryDraft, delta: Int): EntryDraft =
        if (draft.strokes == null) draft
        else draft.copy(shot = draft.shot.copy(driveDistBucket = cycle(Options.DRIVE_DIST, draft.shot.driveDistBucket, delta)))

    /** Only meaningful once there are putts; the page hides it before. */
    fun cycleFirstPutt(draft: EntryDraft, delta: Int): EntryDraft =
        if (draft.strokes == null || (draft.shot.putts ?: 0) < 1) draft
        else draft.copy(shot = draft.shot.copy(firstPuttBucket = cycle(Options.FIRST_PUTT, draft.shot.firstPuttBucket, delta)))

    /** No distance clears where the approach finished, like the phone. */
    fun cycleApproach(draft: EntryDraft, delta: Int): EntryDraft {
        if (draft.strokes == null) return draft
        val b = cycle(Options.APPROACH, draft.shot.approachBucket, delta)
        val s = draft.shot.copy(approachBucket = b)
        return draft.copy(
            shot = if (b == null) s.copy(approachResult = null, approachMiss = null, approachBunker = false) else s,
        )
    }

    /**
     * The phone's ApproachFinishRow: `green` is exclusive (clears direction + bunker), the four
     * directions are single-select among themselves and clear an on-green pick, `bunker`
     * toggles on top of a direction or stands alone. `approachResult` follows: 'green', 'miss'
     * (a direction or a bunker) or null.
     */
    fun toggleFinish(draft: EntryDraft, key: String): EntryDraft {
        if (draft.strokes == null) return draft
        val s = draft.shot
        val onGreen = s.approachResult == "green"
        val dir = s.approachMiss
        val bunker = s.approachBunker
        fun miss(d: String?, b: Boolean) = if (d != null || b) "miss" else null
        val next = when (key) {
            "green" ->
                if (onGreen) s.copy(approachResult = null, approachMiss = null, approachBunker = false)
                else s.copy(approachResult = "green", approachMiss = null, approachBunker = false)
            "bunker" -> {
                val nb = !bunker
                s.copy(approachBunker = nb, approachResult = miss(dir, nb))
            }
            else -> {
                val nd = if (dir == key && !onGreen) null else key
                s.copy(approachMiss = nd, approachResult = miss(nd, bunker))
            }
        }
        return draft.copy(shot = next)
    }

    /** Which finish key is lit: `green`, a direction, or `bunker`. */
    fun finishActive(shot: ShotDetail, key: String): Boolean = when (key) {
        "green" -> shot.approachResult == "green"
        "bunker" -> shot.approachBunker
        else -> shot.approachMiss == key && shot.approachResult != "green"
    }

    // --- short game ---

    /** GIR is missed when strokes - putts > par - 2; unknown while strokes or putts are unset. */
    fun missedGir(hole: HoleInfo, draft: EntryDraft): Boolean {
        val strokes = draft.strokes ?: return false
        val putts = draft.shot.putts ?: return false
        return strokes - putts > hole.par - 2
    }

    /** The phone's recoveryOutcomeFromState: what the chips show before anything is tapped. */
    fun autoRecovery(hole: HoleInfo, draft: EntryDraft): String? {
        val strokes = draft.strokes ?: return null
        val putts = draft.shot.putts ?: return null
        if (!missedGir(hole, draft)) return null
        if (strokes > hole.par) return null
        if (putts != 1 && putts != 0) return null
        return if (draft.shot.sandShots >= 1) "sand-save" else "up-and-down"
    }

    fun effectiveRecovery(hole: HoleInfo, draft: EntryDraft): String? =
        draft.shot.recoveryOutcome ?: autoRecovery(hole, draft)

    /** Tapping the lit chip stores 'none'; otherwise stores [which]. */
    fun toggleRecovery(hole: HoleInfo, draft: EntryDraft, which: String): EntryDraft {
        if (draft.strokes == null) return draft
        val next = if (effectiveRecovery(hole, draft) == which) "none" else which
        return draft.copy(shot = draft.shot.copy(recoveryOutcome = next))
    }

    // --- sending ---

    /**
     * Only the stats the plan collects (absolute values); null when none are. Putts are left out
     * while unset. `driveLie` is never sent: the phone derives it when it applies `drive`.
     */
    fun shotPatch(plan: EntryPlan, draft: EntryDraft): Map<String, Any?>? {
        val strokes = draft.strokes ?: return null
        val s = draft.shot
        val patch = LinkedHashMap<String, Any?>()
        if (plan.putts) s.putts?.let { patch[ShotKeys.PUTTS] = it.coerceIn(0, puttsMax(strokes)) }
        if (plan.firstPutt) patch[ShotKeys.FIRST_PUTT_BUCKET] = if ((s.putts ?: 0) >= 1) s.firstPuttBucket else null
        if (plan.drive) {
            patch[ShotKeys.DRIVE] = s.drive
            patch[ShotKeys.TEE_CLUB] = s.teeClub
            patch[ShotKeys.DRIVE_DIST_BUCKET] = s.driveDistBucket
        }
        if (plan.teePenalties) patch[ShotKeys.TEE_PENALTIES] = s.teePenalties
        if (plan.otherPenalties) patch[ShotKeys.OTHER_PENALTIES] = s.otherPenalties
        if (plan.sand) patch[ShotKeys.SAND_SHOTS] = s.sandShots
        if (plan.recovery) patch[ShotKeys.RECOVERY_OUTCOME] = s.recoveryOutcome
        if (plan.approach) {
            patch[ShotKeys.APPROACH_BUCKET] = s.approachBucket
            if (plan.approachFinish) {
                patch[ShotKeys.APPROACH_RESULT] = s.approachResult
                patch[ShotKeys.APPROACH_MISS] = s.approachMiss
                patch[ShotKeys.APPROACH_BUNKER] = s.approachBunker
            }
        }
        return patch.ifEmpty { null }
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
enum class PageKind { Distances, Score, Tee, Approach, ShortGame }

object Pages {
    /**
     * Distances always. Score and the stats pages only where the watch may enter (not
     * viewOnly/official/unknown blocks); a stats page only if its track group has any row.
     * A dispute keeps the pages (they say "Resolve on phone") with inputs off.
     */
    fun of(state: WatchState): List<PageKind> {
        val hole = state.hole
        val enter = state.active && state.me != null &&
            (state.blocked == null || state.blocked == Blocked.Dispute)
        if (hole == null || !enter) return listOf(PageKind.Distances)
        val plan = Entry.plan(hole, state.track)
        return buildList {
            add(PageKind.Distances)
            add(PageKind.Score)
            if (plan.hasTeePage) add(PageKind.Tee)
            if (plan.hasApproachPage) add(PageKind.Approach)
            if (plan.hasShortPage) add(PageKind.ShortGame)
        }
    }
}

/** Turns a stream of scroll deltas (crown) into whole steps; the remainder carries over. */
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

/**
 * One drag = at most one step. Fires the moment the drag has travelled [thresholdPx] (so it
 * feels immediate) or, if it never got that far, on release past [releasePx] (a short flick);
 * after firing, the rest of the same drag is ignored. A cancelled drag fires nothing.
 */
class OneStepGesture(private val thresholdPx: Float, private val releasePx: Float = thresholdPx / 2) {
    private var total = 0f
    private var fired = false

    fun start() {
        total = 0f
        fired = false
    }

    /** Feeds a drag delta; returns the step's sign (+1 / -1) on the crossing, else 0. */
    fun drag(delta: Float): Int {
        if (fired) return 0
        total += delta
        if (abs(total) < thresholdPx) return 0
        fired = true
        return if (total > 0) 1 else -1
    }

    /** The finger lifted. */
    fun end(): Int {
        val step = if (!fired && abs(total) >= releasePx) (if (total > 0) 1 else -1) else 0
        start()
        return step
    }

    fun cancel() = start()
}
