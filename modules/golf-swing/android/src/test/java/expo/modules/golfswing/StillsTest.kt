package expo.modules.golfswing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StillsTest {
  // a 240 fps clip with a sync sample every 1 s
  private val syncs = longArrayOf(0, 1_000_000, 2_000_000, 3_000_000)

  @Test
  fun aFreshDecoderSeeksToTheSyncBeforeTheTarget() {
    assertEquals(1_000_000L, FramePlan.seekFor(1_500_000, FramePlan.NONE, syncs))
    assertEquals(0L, FramePlan.seekFor(10_000, FramePlan.NONE, syncs))
  }

  @Test
  fun aTargetAheadWithNoKeyframeBetweenDecodesOn() {
    assertNull(FramePlan.seekFor(1_600_000, 1_500_000, syncs))
    assertNull(FramePlan.seekFor(1_999_999, 1_000_000, syncs)) // the sync AT lastOut is behind us
  }

  @Test
  fun aKeyframeBetweenOrATargetBehindSeeks() {
    assertEquals(2_000_000L, FramePlan.seekFor(2_100_000, 1_500_000, syncs)) // skip 1.5 → 2.0 s
    assertEquals(1_000_000L, FramePlan.seekFor(1_400_000, 1_500_000, syncs)) // behind: back to its sync
    assertEquals(1_000_000L, FramePlan.seekFor(1_500_000, 1_500_000, syncs)) // the frame itself was passed
    assertEquals(3_000_000L, FramePlan.seekFor(3_100_000, FramePlan.AT_END, syncs)) // after the end of stream
  }

  @Test
  fun lastAtOrBeforeIsABinarySearch() {
    assertNull(FramePlan.lastAtOrBefore(syncs, -1))
    assertEquals(0L, FramePlan.lastAtOrBefore(syncs, 0))
    assertEquals(2_000_000L, FramePlan.lastAtOrBefore(syncs, 2_999_999))
    assertEquals(3_000_000L, FramePlan.lastAtOrBefore(syncs, Long.MAX_VALUE - 1))
    assertNull(FramePlan.lastAtOrBefore(LongArray(0), 5))
  }

  @Test
  fun theSampleTablesKeepTheLastFewClips() {
    val made = ArrayList<String>()
    val lru = Lru<String, Int>(2)
    fun get(k: String) = lru.getOrPut(k) { made += k; k.length }
    get("a"); get("b"); get("a"); get("c") // b is the least recently used
    assertEquals(setOf("a", "c"), lru.keys)
    get("a")
    assertEquals(listOf("a", "b", "c"), made) // a was never re-read
  }
}
