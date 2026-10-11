package com.golfpartner.wear.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ProtocolTest {
    @Test
    fun pathsMatchTheV1Contract() {
        assertEquals(1, Protocol.VERSION)
        assertEquals("/golf/state", Protocol.STATE_PATH)
        assertEquals("json", Protocol.STATE_KEY)
        assertEquals("/golf/cmd", Protocol.COMMAND_PATH)
    }
}
