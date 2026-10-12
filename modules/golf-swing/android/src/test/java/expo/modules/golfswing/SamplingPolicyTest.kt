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
  fun sparseThenEveryFourthThenDenseFromTheTopThenEverySecondThenSparse() {
    val p = SamplingPolicy(240.0)
    val events = run(p, 1000, ::swing)
    val trigger = events.first { it.second is SamplingPolicy.Event.Trigger }
    assertTrue("trigger within one 16-stride of motion start: ${trigger.first}", trigger.first in 400..416)
    assertEquals(trigger.first - 12, (trigger.second as SamplingPolicy.Event.Trigger).from)
    val top = events.first { it.second is SamplingPolicy.Event.Top }
    // the grip turns at 480; seen once it is 3σ√2 below its top, on the 4-stride
    assertTrue("top seen just after 480: ${top.first}", top.first in 481..492)
    assertEquals(top.first - 20, (top.second as SamplingPolicy.Event.Top).from)
    val impact = events.first { it.second is SamplingPolicy.Event.Impact }.second as SamplingPolicy.Event.Impact
    assertTrue("impact at the bottom of the descent: ${impact.frame}", impact.frame in 555..565)
    val done = events.first { it.second is SamplingPolicy.Event.Done }.first
    assertTrue("follow zone ends once still: $done", done in 650..720)
    assertEquals(SamplingPolicy.Zone.DONE, p.zone)
    assertEquals(listOf("Trigger", "Top", "Impact", "Done"), events.map { it.second::class.simpleName })
  }

  @Test
  fun stridesPerZone() {
    val p = SamplingPolicy(240.0)
    val seen = ArrayList<Int>()
    var done = -1
    for (i in 0 until 1000) {
      if (!p.wants(i)) continue
      seen.add(i)
      val (x, y) = swing(i)
      if (p.observe(obs(i, x, y)) is SamplingPolicy.Event.Done) done = i
    }
    fun gaps(a: Int, b: Int) = seen.filter { it in a..b }.zipWithNext { u, v -> v - u }.toSet()
    val impact = p.impactFrame
    assertTrue(done > impact)
    assertEquals(setOf(16), gaps(0, p.triggerFrame))
    assertEquals(setOf(4), gaps(p.triggerFrame, p.topSeenFrame))
    assertEquals(setOf(1), gaps(p.topSeenFrame, impact + 6))
    assertEquals(setOf(2), gaps(impact + 6, done))
    assertEquals(setOf(16), gaps(done, 999))
    // the back-fills (trigger: 3 frames, top: 19) come on top of these
    assertTrue("inferences ${seen.size}", seen.size in 150..230)
  }

  @Test
  fun wantsFollowsTheZone() {
    val p = SamplingPolicy(240.0)
    assertTrue(p.wants(0))
    assertFalse(p.wants(8))
    assertTrue(p.wants(16))
    run(p, 450, ::swing)
    assertEquals(SamplingPolicy.Zone.BACKSWING, p.zone)
    val t = p.triggerFrame
    assertTrue(p.wants(t + 52))
    assertFalse(p.wants(t + 53))
    run(p, 500, ::swing)
    assertEquals(SamplingPolicy.Zone.DOWNSWING, p.zone)
    assertTrue((501..520).all { p.wants(it) })
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
    // first 4-stride sample more than 3 s (720 frames) after the trigger
    assertEquals(trigger + 724, capped)
    assertEquals(-1, p.impactFrame)
    assertFalse(events.any { it.second is SamplingPolicy.Event.Impact || it.second is SamplingPolicy.Event.Top })
    assertTrue(p.zone == SamplingPolicy.Zone.FOLLOW || p.zone == SamplingPolicy.Zone.DONE)
  }
}
