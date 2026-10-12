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
    private val all = Track(putting = true, teeShot = true, shortGame = true, penalties = true, approach = true)
    private val me0 = Fixtures.state().me!! // unscored, nothing recorded
    private val allPlan = Entry.plan(par4, all)
    private val empty = EntryDraft(null, ShotDetail())
    private fun d(strokes: Int?, shot: ShotDetail = ShotDetail()) = EntryDraft(strokes, shot)

    @Test
    fun stablefordPoints() {
        assertEquals(2, Entry.points(par4, 5))
        assertEquals(3, Entry.points(par4, 4))
        assertEquals(0, Entry.points(par4, 12))
        assertEquals(5, par4.netPar)
    }

    @Test
    fun theFirstStrokesStepLandsOnParNotNetPar() {
        val x = Entry.stepStrokes(par4, empty, +1)
        assertEquals(4, x.strokes)
        assertEquals(5, Entry.stepStrokes(par4, x, +1).strokes)
        assertEquals(3, Entry.stepStrokes(par4, x, -1).strokes)
        assertNull(Entry.stepStrokes(par4, empty, -1).strokes)
        assertEquals(1, Entry.stepStrokes(par4, d(1), -1).strokes)
        assertEquals(15, Entry.stepStrokes(par4, d(15), +1).strokes)
    }

    @Test
    fun loweringStrokesTrimsLikeThePhone() {
        // 5 strokes: putts 2, sand 1, other 1, tee 1; down to 4 -> putts first
        val x = d(5, ShotDetail(putts = 2, sandShots = 1, otherPenalties = 1, teePenalties = 1))
        assertEquals(1, Entry.stepStrokes(par4, x, -1).shot.putts)
        // down to 2 from a heavy hole: putts, sand, other, then tee
        val heavy = d(5, ShotDetail(putts = 2, sandShots = 1, otherPenalties = 1, teePenalties = 1))
        val r = Entry.reconcile(heavy.copy(strokes = 2))
        assertEquals(ShotDetail(putts = 0, sandShots = 0, otherPenalties = 1, teePenalties = 1), r.shot)
        val r1 = Entry.reconcile(heavy.copy(strokes = 1))
        assertEquals(ShotDetail(putts = 0, sandShots = 0, otherPenalties = 0, teePenalties = 1), r1.shot)
        val r0 = Entry.reconcile(heavy.copy(strokes = 1, shot = heavy.shot.copy(firstPuttBucket = "1-2")))
        assertNull(r0.shot.firstPuttBucket) // putts trimmed to 0 clears the first-putt distance
    }

    @Test
    fun teePenaltiesCountAgainstTheStrokeCap() {
        val x = d(4, ShotDetail(putts = 2, teePenalties = 1, sandShots = 0, otherPenalties = 0))
        assertEquals(1, Entry.extraMax(x, Extra.Sand)) // 4 - 2 putts - 1 tee
        assertEquals(1, Entry.extraMax(x, Extra.Other))
        assertEquals(2, Entry.extraMax(x, Extra.Tee)) // may grow into the free stroke
        val sand = Entry.stepExtra(x, Extra.Sand, +1)
        assertEquals(1, sand.shot.sandShots)
        assertEquals(0, Entry.extraMax(sand, Extra.Other)) // putts 2 + tee 1 + sand 1 = 4
        assertEquals(0, Entry.stepExtra(sand, Extra.Other, +1).shot.otherPenalties)
        assertEquals(1, Entry.stepExtra(sand, Extra.Tee, +1).shot.teePenalties) // already at 1, capped
        assertTrue(Entry.extrasCapped(sand, setOf(Extra.Other)))
        assertFalse(Entry.extrasCapped(d(15), setOf(Extra.Other, Extra.Tee)))
        assertFalse(Entry.extrasCapped(empty, setOf(Extra.Other)))
        assertEquals(empty, Entry.stepExtra(empty, Extra.Tee, +1)) // needs strokes
        assertEquals(0, Entry.stepExtra(sand, Extra.Sand, -1).shot.sandShots)
        assertEquals("Max for 3 strokes", Copy.maxFor(3))
    }

    @Test
    fun puttsNeedStrokesStartAtTwoAndDisplaceSeededExtrasInOrder() {
        assertEquals(empty, Entry.stepPutts(empty, +1))
        assertEquals(2, Entry.stepPutts(d(4), +1).shot.putts)
        assertNull(Entry.stepPutts(d(4), -1).shot.putts)
        assertEquals(1, Entry.stepPutts(d(1), +1).shot.putts)
        assertEquals(10, Entry.stepPutts(d(15, ShotDetail(putts = 10)), +1).shot.putts)
        val x = d(4, ShotDetail(putts = 2, sandShots = 1, otherPenalties = 1))
        val next = Entry.stepPutts(x, +1)
        assertEquals(ShotDetail(putts = 3, sandShots = 0, otherPenalties = 1), next.shot)
        assertEquals(next, Entry.reconcile(next))
        val zero = Entry.stepPutts(d(4, ShotDetail(putts = 1, firstPuttBucket = "1-2")), -1)
        assertNull(zero.shot.firstPuttBucket)
    }

    @Test
    fun directionTogglesAndNeedsStrokes() {
        val x = Entry.toggleDrive(d(4), "left")
        assertEquals("left", x.shot.drive)
        assertEquals("super", Entry.toggleDrive(x, "super").shot.drive)
        assertNull(Entry.toggleDrive(x, "left").shot.drive)
        assertNull(Entry.toggleDrive(empty, "left").shot.drive)
        assertEquals(listOf("left", "fairway", "right", "short", "super"), Options.DRIVES)
    }

    @Test
    fun clubChipsAndDriverIsNull() {
        val x = d(4)
        val wood = Entry.pickClub(x, "wood")
        assertEquals("wood", wood.shot.teeClub)
        assertEquals("iron", Entry.pickClub(wood, "iron").shot.teeClub)
        assertNull(Entry.pickClub(wood, "wood").shot.teeClub) // the lit non-driver goes back to driver
        assertNull(Entry.pickClub(x, "driver").shot.teeClub) // driver stays the unstored default
        assertNull(Entry.pickClub(empty, "wood").shot.teeClub)
    }

    @Test
    fun bucketChipsToggleOff() {
        val a = Entry.pickDriveDist(d(4), "0-150")
        assertEquals("0-150", a.shot.driveDistBucket)
        assertEquals("150-180", Entry.pickDriveDist(a, "150-180").shot.driveDistBucket)
        assertNull(Entry.pickDriveDist(a, "0-150").shot.driveDistBucket)
        assertEquals(empty, Entry.pickDriveDist(empty, "0-150"))
        // first putt needs putts
        assertEquals(d(4), Entry.pickFirstPutt(d(4), "0-1"))
        assertEquals("0-1", Entry.pickFirstPutt(d(4, ShotDetail(putts = 2)), "0-1").shot.firstPuttBucket)
        assertNull(Entry.pickFirstPutt(Entry.pickFirstPutt(d(4, ShotDetail(putts = 2)), "0-1"), "0-1").shot.firstPuttBucket)
    }

    @Test
    fun approachDistanceClearsTheFinishWhenCleared() {
        val set = Entry.pickApproach(d(4), "0-50")
        assertEquals("0-50", set.shot.approachBucket)
        val finished = Entry.toggleFinish(set, "left")
        assertEquals("left", finished.shot.approachMiss)
        val cleared = Entry.pickApproach(finished, "0-50") // tap the lit chip -> unset
        assertNull(cleared.shot.approachBucket)
        assertEquals(ShotDetail(), cleared.shot)
    }

    @Test
    fun approachFinishFollowsThePhonesRules() {
        val base = Entry.pickApproach(d(4), "0-50")
        val green = Entry.toggleFinish(base, "green")
        assertEquals(ShotDetail(approachBucket = "0-50", approachResult = "green"), green.shot)
        assertTrue(Entry.finishActive(green.shot, "green"))
        assertNull(Entry.toggleFinish(green, "green").shot.approachResult) // green again clears
        // a direction replaces green and derives 'miss'
        val long = Entry.toggleFinish(green, "long")
        assertEquals("long", long.shot.approachMiss)
        assertEquals("miss", long.shot.approachResult)
        assertTrue(Entry.finishActive(long.shot, "long"))
        assertFalse(Entry.finishActive(long.shot, "green"))
        // directions are single select; the same one clears
        val left = Entry.toggleFinish(long, "left")
        assertEquals("left", left.shot.approachMiss)
        val none = Entry.toggleFinish(left, "left")
        assertNull(none.shot.approachMiss)
        assertNull(none.shot.approachResult)
        // bunker alone is a miss; combines with a direction; toggles off
        val bunker = Entry.toggleFinish(base, "bunker")
        assertTrue(bunker.shot.approachBunker)
        assertEquals("miss", bunker.shot.approachResult)
        val both = Entry.toggleFinish(bunker, "short")
        assertTrue(both.shot.approachBunker && both.shot.approachMiss == "short")
        assertEquals("short", Entry.toggleFinish(both, "bunker").shot.approachMiss)
        assertNull(Entry.toggleFinish(bunker, "bunker").shot.approachResult)
        // bunker on top of green replaces it
        val gb = Entry.toggleFinish(green, "bunker")
        assertEquals("miss", gb.shot.approachResult)
        assertTrue(gb.shot.approachBunker)
    }

    @Test
    fun recoveryMirrorsThePhonesAutoOutcome() {
        // par 4, 5 strokes, 1 putt: GIR missed (4 > 2), 5 > par -> no auto outcome
        val x = d(5, ShotDetail(putts = 1))
        assertTrue(Entry.missedGir(par4, x))
        assertNull(Entry.autoRecovery(par4, x))
        // par save with one putt: up & down, or sand save with sand
        val par = d(4, ShotDetail(putts = 1))
        assertEquals("up-and-down", Entry.autoRecovery(par4, par))
        assertEquals("sand-save", Entry.autoRecovery(par4, par.copy(shot = par.shot.copy(sandShots = 1))))
        // GIR hit or unknown: no chips
        assertFalse(Entry.missedGir(par4, d(4, ShotDetail(putts = 2))))
        assertFalse(Entry.missedGir(par4, d(4)))
        // tapping the lit chip stores 'none'; another stores itself
        val none = Entry.toggleRecovery(par4, par, "up-and-down")
        assertEquals("none", none.shot.recoveryOutcome)
        assertEquals("sand-save", Entry.toggleRecovery(par4, par, "sand-save").shot.recoveryOutcome)
        assertEquals("up-and-down", Entry.toggleRecovery(par4, none, "up-and-down").shot.recoveryOutcome)
    }

    @Test
    fun planFollowsTrackAndParRules() {
        val p = allPlan
        assertTrue(p.drive && p.sand && p.otherPenalties && p.teePenalties && p.putts && p.approach && p.approachFinish)
        val p3 = Entry.plan(par3, all)
        assertFalse(p3.drive) // direction, club, drive distance hidden on a par 3
        assertFalse(p3.approachFinish) // finish hidden, distance stays ("hole distance")
        assertTrue(p3.approach && p3.teePenalties && p3.sand && p3.par3Note)
        assertFalse(Entry.plan(par3, Track.None.copy(teeShot = true)).hasDrivePage)
        assertTrue(Entry.plan(par3, Track.None.copy(teeShot = true, penalties = true)).hasDrivePage)
        assertFalse(Entry.plan(par3, Track.None.copy(teeShot = true, penalties = true)).hasTeeShotPage)
        assertTrue(Entry.plan(par4, Track.None.copy(teeShot = true)).hasTeeShotPage)
        assertFalse(Entry.plan(par4, Track.None.copy(penalties = true)).hasTeeShotPage)
        assertFalse(Entry.plan(par4, Track.None.copy(approach = false, putting = false)).hasApproachPage)
        assertTrue(Entry.plan(par4, Track.None.copy(putting = true)).hasShortPage)
        assertFalse(Entry.plan(par4, Track.None.copy(teeShot = true)).hasShortPage)
    }

    @Test
    fun pagesFollowGroupsAndBlocks() {
        assertEquals(
            listOf(PageKind.Distances, PageKind.Score, PageKind.Stats),
            Pages.of(Fixtures.state()),
        )
        val onlyPutting = Fixtures.activeJson(track = """{"putting":true,"teeShot":false,"shortGame":false,"penalties":false,"approach":false}""")
        assertEquals(listOf(PageKind.Distances, PageKind.Score, PageKind.Stats), Pages.of(Fixtures.state(onlyPutting)))
        val onlyApproach = Fixtures.activeJson(track = """{"putting":false,"teeShot":false,"shortGame":false,"penalties":false,"approach":true}""")
        assertEquals(listOf(PageKind.Distances, PageKind.Score, PageKind.Stats), Pages.of(Fixtures.state(onlyApproach)))
        assertEquals(3, Pages.of(Fixtures.state(Fixtures.activeJson(blocked = "dispute"))).size)
        assertEquals(listOf(PageKind.Distances), Pages.of(Fixtures.state(Fixtures.activeJson(blocked = "viewOnly"))))
        assertEquals(listOf(PageKind.Distances), Pages.of(Fixtures.state(Fixtures.activeJson(blocked = "official"))))
        assertEquals(listOf(PageKind.Distances), Pages.of(WatchState.Inactive))
        val noStats = Fixtures.activeJson(track = """{"putting":false,"teeShot":false,"shortGame":false,"penalties":false,"approach":false}""")
        assertEquals(listOf(PageKind.Distances, PageKind.Score), Pages.of(Fixtures.state(noStats)))
    }

    @Test
    fun initialDraftSeedsFromThePhoneWithoutInventingValues() {
        assertEquals(empty, Entry.initialDraft(me0))
        val shot = ShotDetail(putts = 2, drive = "left", sandShots = 1, teePenalties = 1)
        assertEquals(d(5, shot), Entry.initialDraft(me0.copy(strokes = 5, shot = shot)))
        // putts are meaningless without strokes
        assertNull(Entry.initialDraft(me0.copy(shot = ShotDetail(putts = 2))).shot.putts)
    }

    // --- patch building ---

    @Test
    fun shotPatchHoldsOnlyTrackedFieldsAbsoluteAndValid() {
        val shot = ShotDetail(
            putts = 2, drive = "left", teeClub = "wood", driveDistBucket = "180-210", teePenalties = 1,
            otherPenalties = 0, sandShots = 1, recoveryOutcome = "sand-save", firstPuttBucket = "1-2",
            approachBucket = "100-150", approachResult = "miss", approachMiss = "long", approachBunker = true,
        )
        val patch = Entry.shotPatch(allPlan, d(6, shot))!!
        assertEquals(
            mapOf(
                "putts" to 2, "firstPuttBucket" to "1-2", "drive" to "left", "teeClub" to "wood",
                "driveDistBucket" to "180-210", "teePenalties" to 1, "otherPenalties" to 0, "sandShots" to 1,
                "recoveryOutcome" to "sand-save", "approachBucket" to "100-150", "approachResult" to "miss",
                "approachMiss" to "long", "approachBunker" to true,
            ),
            patch,
        )
        assertFalse(patch.containsKey("driveLie")) // the phone derives it
        assertTrue(patch.all { (k, v) -> ShotKeys.isValid(k, v) })
        // builds a command the phone accepts
        Commands.shot("r1", 1, 7, patch)
    }

    @Test
    fun shotPatchRespectsGroupsAndPar3() {
        val x = d(5, ShotDetail(putts = 2, drive = "left", approachBucket = "50-100", approachMiss = "left", approachResult = "miss"))
        assertEquals(setOf("putts", "firstPuttBucket"), Entry.shotPatch(Entry.plan(par4, Track.None.copy(putting = true)), x)!!.keys)
        assertNull(Entry.shotPatch(Entry.plan(par4, Track.None), x))
        val p3 = Entry.shotPatch(Entry.plan(par3, all), x)!!.keys
        assertFalse(p3.any { it in setOf("drive", "teeClub", "driveDistBucket", "approachResult", "approachMiss", "approachBunker") })
        assertTrue("approachBucket" in p3 && "teePenalties" in p3 && "sandShots" in p3 && "recoveryOutcome" in p3)
        assertFalse(Entry.shotPatch(allPlan, x.copy(shot = x.shot.copy(putts = null)))!!.containsKey("putts"))
        // first putt distance goes as null when there are no putts
        assertNull(Entry.shotPatch(allPlan, x.copy(shot = x.shot.copy(putts = 0, firstPuttBucket = "1-2")))!!["firstPuttBucket"])
        assertNull(Entry.shotPatch(allPlan, empty)) // the phone refuses a shot without strokes
        assertEquals(false, Entry.shotPatch(allPlan, x)!!["approachBunker"]) // never null
    }

    @Test
    fun patchValidationRejectsWhatThePhoneWouldRefuse() {
        assertTrue(ShotKeys.isValid("teePenalties", 9))
        assertFalse(ShotKeys.isValid("teePenalties", 10))
        assertFalse(ShotKeys.isValid("putts", 11))
        assertFalse(ShotKeys.isValid("sandShots", -1))
        assertFalse(ShotKeys.isValid("drive", "middle"))
        assertTrue(ShotKeys.isValid("drive", null))
        assertFalse(ShotKeys.isValid("teeClub", "driver")) // the driver is null
        assertTrue(ShotKeys.isValid("teeClub", "iron"))
        assertFalse(ShotKeys.isValid("approachBunker", null))
        assertFalse(ShotKeys.isValid("approachLie", "rough")) // phone-only
        assertTrue(ShotKeys.isValid("recoveryOutcome", "none"))
        assertFalse(ShotKeys.isValid("firstPuttBucket", "9-10"))
        assertFalse(ShotKeys.isValid("approachResult", "long"))
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
            Commands.shot("r1", 1, 7, mapOf("drive" to "middle"))
        }
    }

    @Test
    fun saveSendsStrokesThenOneShotAndNothingWithoutStrokes() {
        val state = Fixtures.state()
        val cmds = Entry.saveCommands(state, allPlan, d(5, ShotDetail(putts = 2)))
        assertEquals(listOf(CommandType.Strokes, CommandType.Shot), cmds.map { it.type })
        assertTrue(cmds.all { it.roundId == "r1" && it.baseRev == 10L && it.hole == 7 })
        assertEquals(1, Entry.saveCommands(state, Entry.plan(par4, Track.None), d(5)).size)
        assertTrue(Entry.saveCommands(state, allPlan, empty).isEmpty())
    }

    @Test
    fun pointsAndTotalAdjustTheRoundTotal() {
        val s = Fixtures.state()
        assertEquals(2 to 16, Entry.pointsAndTotal(par4, s.me!!, 5))
        assertEquals(null to 14, Entry.pointsAndTotal(par4, s.me!!, null))
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
        assertEquals("3 pts · 14 total", Copy.footer(3, 14))
        assertEquals("14 total", Copy.footer(null, 14))
        assertEquals("<150", Copy.driveDistLabel("0-150", Units.M))
        assertEquals("165-195", Copy.driveDistLabel("150-180", Units.YD))
        assertEquals("55-110", Copy.approachLabel("50-100", Units.YD))
        assertEquals("3-7", Copy.firstPuttLabel("3-6", Units.YD))
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
        val cmds = Entry.saveCommands(opened, plan, Entry.initialDraft(opened.me!!).copy(strokes = 4))
        assertEquals(listOf(7), cmds.map { it.hole })
    }

    // --- crown accumulation ---

    @Test
    fun accumulatorTurnsDeltasIntoWholeSteps() {
        val acc = StepAccumulator(50f)
        assertEquals(0, acc.feed(30f))
        assertEquals(1, acc.feed(30f))
        assertEquals(0, acc.feed(30f))
        assertEquals(1, acc.feed(30f))
        assertEquals(-2, StepAccumulator(50f).feed(-120f))
    }

    @Test
    fun accumulatorDropsTheCarryWhenTheDirectionReverses() {
        val acc = StepAccumulator(50f)
        assertEquals(0, acc.feed(40f))
        assertEquals(0, acc.feed(-20f))
        assertEquals(-1, acc.feed(-35f))
    }

    // --- one hole per swipe ---

    @Test
    fun aLongDragFiresOnceAtTheThresholdAndIgnoresTheRest() {
        val g = OneStepGesture(56f)
        g.start()
        var fired = 0
        repeat(40) { fired += g.drag(-10f) } // 400px of upward drag
        assertEquals(-1, fired)
        assertEquals(0, g.end()) // release adds nothing
    }

    @Test
    fun aShortFlickFiresOnReleaseOnly() {
        val g = OneStepGesture(56f)
        g.start()
        assertEquals(0, g.drag(30f))
        assertEquals(1, g.end())
        g.start()
        assertEquals(0, g.drag(20f)) // under half the threshold: nothing
        assertEquals(0, g.end())
    }

    @Test
    fun eachGestureGetsItsOwnStepAndACancelFiresNothing() {
        val g = OneStepGesture(56f)
        g.start(); assertEquals(1, g.drag(60f)); g.end()
        g.start(); assertEquals(-1, g.drag(-60f)); g.end()
        g.start(); assertEquals(0, g.drag(40f)); g.cancel()
        g.start(); assertEquals(0, g.end())
        // reversing inside one drag nets out: 40 down, 30 back = 10, a drag that went nowhere
        g.start()
        assertEquals(0, g.drag(40f))
        assertEquals(0, g.drag(-30f))
        assertEquals(0, g.end())
    }
}
