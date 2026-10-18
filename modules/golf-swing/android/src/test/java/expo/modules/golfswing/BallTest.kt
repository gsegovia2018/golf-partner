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

  // ---- ballGoneFrame (apiVersion 6): the ball matched against its own picture

  /** 80 × 60 grass with the ball at (40, 30), r 3 (d 6 px); [cover] paints a club-grey block over it. */
  private fun scene(f: Int, ball: Boolean, cover: Boolean = false, dx: Int = 0): Gray {
    val g = frame(80, 60, if (ball) (40.0 + dx) to 30.0 else null, 3.0, seed = f % 3)
    if (cover) for (y in 26..36) for (x in 33..47) g.px[y * 80 + x] = 150.toByte()
    return g
  }

  @Test
  fun ballGoneIsTheFirstFrameOfALastingAbsence() {
    // fps 40: gone = absent for 4 frames
    val strips = (100..140).associateWith { scene(it, it < 121) }
    assertEquals(121, Ball.goneFrame(strips, 40.0, 30.0, 6.0, 100..110, 110, 40.0))
  }

  @Test
  fun aClubPassingInFrontOfTheBallIsNotItLeaving() {
    // covered at 115-116, back at 117-120, gone from 121
    val strips = (100..140).associateWith { scene(it, it < 121, cover = it in 115..116) }
    assertEquals(121, Ball.goneFrame(strips, 40.0, 30.0, 6.0, 100..110, 110, 40.0))
  }

  @Test
  fun aBallThatMovesOffItsSpotHasGone() {
    // the ball leaves its spot by 2 diameters (out of the ±0.4 d search) at 121
    val strips = (100..140).associateWith { scene(it, true, dx = if (it >= 121) 12 else 0) }
    assertEquals(121, Ball.goneFrame(strips, 40.0, 30.0, 6.0, 100..110, 110, 40.0))
  }

  @Test
  fun aReferenceOffTheBallIsRecentredAndABallThatStaysIsNeverGone() {
    // the ball reference one diameter off: the template is re-centred on the ball
    val gone = (100..140).associateWith { scene(it, it < 121) }
    assertEquals(121, Ball.goneFrame(gone, 45.0, 27.0, 6.0, 100..110, 110, 40.0))
    val stays = (100..140).associateWith { scene(it, true) }
    assertNull(Ball.goneFrame(stays, 40.0, 30.0, 6.0, 100..110, 110, 40.0))
    // an absence that runs out of strips before it lasts: not gone either
    val late = (100..140).associateWith { scene(it, it < 139) }
    assertNull(Ball.goneFrame(late, 40.0, 30.0, 6.0, 100..110, 110, 40.0))
  }

  @Test
  fun noGoneFrameWhenThePatchLeavesTheStrip() {
    val strips = (100..140).associateWith { scene(it, it < 121) }
    assertNull(Ball.goneFrame(strips, 8.0, 30.0, 6.0, 100..110, 110, 40.0))
    assertNull(Ball.goneFrame(strips, 40.0, 30.0, 6.0, 200..210, 110, 40.0)) // no template frames
  }

  @Test
  fun matchNeedsTheTemplatesContrast() {
    val tpl = doubleArrayOf(0.0, 100.0, 0.0, 100.0)
    // the same pattern at a fifth of the contrast correlates perfectly but does not count
    assertEquals(-2.0, Ball.match(doubleArrayOf(40.0, 60.0, 40.0, 60.0), 2, 2, tpl, 2, 2), 1e-12)
    assertEquals(1.0, Ball.match(doubleArrayOf(10.0, 90.0, 10.0, 90.0), 2, 2, tpl, 2, 2), 1e-12)
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
