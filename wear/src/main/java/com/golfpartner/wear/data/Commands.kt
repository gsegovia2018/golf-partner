package com.golfpartner.wear.data

import org.json.JSONException
import org.json.JSONObject
import java.util.UUID

enum class CommandType(val wire: String) {
    Strokes("strokes"),
    Shot("shot"),
    Hole("hole");

    companion object {
        fun of(wire: String?): CommandType? = entries.firstOrNull { it.wire == wire }
    }
}

/** Keys of a `shot` patch, exactly as the phone's parseWatchCommand accepts them. */
object ShotKeys {
    const val PUTTS = "putts"
    /** Legacy; the watch no longer sends it (the phone derives it from `drive`). */
    const val DRIVE_LIE = "driveLie"
    const val DRIVE = "drive"
    const val TEE_CLUB = "teeClub"
    const val DRIVE_DIST_BUCKET = "driveDistBucket"
    const val TEE_PENALTIES = "teePenalties"
    const val SAND_SHOTS = "sandShots"
    const val OTHER_PENALTIES = "otherPenalties"
    const val RECOVERY_OUTCOME = "recoveryOutcome"
    const val FIRST_PUTT_BUCKET = "firstPuttBucket"
    const val APPROACH_BUCKET = "approachBucket"
    const val APPROACH_RESULT = "approachResult"
    const val APPROACH_MISS = "approachMiss"
    const val APPROACH_BUNKER = "approachBunker"

    val ALL = setOf(
        PUTTS, DRIVE_LIE, DRIVE, TEE_CLUB, DRIVE_DIST_BUCKET, TEE_PENALTIES, SAND_SHOTS, OTHER_PENALTIES,
        RECOVERY_OUTCOME, FIRST_PUTT_BUCKET, APPROACH_BUCKET, APPROACH_RESULT, APPROACH_MISS, APPROACH_BUNKER,
    )

    private val INT_RANGES = mapOf(
        PUTTS to 0..10, TEE_PENALTIES to 0..9, SAND_SHOTS to 0..9, OTHER_PENALTIES to 0..9,
    )

    // Teeclub on the wire never carries "driver" (it is null); driveLie is the legacy lie model.
    private val OPTIONS: Map<String, List<String>> = mapOf(
        DRIVE to Options.DRIVES,
        TEE_CLUB to Options.CLUBS.filter { it != "driver" },
        DRIVE_DIST_BUCKET to Options.DRIVE_DIST,
        RECOVERY_OUTCOME to Options.RECOVERY,
        FIRST_PUTT_BUCKET to Options.FIRST_PUTT,
        APPROACH_BUCKET to Options.APPROACH,
        APPROACH_RESULT to Options.APPROACH_RESULTS,
        APPROACH_MISS to Options.MISS_DIRS,
        DRIVE_LIE to listOf("fairway", "rough", "sand", "trouble"),
    )

    /** Whether [value] is acceptable for [key]; counters are ints in range, options are listed strings or null. */
    fun isValid(key: String, value: Any?): Boolean = when {
        key == PUTTS -> value is Int && value in INT_RANGES.getValue(PUTTS)
        key in INT_RANGES -> value is Int && value in INT_RANGES.getValue(key)
        key == APPROACH_BUNKER -> value is Boolean
        key in OPTIONS -> value == null || (value is String && value in OPTIONS.getValue(key))
        else -> false
    }

    /** [shot] with [patch] laid over it (absolute values); unknown keys and bad values are ignored. */
    fun applyTo(shot: ShotDetail, patch: Map<String, Any?>): ShotDetail {
        var s = shot
        patch.forEach { (k, v) ->
            if (!isValid(k, v)) return@forEach
            s = when (k) {
                PUTTS -> s.copy(putts = v as Int)
                DRIVE -> s.copy(drive = v as String?)
                TEE_CLUB -> s.copy(teeClub = v as String?)
                DRIVE_DIST_BUCKET -> s.copy(driveDistBucket = v as String?)
                TEE_PENALTIES -> s.copy(teePenalties = v as Int)
                SAND_SHOTS -> s.copy(sandShots = v as Int)
                OTHER_PENALTIES -> s.copy(otherPenalties = v as Int)
                RECOVERY_OUTCOME -> s.copy(recoveryOutcome = v as String?)
                FIRST_PUTT_BUCKET -> s.copy(firstPuttBucket = v as String?)
                APPROACH_BUCKET -> s.copy(approachBucket = v as String?)
                APPROACH_RESULT -> s.copy(approachResult = v as String?)
                APPROACH_MISS -> s.copy(approachMiss = v as String?)
                APPROACH_BUNKER -> s.copy(approachBunker = v as Boolean)
                else -> s
            }
        }
        return s
    }
}

