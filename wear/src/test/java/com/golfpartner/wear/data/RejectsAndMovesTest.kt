package com.golfpartner.wear.data

import com.golfpartner.wear.ui.Copy
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** v1.3: a hole shown ahead of the phone is look-only; refused saves are reported; patches are minimal. */
class RejectsAndMovesTest {
    private val course = """
        ,"course":{"holes":[
          {"number":7,"par":4,"si":3,"extraShots":1,"green":null},
          {"number":8,"par":3,"si":11,"extraShots":0,"green":null}
        ]},
        "mine":{"7":{"strokes":null,"points":null,"shot":null},"8":{"strokes":4,"points":1,"shot":{"putts":1}}}
    """.trimIndent()
    private val phone = Fixtures.state(Fixtures.activeJson(number = 7, extra = course))
    private val all = Track(putting = true, teeShot = true, shortGame = true, penalties = true, approach = true)

    // --- a hole shown ahead of the phone ---

    @Test
    fun entryIsOffWhileTheTargetIsNotThePhonesHole() {
        val moving = HoleMove.movingTo(target = 8, phoneHole = 7)
        assertEquals(8, moving)
        val shown = phone.at(8)
        assertEquals(8, shown.hole!!.number) // shown at once ...
        assertEquals(4, shown.me!!.strokes)
        assertFalse(HoleMove.inputsOn(shown, moving)) // ... but not editable
        // An edit pinned to it would not belong to the phone's hole (WatchController.edit drops it).
        assertFalse(Entry.stillOn(shown, phone))
    }

    @Test
    fun entryComesBackOnceThePhoneConfirmsTheMove() {
        val arrived = Fixtures.state(Fixtures.activeJson(number = 8, par = 3, extra = course))
        val moving = HoleMove.movingTo(target = 8, phoneHole = 8)
        assertNull(moving)
        assertTrue(HoleMove.inputsOn(arrived.at(8), moving))
        assertTrue(HoleMove.inputsOn(phone, HoleMove.movingTo(null, 7)))
        // Still off where entry is blocked anyway.
        val dispute = Fixtures.state(Fixtures.activeJson(blocked = "dispute", extra = course))
        assertFalse(HoleMove.inputsOn(dispute, null))
    }

    @Test
    fun aMoveThePhoneStateRefusesFailsWithANotice() {
        assertNull(HoleMove.failure(phone))
        assertEquals(Notice.ResolveOnPhone, HoleMove.failure(Fixtures.state(Fixtures.activeJson(blocked = "dispute"))))
        assertEquals(Notice.MoveFailed, HoleMove.failure(Fixtures.state(Fixtures.activeJson(blocked = "viewOnly"))))
        assertEquals("Couldn't change hole — check phone", Copy.notice(Notice.MoveFailed))
        assertEquals("Resolve on phone", Copy.notice(Notice.ResolveOnPhone))
        assertEquals("Moving to hole 8…", Copy.movingToHole(8))
    }

    // --- lastReject ---

    private fun withReject(id: String, reason: String = "hole", hole: Int = 7, ack: String? = id, rev: Long = 11) =
        Fixtures.activeJson(rev = rev, ack = ack, extra = ""","lastReject":{"id":"$id","reason":"$reason","hole":$hole}""")

    @Test
    fun lastRejectIsParsedActiveOrNot() {
        assertEquals(Reject("c1", "hole", 7), Fixtures.state(withReject("c1")).lastReject)
        assertNull(phone.lastReject)
        val inactive = WatchStateParser.parse("""{"v":1,"rev":3,"active":false,"lastReject":{"id":"c2","reason":"round","hole":null}}""")
        assertEquals(Reject("c2", "round", null), (inactive as StateParse.Ok).state.lastReject)
    }

