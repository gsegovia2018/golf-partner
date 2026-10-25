package com.golfpartner.shotsense

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

const val API_VERSION = 1

/**
 * JS side of the shot listener (src/lib/shotSense.js).
 *
 *  - start(session, title): starts [ShotSenseService] for `session` (a round).
 *    Resolves false, and starts nothing, without the mic permission or while
 *    the app is not visible (a microphone service may only start then).
 *  - stop(): stops it.
 *  - running(): the session being listened to, or null.
 *  - readEvents(session): that session's events.jsonl ("" when none).
 *  - sessionDir(session): file:// URI of the session's folder (clips).
 *  - sessions(): every kept session as { name (the folder name), modified, bytes, clips }.
 */
class ShotSenseModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw IllegalStateException("No context")

  override fun definition() = ModuleDefinition {
    Name("GolfShotSense")

    Constant("apiVersion") { API_VERSION }

    AsyncFunction("start") { session: String, title: String ->
      val ctx = context
      if (ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return@AsyncFunction false
      if (!inForeground()) return@AsyncFunction false
      if (ShotSenseService.running == session) return@AsyncFunction true
      val intent = Intent(ctx, ShotSenseService::class.java)
        .setAction(ShotSenseService.ACTION_START)
        .putExtra(ShotSenseService.EXTRA_SESSION, session)
        .putExtra(ShotSenseService.EXTRA_TITLE, title)
      try {
        ctx.startService(intent) != null
      } catch (_: Exception) {
        false
      }
    }

    AsyncFunction("stop") {
      if (ShotSenseService.running == null) return@AsyncFunction null
      val ctx = context
      try {
        ctx.startService(Intent(ctx, ShotSenseService::class.java).setAction(ShotSenseService.ACTION_STOP))
      } catch (_: Exception) {
        ctx.stopService(Intent(ctx, ShotSenseService::class.java))
      }
      null
    }

    Function("running") { ShotSenseService.running }

    AsyncFunction("readEvents") { session: String ->
      val f = File(sessionDir(session), SessionStore.EVENTS)
      if (f.exists()) f.readText() else ""
    }

    Function("sessionDir") { session: String -> "file://" + sessionDir(session).absolutePath }

    AsyncFunction("sessions") {
      SessionStore.root(context).listFiles { f -> f.isDirectory }.orEmpty().map { dir ->
        val files = dir.listFiles().orEmpty()
        mapOf(
          "name" to dir.name,
          "modified" to (files.maxOfOrNull { it.lastModified() } ?: dir.lastModified()).toDouble(),
          "bytes" to files.sumOf { it.length() }.toDouble(),
          "clips" to files.map { it.name }.filter { it.endsWith(".wav") },
        )
      }
    }
  }

  private fun sessionDir(session: String) = File(SessionStore.root(context), SessionStore.safeName(session))

  private fun inForeground(): Boolean {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }
}
