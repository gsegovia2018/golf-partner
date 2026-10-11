package com.golfpartner.wear.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONException

/** The outbox queue in SharedPreferences, so a watch app restart does not lose scores. */
class PrefsCommandStore(context: Context) : CommandStore {
    private val prefs = context.applicationContext.getSharedPreferences("golf_outbox", Context.MODE_PRIVATE)

    override fun load(): List<String> = try {
        val a = JSONArray(prefs.getString(KEY, "[]"))
        List(a.length()) { a.getString(it) }
    } catch (e: JSONException) {
        emptyList()
    }

    override fun save(items: List<String>) {
        prefs.edit().putString(KEY, JSONArray(items).toString()).apply()
    }

    private companion object {
        const val KEY = "queue"
    }
}