    @Test
    fun aRejectNamingOneOfMySavesMapsToNotSavedForItsHole() {
        val strokes = Commands.strokes("r1", 10, 7, 5, id = "s1")
        val shot = Commands.shot("r1", 10, 7, mapOf("putts" to 2), id = "p1")
        val move = Commands.hole("r1", 10, 8, id = "h1")
        assertEquals(RejectedSave("s1", 7), Rejects.notSaved(Reject("s1", "hole", 7), listOf(strokes, shot)))
        assertEquals(RejectedSave("p1", 7), Rejects.notSaved(Reject("p1", "refused", 7), listOf(strokes, shot)))
        assertNull(Rejects.notSaved(Reject("h1", "stale", 8), listOf(move))) // a move is not a save
        assertNull(Rejects.notSaved(Reject("x", "hole", 7), listOf(strokes))) // not ours / already reported
        assertNull(Rejects.notSaved(null, listOf(strokes)))
        assertEquals("Not saved — hole 7", Copy.notice(Notice.NotSaved(7)))
    }

    @Test
    fun theRepositoryReportsARefusedSaveOnceAndShowsThePhonesValues() {
        val repo = StateRepository()
        repo.onPayload(Fixtures.activeJson(rev = 10))
        repo.track(Commands.strokes("r1", 10, 7, 5, id = "s1"), seq = 1)
        assertEquals(5, runBlocking { repo.state.first() }!!.me!!.strokes)
        repo.onPayload(withReject("s1"))
        assertEquals(RejectedSave("s1", 7), repo.notSaved.value)
        assertNull(runBlocking { repo.state.first() }!!.me!!.strokes) // back to the phone's truth
        // The same reject in later states is not news (the overlay is gone).
        repo.track(Commands.strokes("r1", 11, 7, 6, id = "s2"), seq = 2)
        repo.onPayload(withReject("s1", ack = "s2", rev = 12))
        assertEquals(RejectedSave("s1", 7), repo.notSaved.value)
    }

    // --- minimal shot patches ---

    private val seeded = ShotDetail(putts = 2, drive = "left", teeClub = "iron", sandShots = 1, firstPuttBucket = "1-2")
    private val plan = Entry.plan(HoleInfo(7, 18, 4, 3, 1, null, null), all)

    @Test
    fun onlyChangedShotKeysAreSent() {
        val draft = EntryDraft(5, seeded.copy(putts = 3))
        assertEquals(mapOf<String, Any?>("putts" to 3), Entry.shotPatch(plan, draft, seeded))
        // Nothing changed: no patch at all.
        assertNull(Entry.shotPatch(plan, EntryDraft(5, seeded), seeded))
        // Without a seed, everything tracked goes (older behaviour).
        assertTrue(Entry.shotPatch(plan, draft)!!.containsKey("drive"))
    }

    @Test
    fun aStrokesOnlyEditSendsNoShotCommand() {
        val json = Fixtures.activeJson(
            strokes = "5", points = "2",
            extra = ""","mine":{"7":{"strokes":5,"points":2,"shot":{"putts":2,"drive":"left","teeClub":"iron","sandShots":1,"firstPuttBucket":"1-2"}}}""",
        )
        val opened = Fixtures.state(json)
        val draft = Entry.stepStrokes(opened.hole!!, Entry.initialDraft(opened.me!!), +1) // 6, nothing trimmed
        val cmds = Entry.saveCommands(opened, plan, draft)
        assertEquals(listOf(CommandType.Strokes), cmds.map { it.type })
    }

    @Test
    fun fieldsTheReconcileTrimmedAreStillSent() {
        // 4 strokes, 2 putts + 1 sand; down to 1 stroke trims the putts to 0 (and their bucket).
        val seed = ShotDetail(putts = 2, sandShots = 1, firstPuttBucket = "1-2")
        val trimmed = Entry.stepStrokes(HoleInfo(7, 18, 4, 3, 1, null, null), EntryDraft(4, seed), -3)
        assertEquals(1, trimmed.strokes)
        val patch = Entry.shotPatch(plan, trimmed, seed)!!
        assertEquals(mapOf<String, Any?>("putts" to 0, "firstPuttBucket" to null), patch)
    }
}
