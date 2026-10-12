package expo.modules.golfswing

import android.content.Context
import android.os.Build
import android.os.PerformanceHintManager
import android.os.Process
import android.util.Log
import java.io.File

/**
 * Keeps the CPU clocks up while analyzePose runs (Android 12+ ADPF hint session).
 *
 * Why: on the GPU delegate the CPU mostly waits on the GPU, so the governor lowers the clocks
 * and the CPU-side steps of each inference (upload, crop, read-back) and the decode loop get
 * slower as the run goes on (Pixel 8 Pro: 28 ms per inference climbing to 50–68 ms; the same
 * frames take 34 ms with three busy threads beside them). A hint session with a target below
 * what the work takes makes the power HAL raise the floor of the session's threads.
 *
 * The session covers our threads and the threads MediaPipe starts for its graph and GL context
 * (found as the process's threads that appeared after the landmarker was built). Best effort:
 * any failure leaves the analysis running without it.
 */
internal class PerfHint(context: Context, private val targetNs: Long) : AutoCloseable {
  private val manager: PerformanceHintManager? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) context.getSystemService(PerformanceHintManager::class.java) else null
  private var session: PerformanceHintManager.Session? = null
  private val tids = LinkedHashSet<Int>()

  /** Adds threads to the session (created on first use). Call from any thread. */
  @Synchronized fun add(newTids: Collection<Int>) {
    val m = manager ?: return
    val s = session
    if (s == null) {
      tids.addAll(newTids)
      try {
        session = m.createHintSession(tids.toIntArray(), targetNs)?.also {
          if (Build.VERSION.SDK_INT >= 35) it.setPreferPowerEfficiency(false)
        }
      } catch (e: Throwable) {
        Log.w(PoseAnalyzer.TAG, "hint session unavailable", e)
      }
      if (session == null) tids.clear()
      return
    }
    if (Build.VERSION.SDK_INT < 34) return
    // one at a time: the system refuses the whole set for one thread it won't take (exited,
    // or not this app's), so keep those it accepts
    val live = processTids()
    tids.retainAll(live)
    for (t in newTids) {
      if (t in tids || t !in live) continue
      tids.add(t)
      try {
        s.setThreads(tids.toIntArray())
      } catch (_: Throwable) {
        tids.remove(t)
      }
    }
  }

  @Synchronized fun report(actualNs: Long) {
    try {
      session?.reportActualWorkDuration(actualNs.coerceAtLeast(1))
    } catch (_: Throwable) {
    }
  }

  @Synchronized fun active() = session != null

  @Synchronized fun threads() = tids.size

  @Synchronized override fun close() {
    try {
      session?.close()
    } catch (_: Throwable) {
    }
    session = null
  }

  companion object {
    /** The process's thread ids now (/proc/self/task). */
    fun processTids(): Set<Int> =
      File("/proc/self/task").list()?.mapNotNull { it.toIntOrNull() }?.toSet() ?: emptySet()

    /** The calling thread's id, null off-device (JVM tests). */
    fun myTid(): Int? = try {
      Process.myTid()
    } catch (_: Throwable) {
      null
    }

    /** Raises the calling thread's priority (display class); ignored where not allowed. */
    fun raiseThisThread() {
      try {
        Process.setThreadPriority(Process.THREAD_PRIORITY_DISPLAY)
      } catch (_: Throwable) {
      }
    }
  }
}
