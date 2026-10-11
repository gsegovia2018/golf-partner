package expo.modules.golfswing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.math.hypot

class BallTest {
  /** Grass-like grey with a mild deterministic texture and an optional white disc. */
  private fun frame(w: Int, h: Int, ball: Pair<Double, Double>?, r: Double, seed: Int = 0): Gray {
    val px = ByteArray(w * h)
    for (y in 0 until h) for (x in 0 until w) {
      var v = 90 + ((x * 7 + y * 13 + seed * 5) % 11)
      if (ball != null && hypot(x - ball.first, y - ball.second) <= r) v = 235
      px[y * w + x] = v.toByte()
    }
    return Gray(0, 0, w, h, px)
  }

  @Test
  fun findsTheBallBlobNearTheShaftRay() {
    val roi = Rect(0, 0, 120, 60)
    val g = frame(120, 60, 80.0 to 40.0, 3.0)
    // a bright decoy of the wrong size far from the ray (just below the ball's grey, so both pass the 98th percentile)
    for (y in 5..20) for (x in 5..20) g.px[y * 120 + x] = 230.toByte()
    val b = Ball.detect(listOf(g, g, g), roi, Pt(40f, 0f), 1, 6.0, 1.0)
    assertNotNull(b)
    assertEquals(80.0, b!!.x, 0.6)
    assertEquals(40.0, b.y, 0.6)
    assertEquals(3.0, b.r, 1e-9)
  }

  @Test
  fun noBlobOfTheExpectedSizeMeansNoBall() {
    val g = frame(120, 60, 80.0 to 40.0, 12.0)
    assertNull(Ball.detect(listOf(g), Rect(0, 0, 120, 60), Pt(40f, 0f), 1, 6.0, 1.0))
  }

  @Test
  fun percentileMatchesNumpy() {
    // numpy.percentile(range(100), 98) == 97.02
    assertEquals(97.02, Ball.percentile98(IntArray(100) { it }), 1e-9)
  }

  @Test
  fun ballGoneIsTheFirstFrameWhoseFootprintChangesAfterTheQuietWindow() {
    val strips = HashMap<Int, Gray>()
    for (f in 100..130) strips[f] = frame(60, 40, if (f < 121) 30.0 to 20.0 else null, 3.0, seed = f % 2)
    val gone = Ball.goneFrame(strips, 30.0, 20.0, 6.0, 101..110, 110)
    assertEquals(121, gone)
  }

  @Test
  fun pxPerCmFromTheTrailLeg() {
    val lm = FloatArray(Lm.COUNT * 3)
    fun set(j: Int, x: Float, y: Float) {
      lm[3 * j] = x
      lm[3 * j + 1] = y
      lm[3 * j + 2] = 1f
    }
    set(Lm.R_HIP, 100f, 100f)
    set(Lm.R_KNEE, 100f, 150f)
    set(Lm.R_ANK, 100f, 200f)
    // leg 100 px = 0.49 × 176 cm → 1.1596 px/cm
    assertEquals(100 / (0.49 * 176), Ball.pxPerCm(listOf(PoseSample(0, 0, lm)), true, 176.0), 1e-4)
  }
}
