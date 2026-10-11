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
    const val DRIVE_LIE = "driveLie"
    const val SAND_SHOTS = "sandShots"
    const val OTHER_PENALTIES = "otherPenalties"
    val ALL = setOf(PUTTS, DRIVE_LIE, SAND_SHOTS, OTHER_PENALTIES)
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
        return Command(id, roundId, baseRev, CommandType.Shot, hole = hole, patch = patch)
    }

    fun hole(roundId: String, baseRev: Long, to: Int, id: String = newId()) =
        Command(id, roundId, baseRev, CommandType.Hole, to = to)

    fun newId(): String = UUID.randomUUID().toString()
}
