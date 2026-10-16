package expo.modules.golfswing

/** Runs [task] once after [delayMs]; the returned function cancels it if it has not run yet. */
internal fun interface IdleScheduler {
  fun schedule(delayMs: Long, task: () -> Unit): () -> Unit
}

/**
 * The warm club detector of detectClub (plan 2026-10-16 on demand §3.1): opened on the first
 * [use], reused afterwards, closed [idleMs] after the last call, on [release] and on module
 * destroy. Not thread-safe by design: every call ([use], [release], the idle task) runs on the
 * one `golf-swing-club` thread, which also keeps the GPU delegate on the thread that created it.
 * Generic and given its opener and scheduler so it is unit-tested on the JVM.
 */
internal class ClubWarm<T : AutoCloseable>(
  private val open: () -> T,
  private val scheduler: IdleScheduler,
  private val idleMs: Long = IDLE_MS,
) {
  companion object {
    const val IDLE_MS = 60_000L
  }

  private var instance: T? = null
  private var cancelIdle: (() -> Unit)? = null
  /** Bumped on every arm / release: an idle task that fires late for an older generation does nothing. */
  private var generation = 0L

  val isOpen get() = instance != null

  /**
   * [block] with the instance (opened now when none: an [open] failure propagates and leaves
   * nothing open) and whether it was already open; the idle close is re-armed afterwards, also
   * when [block] throws.
   */
  fun <R> use(block: (instance: T, warm: Boolean) -> R): R {
    disarm()
    val warm = instance != null
    val d = instance ?: open().also { instance = it }
    try {
      return block(d, warm)
    } finally {
      arm()
    }
  }

  /** Closes the instance now (a no-op when none is open). */
  fun release() {
    disarm()
    val d = instance ?: return
    instance = null
    try {
      d.close()
    } catch (_: Throwable) {
    }
  }

  private fun arm() {
    val g = ++generation
    cancelIdle = scheduler.schedule(idleMs) { if (g == generation) release() }
  }

  private fun disarm() {
    generation++
    cancelIdle?.invoke()
    cancelIdle = null
  }
}
