package expo.modules.golfswing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.sin

class SamplingPolicyTest {
  private val bodyH = 400f

  /** Deterministic ±0.6 px jitter around a point. */
  private fun jitter(i: Int) = 0.6f * sin(i * 2.3f)

  private fun obs(i: Int, gx: Float, gy: Float) =
    SamplingPolicy.Obs(i, Pt(gx + jitter(i), gy + jitter(i + 7)), Pt(200f + jitter(i + 3), 100f + jitter(i + 5)), bodyH)

  /** Drives the policy like the analyzer: only wanted frames are observed; back-fill is the caller's job. */
  private fun run(p: SamplingPolicy, frames: Int, grip: (Int) -> Pair<Float, Float>): List<Pair<Int, SamplingPolicy.Event>> {
    val events = ArrayList<Pair<Int, SamplingPolicy.Event>>()
    for (i in 0 until frames) {
      if (!p.wants(i)) continue
      val (x, y) = grip(i)
      val e = p.observe(obs(i, x, y))
      if (e != SamplingPolicy.Event.None) events.add(i to e)
    }
    return events
  }

  /** Still until 400, backswing up 150 px by 480, downswing to 560, follow-through up, still from 650. */
  private fun swing(i: Int): Pair<Float, Float> = when {
    i < 400 -> 300f to 600f
    i < 480 -> 300f - (i - 400) * 0.3f to 600f - (i - 400) * 150f / 80
    i < 560 -> 276f + (i - 480) * 0.3f to 450f + (i - 480) * 150f / 80
    i < 650 -> 300f - (i - 560) * 0.5f to 600f - (i - 560) * 200f / 90
    else -> 255f to 400f
  }

  @Test
  fun sparseUntilMotionThenDenseUntilImpactThenEverySecond() {
    val p = SamplingPolicy(240.0)
    val events = run(p, 1000, ::swing)
    val trigger = events.first { it.second is SamplingPolicy.Event.Trigger }.first
    assertTrue("trigger within one sparse step of motion start: $trigger", trigger in 400..416)
    val impact = events.first { it.second is SamplingPolicy.Event.Impact }.second as SamplingPolicy.Event.Impact
    assertTrue("impact at the bottom of the descent: ${impact.frame}", impact.frame in 555..565)
    val done = events.first { it.second is SamplingPolicy.Event.Done }.first
    assertTrue("after-impact zone ends once still: $done", done in 650..720)
    assertEquals(SamplingPolicy.Zone.DONE, p.zone)
  }

  @Test
  fun wantsFollowsTheZone() {
    val p = SamplingPolicy(240.0)
    assertTrue(p.wants(0))
    assertFalse(p.wants(3))
    assertTrue(p.wants(8))
    run(p, 450, ::swing)
    assertEquals(SamplingPolicy.Zone.SWING, p.zone)
    assertTrue((451..459).all { p.wants(it) })
  }

  @Test
  fun aWaggleWithoutRiseFallsBackToSparse() {
    val p = SamplingPolicy(240.0)
    // a 12 px forward press at 300, then still again
    val events = run(p, 500) { i -> if (i < 300) 300f to 600f else 288f to 600f }
    assertTrue(events.any { it.second is SamplingPolicy.Event.Trigger })
    assertTrue(events.any { it.second is SamplingPolicy.Event.Reset })
    assertEquals(SamplingPolicy.Zone.STILL, p.zone)
  }

  @Test
  fun aSlowDriftAtAddressDoesNotTrigger() {
    val p = SamplingPolicy(240.0)
    // 5 px over the first 120 frames, like the lab clip's address
    val events = run(p, 390) { i -> 300f + 5f * minOf(i, 120) / 120 to 600f }
    assertTrue(events.toString(), events.isEmpty())
  }

  @Test
  fun theDenseZoneIsCappedAtThreeSecondsWithoutAnImpact() {
    val p = SamplingPolicy(240.0)
    // backswing to the top at 480, then the hands stay up for good (no downswing)
    val events = run(p, 2000) { i -> if (i < 400) 300f to 600f else 300f to 600f - minOf(i - 400, 80) * 150f / 80 }
    val trigger = events.first { it.second is SamplingPolicy.Event.Trigger }.first
    val capped = events.first { it.second is SamplingPolicy.Event.DenseCapped }.first
    assertEquals(trigger + 721, capped)
    assertEquals(-1, p.impactFrame)
    assertFalse(events.any { it.second is SamplingPolicy.Event.Impact })
    assertTrue(p.zone == SamplingPolicy.Zone.AFTER_IMPACT || p.zone == SamplingPolicy.Zone.DONE)
  }
}
