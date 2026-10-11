package com.golfpartner.wear.data

import com.golfpartner.wear.ui.Copy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EntryTest {
    private val par4 = HoleInfo(7, 18, 4, 3, 1, null, null)
    private val par3 = par4.copy(par = 3)
    private val all = Track(putting = true, teeShot = true, shortGame = true, penalties = true)

    @Test
    fun stablefordPointsAndNetPar() {
        // par 4 + 1 extra shot: net par 5 earns 2.
        assertEquals(2, Entry.points(par4, 5))
        assertEquals(3, Entry.points(par4, 4))
        assertEquals(1, Entry.points(par4, 6))
        assertEquals(0, Entry.points(par4, 7))
        assertEquals(0, Entry.points(par4, 12)) // never negative
        assertTrue(Entry.isNetPar(par4, 5))
        assertFalse(Entry.isNetPar(par4, 4))
        assertEquals(5, par4.netPar)
    }

    @Test
    fun strokesStartAtNetParOrSavedValue() {
        val me = Fixtures.state().me!!
        assertEquals(5, Entry.initialStrokes(par4, me))
        assertEquals(3, Entry.initialStrokes(par4, me.copy(strokes = 3)))
        assertEquals(15, Entry.initialStrokes(par4.copy(extraShots = 20), me)) // clamped
    }

    @Test
    fun puttsRangeAndStart() {
        val me = Fixtures.state().me!!
        assertEquals(2, Entry.initialPutts(me, 5))
        assertEquals(1, Entry.initialPutts(me, 1)) // never more than strokes
        assertEquals(3, Entry.initialPutts(me.copy(putts = 3), 5))
        assertEquals(10, Entry.puttsMax(15))
        assertEquals(4, Entry.puttsMax(4))
    }

    @Test
    fun allGroupsOnGivesFullFlowWithMore() {
        val p = Entry.plan(par4, all)
        assertEquals(listOf(Step.Strokes, Step.Putts, Step.Tee), p.steps)
        assertTrue(p.teeHasMore)
        assertEquals(Step.Putts, p.after(Step.Strokes))
        assertNull(p.after(Step.Tee)) // last step -> Save
    }

    @Test
    fun groupsOffSkipTheirSteps() {
        assertEquals(listOf(Step.Strokes), Entry.plan(par4, Track.None).steps)
        assertEquals(listOf(Step.Strokes, Step.Putts), Entry.plan(par4, Track.None.copy(putting = true)).steps)
        assertEquals(listOf(Step.Strokes, Step.Tee), Entry.plan(par4, Track.None.copy(teeShot = true)).steps)
        // sand/penalty alone: the extras are their own step, no Tee, no More
        val p = Entry.plan(par4, Track.None.copy(shortGame = true))
        assertEquals(listOf(Step.Strokes, Step.Extras), p.steps)
        assertFalse(p.teeHasMore)
    }

    @Test
    fun par3SkipsTheTeeStepButKeepsExtras() {
        val p = Entry.plan(par3, all)
        assertEquals(listOf(Step.Strokes, Step.Putts, Step.Extras), p.steps)
        assertFalse(p.hasLie)
        assertEquals(listOf(Step.Strokes, Step.Putts), Entry.plan(par3, Track.None.copy(putting = true, teeShot = true)).steps)
    }

    @Test
    fun shotPatchHoldsOnlyTrackedFields() {
        val draft = EntryDraft(strokes = 5, putts = 2, lie = "fairway", sand = 1, penalty = 0)
        assertEquals(
            mapOf("putts" to 2, "driveLie" to "fairway", "sandShots" to 1, "otherPenalties" to 0),
            Entry.shotPatch(Entry.plan(par4, all), draft),
        )
        assertEquals(mapOf("putts" to 2), Entry.shotPatch(Entry.plan(par4, Track.None.copy(putting = true)), draft))
        assertNull(Entry.shotPatch(Entry.plan(par4, Track.None), draft))
        // par 3: no driveLie
        assertEquals(setOf("putts", "sandShots", "otherPenalties"), Entry.shotPatch(Entry.plan(par3, all), draft)!!.keys)
        // a cleared lie is sent as null
        assertTrue(Entry.shotPatch(Entry.plan(par4, all), draft.copy(lie = null))!!.containsKey("driveLie"))
        // putts never above strokes
        assertEquals(1, Entry.shotPatch(Entry.plan(par4, all), draft.copy(strokes = 1, putts = 4))!!["putts"])
    }

    @Test
    fun saveSendsStrokesThenOneShot() {
        val state = Fixtures.state()
        val cmds = Entry.saveCommands(state, Entry.plan(par4, all), EntryDraft(5, 2, "rough", 0, 0))
        assertEquals(listOf(CommandType.Strokes, CommandType.Shot), cmds.map { it.type })
        assertTrue(cmds.all { it.roundId == "r1" && it.baseRev == 10L && it.hole == 7 })
        assertEquals(1, Entry.saveCommands(state, Entry.plan(par4, Track.None), EntryDraft(5, 2, null, 0, 0)).size)
    }

    @Test
    fun savedSummaryAdjustsTheTotal() {
        // hole 7 was unscored: total 14 + 2 pts.
        val state = Fixtures.state()
        val plan = Entry.plan(par4, all)
        val s = SavedSummary.of(state, plan, EntryDraft(5, 2, "fairway", 0, 0))!!
        assertEquals(2, s.points)
        assertEquals(16, s.totalPoints)
        assertEquals(2, s.putts)
        assertTrue(s.hasNext)
        // re-scoring a hole that had 2 pts as a 4 (3 pts): 14 - 2 + 3
        val rescored = Fixtures.state(Fixtures.activeJson(strokes = "5", points = "2"))
        assertEquals(15, SavedSummary.of(rescored, plan, EntryDraft(4, 2, null, 0, 0))!!.totalPoints)
        // last hole: no next
        val last = Fixtures.state(Fixtures.activeJson(number = 18))
        assertFalse(SavedSummary.of(last, plan, EntryDraft(5, 2, null, 0, 0))!!.hasNext)
    }

    @Test
    fun copyMatchesThePlan() {
        assertEquals("HOLE 7 · PAR 4", Copy.holeHeader(7, 4))
        assertEquals("SI 3 · +1 shot", Copy.strokeIndex(3, 1))
        assertEquals("SI 3 · +2 shots", Copy.strokeIndex(3, 2))
        assertEquals("SI 3", Copy.strokeIndex(3, 0))
        assertEquals("5 · 2 pts", Copy.ghostPill(5, 2))
        assertEquals("1 pt", Copy.points(1))
        assertEquals("2 holes waiting", Copy.waiting(2))
        assertEquals("1 hole waiting", Copy.waiting(1))
        assertEquals("Hole 7 saved", Copy.saved(7))
        assertEquals("2 pts · 14 total", Copy.scoreAndTotal(2, 14))
        assertEquals("2 putts", Copy.putts(2))
        assertEquals("Hole 8 ›", Copy.nextHole(8))
    }

    // --- the entry belongs to the hole it was opened on (review finding 1) ---

    @Test
    fun anEntryOpenedOnHole7IsVoidOnceThePhoneShowsHole8() {
        val opened = Fixtures.state(Fixtures.activeJson(rev = 10, number = 7))
        assertTrue(Entry.stillOn(opened, Fixtures.state(Fixtures.activeJson(rev = 11, number = 7))))
        assertFalse(Entry.stillOn(opened, Fixtures.state(Fixtures.activeJson(rev = 11, number = 8))))
        assertFalse(Entry.stillOn(opened, Fixtures.state(Fixtures.activeJson(rev = 11, number = 7, roundId = "r2"))))
        assertFalse(Entry.stillOn(opened, WatchState.Inactive))
        assertFalse(Entry.stillOn(opened, null))
    }

    @Test
    fun saveCommandsTargetTheOpenedHoleNotTheCurrentOne() {
        val opened = Fixtures.state(Fixtures.activeJson(rev = 10, number = 7))
        val plan = Entry.plan(opened.hole!!, Track.None)
        val cmds = Entry.saveCommands(opened, plan, Entry.initialDraft(opened.hole!!, opened.me!!).copy(strokes = 4))
        assertEquals(listOf(7), cmds.map { it.hole })
    }

    // --- shot detail stays within strokes, the phone's way (review finding 7) ---

    private val me0 = Fixtures.state().me!! // putts null, sand 0, penalties 0
    private val allPlan = Entry.plan(par4, all)

    @Test
    fun reconcileTrimsPuttsThenSandThenPenaltyLikeThePhone() {
        val d = EntryDraft(strokes = 4, putts = 3, lie = null, sand = 2, penalty = 1) // 6 > 4
        assertEquals(d.copy(putts = 1), Entry.reconcile(allPlan, d, me0))
        val worse = EntryDraft(strokes = 2, putts = 3, lie = null, sand = 2, penalty = 1) // 6 > 2
        assertEquals(worse.copy(putts = 0, sand = 1), Entry.reconcile(allPlan, worse, me0))
        val fits = d.copy(putts = 1)
        assertEquals(fits, Entry.reconcile(allPlan, fits, me0))
    }

    @Test
    fun reconcileCountsThePhonesValuesForFieldsThePlanDoesNotCollect() {
        val puttsOnly = Entry.plan(par4, Track.None.copy(putting = true))
        val me = me0.copy(sandShots = 2) // recorded on the phone, not editable here
        val d = EntryDraft(strokes = 4, putts = 3, lie = null, sand = 0, penalty = 0)
        assertEquals(2, Entry.reconcile(puttsOnly, d, me).putts)
    }

    @Test
    fun extrasSteppersAreCappedByWhatTheStrokesLeave() {
        val d = EntryDraft(strokes = 5, putts = 2, lie = null, sand = 1, penalty = 1)
        assertEquals(2, Entry.sandMax(allPlan, d, me0)) // 5 - 2 putts - 1 penalty
        assertEquals(2, Entry.penaltyMax(allPlan, d, me0)) // 5 - 2 putts - 1 sand
        val full = d.copy(putts = 5, sand = 0, penalty = 0)
        assertEquals(0, Entry.sandMax(allPlan, full, me0))
        assertEquals(0, Entry.penaltyMax(allPlan, full, me0))
        val long = EntryDraft(strokes = 15, putts = 0, lie = null, sand = 0, penalty = 0)
        assertEquals(Entry.EXTRAS_MAX, Entry.sandMax(allPlan, long, me0))
    }

    @Test
    fun puttsJustEnteredWinOverSeededExtras() {
        val d = EntryDraft(strokes = 4, putts = 3, lie = null, sand = 1, penalty = 1)
        val fitted = Entry.fitExtras(allPlan, d, me0)
        assertEquals(EntryDraft(strokes = 4, putts = 3, lie = null, sand = 0, penalty = 1), fitted)
        assertEquals(fitted, Entry.reconcile(allPlan, fitted, me0)) // nothing left for the phone to trim
    }
}