/**
 * One watch -> phone command (v1). Values are absolute, so re-sending is harmless.
 * [hole] is the hole a `strokes`/`shot` applies to; null for `hole` navigation,
 * whose target is [to].
 */
data class Command(
    val id: String,
    val roundId: String,
    val baseRev: Long,
    val type: CommandType,
    val hole: Int? = null,
    val value: Int? = null,
    val patch: Map<String, Any?> = emptyMap(),
    val to: Int? = null,
) {
    /** Commands with the same key supersede each other in the outbox. */
    val key: String get() = "$roundId|${hole ?: "-"}|${type.wire}"

    fun toJson(): JSONObject {
        val o = JSONObject()
        o.put("v", Protocol.VERSION)
        o.put("id", id)
        o.put("roundId", roundId)
        o.put("baseRev", baseRev)
        when (type) {
            CommandType.Strokes -> {
                o.put("hole", hole)
                o.put("type", type.wire)
                o.put("value", value ?: JSONObject.NULL)
            }
            CommandType.Shot -> {
                o.put("hole", hole)
                o.put("type", type.wire)
                val p = JSONObject()
                patch.forEach { (k, v) -> p.put(k, v ?: JSONObject.NULL) }
                o.put("patch", p)
            }
            CommandType.Hole -> {
                o.put("type", type.wire)
                o.put("to", to)
            }
        }
        return o
    }

    /** [newer] has the same [key]: its values win; shot patches merge field by field. */
    fun supersededBy(newer: Command): Command =
        if (type == CommandType.Shot) newer.copy(patch = patch + newer.patch) else newer

    companion object {
        fun fromJson(raw: String): Command? = try {
            val o = JSONObject(raw)
            val type = CommandType.of(o.optString("type", ""))
            if (type == null || o.optInt("v") != Protocol.VERSION) {
                null
            } else {
                val patchObj = o.optJSONObject("patch")
                val patch = LinkedHashMap<String, Any?>()
                patchObj?.keys()?.forEach { k ->
                    patch[k] = if (patchObj.isNull(k)) null else patchObj.get(k)
                }
                Command(
                    id = o.getString("id"),
                    roundId = o.getString("roundId"),
                    baseRev = o.getLong("baseRev"),
                    type = type,
                    hole = if (o.has("hole")) o.getInt("hole") else null,
                    value = if (o.has("value") && !o.isNull("value")) o.getInt("value") else null,
                    patch = patch,
                    to = if (o.has("to")) o.getInt("to") else null,
                )
            }
        } catch (e: JSONException) {
            null
        }
    }
}

/** Builders for the three v1 commands. [newId] is injectable for tests. */
object Commands {
    fun strokes(
        roundId: String, baseRev: Long, hole: Int, value: Int?,
        id: String = newId(),
    ) = Command(id, roundId, baseRev, CommandType.Strokes, hole = hole, value = value)

    /** [patch] may only hold [ShotKeys.ALL]; anything else would be rejected by the phone. */
    fun shot(
        roundId: String, baseRev: Long, hole: Int, patch: Map<String, Any?>,
        id: String = newId(),
    ): Command {
        require(patch.isNotEmpty()) { "empty shot patch" }
        require(patch.keys.all { it in ShotKeys.ALL }) { "unknown shot key in ${patch.keys}" }
        require(patch.all { (k, v) -> ShotKeys.isValid(k, v) }) { "bad shot value in $patch" }
        return Command(id, roundId, baseRev, CommandType.Shot, hole = hole, patch = patch)
    }

    fun hole(roundId: String, baseRev: Long, to: Int, id: String = newId()) =
        Command(id, roundId, baseRev, CommandType.Hole, to = to)

    fun newId(): String = UUID.randomUUID().toString()
}
