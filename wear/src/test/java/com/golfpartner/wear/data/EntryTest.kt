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
    private val me0 = Fixtures.state().me!! // unscored, putts null, sand 0, penalties 0
    private val allPlan = Entry.plan(par4, all)
    private val empty = EntryDraft(null, null, null, 0, 0)

    @Test
    fun stablefordPoints() {
        // par 4 + 1 extra shot: net par 5 earns 2.
        assertEquals(2, Entry.points(par4, 5))
        assertEquals(3, Entry.points(par4, 4))
        assertEquals(0, Entry.points(par4, 12)) // never negative
        assertEquals(5, par4.netPar)
    }

    @Test
    fun theFirstStrokesStepLandsOnParNotNetPar() {
        val d = Entry.stepStrokes(par4, allPlan, empty, me0, +1)
        assertEquals(4, d.strokes)
        assertEquals(5, Entry.stepStrokes(par4, allPlan, d, me0, +1).strokes)
        assertEquals(3, Entry.stepStrokes(par4, allPlan, d, me0, -1).strokes)
        // down from unset stays unset
        assertNull(Entry.stepStrokes(par4, allPlan, empty, me0, -1).strokes)
    }

    @Test
    fun strokesStayWithinBounds() {
        assertEquals(1, Entry.stepStrokes(par4, allPlan, empty.copy(strokes = 1), me0, -1).strokes)
        assertEquals(15, Entry.stepStrokes(par4, allPlan, empty.copy(strokes = 15), me0, +1).strokes)
    }

    @Test
    fun loweringStrokesTrimsDetailLikeThePhone() {
        val d = EntryDraft(strokes = 5, putts = 3, lie = null, sand = 1, penalty = 1)
        // 4 strokes: 3 + 1 + 1 = 5 > 4 -> putts first
        assertEquals(d.copy(strokes = 4, putts = 2), Entry.stepStrokes(par4, allPlan, d, me0, -1))
    }

    @Test
    fun puttsNeedStrokesAndStartAtTwo() {
        assertEquals(empty, Entry.stepPutts(allPlan, empty, me0, +1)) // no strokes yet
        val d = Entry.stepPutts(allPlan, empty.copy(strokes = 4), me0, +1)
        assertEquals(2, d.putts)
        assertNull(Entry.stepPutts(allPlan, empty.copy(strokes = 4), me0, -1).putts)
        assertEquals(1, Entry.stepPutts(allPlan, empty.copy(strokes = 1), me0, +1).putts) // never above strokes
        assertEquals(0, Entry.stepPutts(allPlan, empty.copy(strokes = 4, putts = 0), me0, -1).putts)
        assertEquals(4, Entry.stepPutts(allPlan, empty.copy(strokes = 4, putts = 4), me0, +1).putts)
        assertEquals(10, Entry.stepPutts(allPlan, empty.copy(strokes = 15, putts = 10), me0, +1).putts)
    }

    @Test
    fun puttsJustEnteredWinOverSeededExtras() {
        val d = EntryDraft(strokes = 4, putts = 2, lie = null, sand = 1, penalty = 1)
        val next = Entry.stepPutts(allPlan, d, me0, +1)
        assertEquals(EntryDraft(strokes = 4, putts = 3, lie = null, sand = 0, penalty = 1), next)
        assertEquals(next, Entry.reconcile(allPlan, next, me0)) // nothing left for the phone to trim
    }

    @Test
    fun sandAndPenaltyAreCappedByWhatTheStrokesLeave() {
        val d = EntryDraft(strokes = 3, putts = 2, lie = null, sand = 0, penalty = 0)
        val one = Entry.stepSand(allPlan, d, me0, +1)
        assertEquals(1, one.sand)
        assertEquals(1, Entry.stepSand(allPlan, one, me0, +1).sand) // 3 - 2 putts = 1
        assertEquals(0, Entry.penaltyMax(allPlan, one, me0)) // sand took the last one
        assertEquals(0, Entry.stepPenalty(allPlan, one, me0, +1).penalty)
        assertEquals(0, Entry.stepSand(allPlan, one, me0, -1).sand)
        assertEquals(empty, Entry.stepSand(allPlan, empty, me0, +1)) // needs strokes
    }

    @Test
    fun capHintOnlyWhenThePlusIsBlockedByTheStrokes() {
        val d = EntryDraft(strokes = 3, putts = 2, lie = null, sand = 1, penalty = 0)
        assertTrue(Entry.extrasCapped(allPlan, d, me0))
        assertFalse(Entry.extrasCapped(allPlan, EntryDraft(15, 0, null, 0, 0), me0)) // plenty of room
        assertFalse(Entry.extrasCapped(allPlan, empty, me0)) // unset strokes get their own hint
        assertEquals("Max for 3 strokes", Copy.maxFor(3))
    }

    @Test
    fun lieTogglesAndNeedsStrokes() {
        val d = empty.copy(strokes = 4)
        val fw = Entry.toggleLie(d, "fairway")
        assertEquals("fairway", fw.lie)
        assertEquals("rough", Entry.toggleLie(fw, "rough").lie)
        assertNull(Entry.toggleLie(fw, "fairway").lie)
        assertNull(Entry.toggleLie(empty, "fairway").lie)
    }

    @Test
    fun planFollowsTrackAndPar() {
        val p = Entry.plan(par4, all)
        assertTrue(p.hasLie && p.hasSand && p.hasPenalty && p.hasPutts && p.hasStatsPage)
        val p3 = Entry.plan(par3, all)
        assertFalse(p3.hasLie)
        assertTrue(p3.par3Note)
        // par 3 with only the tee shot on: nothing to edit, the page is dropped
        assertFalse(Entry.plan(par3, Track.None.copy(teeShot = true)).hasStatsPage)
        assertFalse(Entry.plan(par4, Track.None.copy(putting = true)).hasStatsPage)
        assertTrue(Entry.plan(par4, Track.None.copy(shortGame = true)).hasStatsPage)
    }

    @Test
    fun pagesFollowBlockAndPlan() {
        assertEquals(listOf(PageKind.Distances, PageKind.Score, PageKind.Stats), Pages.of(Fixtures.state()))
        assertEquals(
            listOf(PageKind.Distances, PageKind.Score),
            Pages.of(Fixtures.state(Fixtures.activeJson(track = """{"putting":true,"teeShot":false,"shortGame":false,"penalties":false}"""))),
        )
        // dispute keeps the pages (they say "Resolve on phone")
        assertEquals(3, Pages.of(Fixtures.state(Fixtures.activeJson(blocked = "dispute"))).size)
        assertEquals(listOf(PageKind.Distances), Pages.of(Fixtures.state(Fixtures.activeJson(blocked = "viewOnly"))))
        assertEquals(listOf(PageKind.Distances), Pages.of(Fixtures.state(Fixtures.activeJson(blocked = "official"))))
        assertEquals(listOf(PageKind.Distances), Pages.of(WatchState.Inactive))
    }

    @Test
    fun initialDraftSeedsFromThePhoneWithoutInventingValues() {
        val d = Entry.initialDraft(par4, me0)
        assertEquals(empty, d)
        val scored = me0.copy(strokes = 5, putts = 2, driveLie = "rough", sandShots = 1)
        assertEquals(EntryDraft(5, 2, "rough", 1, 0), Entry.initialDraft(par4, scored))
    }

    @Test
    fun shotPatchHoldsOnlyTrackedFieldsAndSetPutts() {
        val draft = EntryDraft(strokes = 5, putts = 2, lie = "fairway", sand = 1, penalty = 0)
        assertEquals(
            mapOf("putts" to 2, "driveLie" to "fairway", "sandShots" to 1, "otherPenalties" to 0),
            Entry.shotPatch(allPlan, draft),
        )
        assertEquals(mapOf("putts" to 2), Entry.shotPatch(Entry.plan(par4, Track.None.copy(putting = true)), draft))
        assertNull(Entry.shotPatch(Entry.plan(par4, Track.None), draft))
        assertEquals(setOf("putts", "sandShots", "otherPenalties"), Entry.shotPatch(Entry.plan(par3, all), draft)!!.keys)
        assertTrue(Entry.shotPatch(allPlan, draft.copy(lie = null))!!.containsKey("driveLie")) // cleared lie goes as null
        assertFalse(Entry.shotPatch(allPlan, draft.copy(putts = null))!!.containsKey("putts")) // unset putts are not sent
        assertNull(Entry.shotPatch(allPlan, draft.copy(strokes = null))) // the phone refuses a shot without strokes
    }

    @Test
    fun saveSendsStrokesThenOneShotAndNothingWithoutStrokes() {
        val state = Fixtures.state()
        val cmds = Entry.saveCommands(state, allPlan, EntryDraft(5, 2, "rough", 0, 0))
        assertEquals(listOf(CommandType.Strokes, CommandType.Shot), cmds.map { it.type })
        assertTrue(cmds.all { it.roundId == "r1" && it.baseRev == 10L && it.hole == 7 })
        assertEquals(1, Entry.saveCommands(state, Entry.plan(par4, Track.None), EntryDraft(5, 2, null, 0, 0)).size)
        assertTrue(Entry.saveCommands(state, allPlan, empty).isEmpty())
    }

    @Test
    fun pointsAndTotalAdjustTheRoundTotal() {
        val s = Fixtures.state() // hole 7 unscored, total 14
        assertEquals(2 to 16, Entry.pointsAndTotal(par4, s.me!!, 5))
        assertEquals(null to 14, Entry.pointsAndTotal(par4, s.me!!, null))
        // re-scoring a hole that had 2 pts as a 4 (3 pts): 14 - 2 + 3
        val scored = Fixtures.state(Fixtures.activeJson(strokes = "5", points = "2")).me!!
        assertEquals(3 to 15, Entry.pointsAndTotal(par4, scored, 4))
    }

    @Test
    fun copyMatchesThePlan() {
        assertEquals("HOLE 7 · PAR 4", Copy.holeHeader(7, 4))
        assertEquals("SI 3 · +1 shot", Copy.strokeIndex(3, 1))
        assertEquals("SI 3 · +2 shots", Copy.strokeIndex(3, 2))
        assertEquals("SI 3", Copy.strokeIndex(3, 0))
        assertEquals("1 pt", Copy.points(1))
        assertEquals("2 holes waiting", Copy.waiting(2))
        assertEquals("1 hole waiting", Copy.waiting(1))
        assertEquals("3 pts · 14 total", Copy.footer(3, 14))
        assertEquals("14 total", Copy.footer(null, 14))
        assertEquals("Fwy", Copy.lieLabel("fairway"))
        assertEquals("Trbl", Copy.lieLabel("trouble"))
    }

    // --- edits belong to the hole they were made on ---

    @Test
    fun editsMadeOnHole7StopBelongingOnceThePhoneShowsHole8() {
        val opened = Fixtures.state(Fixtures.activeJson(rev = 10, number = 7))
        assertTrue(Entry.stillOn(opened, Fixtures.state(Fixtures.activeJson(rev = 11, number = 7))))
        assertFalse(Entry.stillOn(opened, Fixtures.state(Fixtures.activeJson(rev = 11, number = 8))))
        assertFalse(Entry.stillOn(opened, Fixtures.state(Fixtures.activeJson(rev = 11, number = 7, roundId = "r2"))))
        assertFalse(Entry.stillOn(opened, WatchState.Inactive))
        assertFalse(Entry.stillOn(opened, null))
        assertTrue(Entry.sameHole(opened, Fixtures.state(Fixtures.activeJson(rev = 12, number = 7))))
        assertFalse(Entry.sameHole(opened, Fixtures.state(Fixtures.activeJson(number = 8))))
    }

    @Test
    fun saveCommandsTargetTheOpenedHoleNotTheCurrentOne() {
        val opened = Fixtures.state(Fixtures.activeJson(rev = 10, number = 7))
        val plan = Entry.plan(opened.hole!!, Track.None)
        val cmds = Entry.saveCommands(opened, plan, Entry.initialDraft(opened.hole!!, opened.me!!).copy(strokes = 4))
        assertEquals(listOf(7), cmds.map { it.hole })
    }

    // --- phone-consistent trimming ---

    @Test
    fun reconcileTrimsPuttsThenSandThenPenaltyLikeThePhone() {
        val d = EntryDraft(strokes = 4, putts = 3, lie = null, sand = 2, penalty = 1) // 6 > 4
        assertEquals(d.copy(putts = 1), Entry.reconcile(allPlan, d, me0))
        val worse = EntryDraft(strokes = 2, putts = 3, lie = null, sand = 2, penalty = 1)
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

    // --- crown / swipe accumulation ---

    @Test
    fun accumulatorTurnsDeltasIntoWholeSteps() {
        val acc = StepAccumulator(50f)
        assertEquals(0, acc.feed(30f))
        assertEquals(1, acc.feed(30f)) // 60 -> one step, 10 carried
        assertEquals(0, acc.feed(30f))
        assertEquals(1, acc.feed(30f)) // 10 carried + 30 + 30 = 70
        assertEquals(-2, StepAccumulator(50f).feed(-120f))
    }

    @Test
    fun accumulatorDropsTheCarryWhenTheDirectionReverses() {
        val acc = StepAccumulator(50f)
        assertEquals(0, acc.feed(40f))
        assertEquals(0, acc.feed(-20f)) // reversed: the 40 is gone, -20 is not a step
        assertEquals(-1, acc.feed(-35f))
    }
}
