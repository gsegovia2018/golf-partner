package com.golfpartner.wear.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class CommandsTest {
    @Test
    fun strokesJsonShape() {
        val o = Commands.strokes("r1", 10, 7, 5, id = "a").toJson()
        assertEquals(
            setOf("v", "id", "roundId", "baseRev", "hole", "type", "value"),
            o.keys().asSequence().toSet(),
        )
        assertEquals(1, o.getInt("v"))
        assertEquals("a", o.getString("id"))
        assertEquals("r1", o.getString("roundId"))
        assertEquals(10, o.getLong("baseRev"))
        assertEquals(7, o.getInt("hole"))
        assertEquals("strokes", o.getString("type"))
        assertEquals(5, o.getInt("value"))
    }

    @Test
    fun strokesCanClearWithNull() {
        assertTrue(Commands.strokes("r1", 1, 7, null).toJson().isNull("value"))
    }

    @Test
    fun shotJsonHasOnlyThePatch() {
        val o = Commands.shot("r1", 10, 7, mapOf("putts" to 2, "driveLie" to null)).toJson()
        assertEquals("shot", o.getString("type"))
        assertEquals(7, o.getInt("hole"))
        val patch = o.getJSONObject("patch")
        assertEquals(2, patch.getInt("putts"))
        assertTrue(patch.isNull("driveLie"))
        assertEquals(setOf("putts", "driveLie"), patch.keys().asSequence().toSet())
        assertFalse(o.has("value"))
    }

    @Test
    fun shotRejectsKeysThePhoneWouldRefuse() {
        assertThrows(IllegalArgumentException::class.java) { Commands.shot("r1", 1, 7, mapOf("drive" to "x")) }
        assertThrows(IllegalArgumentException::class.java) { Commands.shot("r1", 1, 7, emptyMap()) }
    }

    @Test
    fun holeJsonHasNoHoleField() {
        val o = Commands.hole("r1", 10, 8).toJson()
        assertEquals("hole", o.getString("type"))
        assertEquals(8, o.getInt("to"))
        assertFalse(o.has("hole"))
    }

    @Test
    fun idsAreUnique() {
        assertNotEquals(Commands.hole("r", 1, 2).id, Commands.hole("r", 1, 2).id)
    }

    @Test
    fun roundTripsThroughJson() {
        val cmds = listOf(
            Commands.strokes("r1", 10, 7, 5),
            Commands.shot("r1", 10, 7, mapOf("putts" to 2, "driveLie" to "rough")),
            Commands.hole("r1", 10, 8),
        )
        cmds.forEach { assertEquals(it, Command.fromJson(it.toJson().toString())) }
        assertEquals(null, Command.fromJson("{\"v\":2}"))
        assertEquals(null, Command.fromJson("nope"))
    }

    @Test
    fun jsonIsParsableAsPlainJson() {
        JSONObject(Commands.hole("r1", 10, 8).toJson().toString())
    }
}
