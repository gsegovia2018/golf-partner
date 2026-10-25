package com.golfpartner.shotsense

import android.content.Context
import java.io.File

/**
 * One listening session's files: `filesDir/shot-sense/<session>/events.jsonl`
 * (one JSON object per line) and a `<t>.wav` clip per strike. A session is a
 * round (the JS proposal key); listening again to the same round appends.
 * Nothing here leaves the phone; the JS export reads these files.
 */
class SessionStore(root: File, session: String) {
  val dir = File(root, safeName(session)).apply { mkdirs() }
  private val events = File(dir, EVENTS)

  @Synchronized
  fun append(line: String) {
    try { events.appendText(line + "\n") } catch (_: Exception) { /* storage full: drop the line */ }
  }

  fun writeClip(name: String, bytes: ByteArray) {
    try { File(dir, name).writeBytes(bytes) } catch (_: Exception) { /* storage full: the event still says what was heard */ }
  }

  companion object {
    const val EVENTS = "events.jsonl"
    const val KEEP_SESSIONS = 10

    fun root(context: Context) = File(context.filesDir, "shot-sense")

    fun safeName(session: String) = session.replace(Regex("[^A-Za-z0-9_-]"), "_")

    /** Deletes all but the [keep] most recently written sessions (and never [except]). */
    fun prune(root: File, except: String, keep: Int = KEEP_SESSIONS) {
      val dirs = root.listFiles { f -> f.isDirectory }?.sortedByDescending { lastWrite(it) } ?: return
      dirs.drop(keep).filter { it.name != safeName(except) }.forEach { it.deleteRecursively() }
    }

    private fun lastWrite(dir: File) = File(dir, EVENTS).takeIf { it.exists() }?.lastModified() ?: dir.lastModified()
  }
}
