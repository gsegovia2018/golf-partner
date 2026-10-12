package expo.modules.golfswing

/** Per-stage wall-clock accumulators (ns), reported in analyzePose timings. */
internal class Prof {
  private val ns = LinkedHashMap<String, Long>()

  @Synchronized fun add(stage: String, d: Long) {
    ns[stage] = (ns[stage] ?: 0L) + d
  }

  inline fun <T> time(stage: String, block: () -> T): T {
    val t = System.nanoTime()
    try {
      return block()
    } finally {
      add(stage, System.nanoTime() - t)
    }
  }

  @Synchronized fun ms(): Map<String, Int> = ns.mapValues { (it.value / 1_000_000).toInt() }
}
