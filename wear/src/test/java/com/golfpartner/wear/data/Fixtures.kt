package com.golfpartner.wear.data

/** Shared state payloads, shaped like src/store/watchProtocol.js watchStateOf(). */
object Fixtures {
    fun activeJson(
        rev: Long = 10,
        ack: String? = null,
        roundId: String = "r1",
        v: Int = 1,
        blocked: String? = null,
        par: Int = 4,
        extraShots: Int = 1,
        count: Int = 18,
        number: Int = 7,
        green: String = """{"front":[41.0,2.0],"center":[41.001,2.0],"back":[41.002,2.0]}""",
        phone: String = """{"front":120.4,"center":131.5,"back":142.0,"source":"gps"}""",
        strokes: String = "null",
        points: String = "null",
        totalPoints: Int = 14,
        putts: String = "null",
        driveLie: String = "null",
        track: String = """{"putting":true,"teeShot":true,"shortGame":true,"penalties":true}""",
        extra: String = "",
    ) = """
        {"v":$v,"rev":$rev,"ack":${ack?.let { "\"$it\"" } ?: "null"},"roundId":"$roundId","courseName":"El Saler","active":true,
         "blocked":${blocked?.let { "\"$it\"" } ?: "null"},"units":"m",
         "hole":{"number":$number,"count":$count,"par":$par,"si":3,"extraShots":$extraShots,
                 "green":$green,"phone":$phone},
         "me":{"playerId":"p1","name":"Marcos","strokes":$strokes,"points":$points,"totalPoints":$totalPoints,
               "thru":6,"putts":$putts,"driveLie":$driveLie,"sandShots":0,"penalties":0},
         "track":$track$extra}
    """.trimIndent()

    fun state(json: String = activeJson()): WatchState =
        (WatchStateParser.parse(json) as StateParse.Ok).state
}
