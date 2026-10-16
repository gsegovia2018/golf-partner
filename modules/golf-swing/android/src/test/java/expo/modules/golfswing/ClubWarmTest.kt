package expo.modules.golfswing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The warm club detector's lifecycle (plan 2026-10-16 on demand §3.1, §4) with a fake opener and scheduler. */
class ClubWarmTest {
  private class Thing(val id: Int) : AutoCloseable {
    var closed = false
    override fun close() {
      closed = true
    }
  }

  /** A manual clock: [advance] runs every task due, like the club executor would. */
  private class FakeScheduler : IdleScheduler {
    var now = 0L
    val pending = ArrayList<Pair<Long, () -> Unit>>()
    var cancels = 0

    override fun schedule(delayMs: Long, task: () -> Unit): () -> Unit {
      val e = Pair(now + delayMs, task)
      pending += e
      return {
        if (pending.remove(e)) cancels++
      }
    }

    fun advance(ms: Long) {
      now += ms
      val due = pending.filter { it.first <= now }
      pending.removeAll(due)
      due.forEach { it.second() }
    }
  }

  private val opened = ArrayList<Thing>()
  private val sched = FakeScheduler()
  private val warm = ClubWarm({ Thing(opened.size).also { opened += it } }, sched, idleMs = 60_000)

  @Test
  fun opensOnceAcrossThreeUsesAndOnlyTheFirstIsCold() {
    val seen = (0 until 3).map { warm.use { t, w -> Pair(t.id, w) } }
    assertEquals(listOf(Pair(0, false), Pair(0, true), Pair(0, true)), seen)
    assertEquals(1, opened.size)
    assertTrue(warm.isOpen)
  }

  @Test
  fun everyUseReArmsTheIdleClose() {
    warm.use { _, _ -> }
    sched.advance(50_000)
    warm.use { _, _ -> }
    assertEquals(1, sched.pending.size) // the first timer was cancelled, not stacked
    sched.advance(50_000) // 100 s after the first use, 50 s after the last: still open
    assertTrue(warm.isOpen)
    assertFalse(opened[0].closed)
    sched.advance(10_000)
    assertFalse(warm.isOpen)
    assertTrue(opened[0].closed)
  }

  @Test
  fun releaseClosesNowAndCancelsTheTimer() {
    warm.use { _, _ -> }
    warm.release()
    assertFalse(warm.isOpen)
    assertTrue(opened[0].closed)
    assertTrue(sched.pending.isEmpty())
    warm.release() // a second release is a no-op
    assertEquals(1, opened.size)
  }

  @Test
  fun reopensAfterAnIdleCloseOrARelease() {
    warm.use { _, _ -> }
    sched.advance(60_000)
    assertEquals(Pair(1, false), warm.use { t, w -> Pair(t.id, w) })
    warm.release()
    assertEquals(Pair(2, false), warm.use { t, w -> Pair(t.id, w) })
    assertEquals(listOf(true, true, false), opened.map { it.closed })
  }

  @Test
  fun aStaleIdleTaskDoesNotCloseTheCurrentInstance() {
    // a scheduler whose cancel cannot stop a task already handed to the thread
    val late = ArrayList<() -> Unit>()
    val w = ClubWarm({ Thing(opened.size).also { opened += it } }, IdleScheduler { _, task -> late += task; {} }, idleMs = 1)
    w.use { _, _ -> }
    w.use { _, _ -> }
    late[0]() // the first use's timer fires after the second use re-armed
    assertTrue(w.isOpen)
    late[1]()
    assertFalse(w.isOpen)
  }

  @Test
  fun aFailedOpenLeavesNothingOpenAndAFailedBlockStillArmsTheTimer() {
    var fail = true
    val w = ClubWarm({ if (fail) throw UnsatisfiedLinkError("no runtime") else Thing(opened.size).also { opened += it } }, sched, idleMs = 1_000)
    try {
      w.use { _, _ -> }
    } catch (_: UnsatisfiedLinkError) {
    }
    assertFalse(w.isOpen)
    assertTrue(sched.pending.isEmpty())
    fail = false
    try {
      w.use { _, _ -> throw IllegalStateException("frame") }
    } catch (_: IllegalStateException) {
    }
    assertTrue(w.isOpen)
    sched.advance(1_000)
    assertFalse(w.isOpen)
  }
}
