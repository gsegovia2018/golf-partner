package expo.modules.golfswing

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

class ClubheadTest {
  /** Grass-like grey: 100 plus seeded, isotropic noise of 0-8 grey levels. */
  private fun grass(w: Int, h: Int, seed: Long = 1): Gray {
    val rnd = java.util.Random(seed)
    return Gray(0, 0, w, h, ByteArray(w * h) { (100 + rnd.nextInt(9)).toByte() })
  }

  /** A dark 2 px shaft from (hx, hy) at [deg] for [len] px, ending in a darker clubhead blob. */
  private fun drawShaft(g: Gray, hx: Double, hy: Double, deg: Double, len: Double, headR: Double = 3.0) {
    val dx = cos(Math.toRadians(deg))
    val dy = sin(Math.toRadians(deg))
    for (y in 0 until g.h) for (x in 0 until g.w) {
      val rx = x - hx
      val ry = y - hy
      val along = rx * dx + ry * dy
      val across = abs(-rx * dy + ry * dx)
      if (along in 0.0..len && across <= 1.0) g.px[y * g.w + x] = 30
      if (hypot(x - (hx + dx * len), y - (hy + dy * len)) <= headR) g.px[y * g.w + x] = 10
    }
  }

  @Test
  fun findsADrawnShaftAngleLengthAndHeadFromTheHandsToBallSeed() {
    val g = grass(240, 240)
    drawShaft(g, 60.0, 50.0, 60.0, 110.0)
    val s = ShaftSearch.search(g, 240, 240, 60.0, 50.0, 120.0, 6.0, 55.0)
    assertEquals(60.0, s.angleDeg.toDouble(), 2.0)
    assertEquals(110.0, s.lengthPx, 0.05 * 110)
    assertFalse(s.hidden)
    assertTrue("conf ${s.conf}", s.conf > 0.35)
    val ex = 60.0 + cos(Math.toRadians(60.0)) * 110
    val ey = 50.0 + sin(Math.toRadians(60.0)) * 110
    assertTrue("head ${s.headX},${s.headY}", hypot(s.headX - ex, s.headY - ey) <= 4.0)
  }

  @Test
  fun theSeedWindowIsHonouredOverAStrongerLineElsewhere() {
    val g = grass(240, 240)
    drawShaft(g, 120.0, 60.0, 60.0, 100.0)
    drawShaft(g, 120.0, 60.0, 150.0, 110.0)
    val s = ShaftSearch.search(g, 240, 240, 120.0, 60.0, 120.0, 6.0, 55.0)
    assertEquals(60.0, s.angleDeg.toDouble(), 2.0)
  }

  @Test
  fun noEdgesMeansHidden() {
    val g = Gray(0, 0, 240, 240, ByteArray(240 * 240) { 100 })
    val s = ShaftSearch.search(g, 240, 240, 120.0, 120.0, 100.0, 6.0, 60.0)
    assertTrue(s.hidden)
    assertEquals(0.0, s.conf, 0.0)
  }

  @Test
  fun aShaftEndOnToTheCameraIsHidden() {
    // the visible shaft is far shorter than 0.3 × expected (takeaway, transition)
    val g = grass(240, 240)
    drawShaft(g, 120.0, 120.0, 60.0, 18.0, headR = 0.0)
    val s = ShaftSearch.search(g, 240, 240, 120.0, 120.0, 100.0, 6.0, 60.0)
    assertTrue("length ${s.lengthPx}", s.hidden)
  }

  @Test
  fun aPatchClippedToTheImageReadsZeroOutsideLikeRemap() {
    // hands near the right edge: rays leaving the image must not throw and the shaft is still found
    val full = grass(200, 200)
    drawShaft(full, 180.0, 40.0, 120.0, 90.0)
    val half = ShaftSearch.patchHalf(100.0, 6.0)
    val r = Rect(maxOf(0, 180 - half), maxOf(0, 40 - half), minOf(200, 180 + half + 1), minOf(200, 40 + half + 1))
    val px = ByteArray(r.w * r.h)
    for (y in 0 until r.h) for (x in 0 until r.w) px[y * r.w + x] = full.px[(y + r.y0) * 200 + x + r.x0]
    val s = ShaftSearch.search(Gray(r.x0, r.y0, r.w, r.h, px), 200, 200, 180.0, 40.0, 100.0, 6.0, 115.0)
    assertEquals(120.0, s.angleDeg.toDouble(), 2.0)
    assertEquals(90.0, s.lengthPx, 0.05 * 90)
  }

  @Test
  fun boxSameMatchesNumpyConvolveSame() {
    val v = floatArrayOf(1f, 5f, 2f, 8f, 3f, 9f, 4f, 0f, 6f, 7f)
    // numpy.convolve(v, ones(n) / n, "same") for n = 3 and n = 4
    val n3 = doubleArrayOf(2.0, 2.666667, 5.0, 4.333333, 6.666667, 5.333333, 4.333333, 3.333333, 4.333333, 4.333333)
    val n4 = doubleArrayOf(1.5, 2.0, 4.0, 4.5, 5.5, 6.0, 4.0, 4.75, 4.25, 3.25)
    assertArrayEquals(n3, ShaftSearch.boxSame(v, 3), 1e-5)
    assertArrayEquals(n4, ShaftSearch.boxSame(v, 4), 1e-5)
  }

  @Test
  fun reflect101() {
    assertEquals(1, ShaftSearch.reflect(-1, 5))
    assertEquals(3, ShaftSearch.reflect(5, 5))
    assertEquals(0, ShaftSearch.reflect(-1, 1))
  }

  // ---- image-based address (clubhead onset)

  /** A 6×6 patch per frame; [level] shifts every pixel, so the frame-to-frame signal = |Δlevel|. */
  private fun patches(levels: Map<Int, Int>): Map<Int, Gray> =
    levels.mapValues { (_, l) -> Gray(0, 0, 6, 6, ByteArray(36) { (100 + l).toByte() }) }

  @Test
  fun onsetIsTheLastSustainedRunBeforeLatestMinusOne() {
    val lv = HashMap<Int, Int>()
    // quiet window (lead arm -> top): alternating 0/1 => noise ceiling 1
    for (f in 499..520) lv[f] = f % 2
    // the address run: a short waggle at 105-106 (2 samples), still, then the takeaway from 130
    var level = 0
    for (f in 99..170) {
      if (f in 105..106 || f >= 130) level += 6
      lv[f] = level
    }
    val p = patches(lv)
    assertEquals(129, ClubheadOnset.detect(p, 100..170, 150, 500..520, 5))
    // a waggle long enough counts, but only the LAST qualifying run wins
    for (f in 105..112) lv[f] = (lv[f - 1] ?: 0) + 6
    assertEquals(129, ClubheadOnset.detect(patches(lv), 100..170, 150, 500..520, 5))
    // a run that starts after `latest` is not the onset: the waggle is
    assertEquals(104, ClubheadOnset.detect(patches(lv), 100..170, 120, 500..520, 5))
  }

  @Test
  fun noQuietWindowOrNoRunMeansNoOnset() {
    val lv = HashMap<Int, Int>()
    for (f in 99..170) lv[f] = 0
    assertNull(ClubheadOnset.detect(patches(lv), 100..170, 150, 500..520, 5))
    for (f in 499..520) lv[f] = f % 2
    assertNull(ClubheadOnset.detect(patches(lv), 100..170, 150, 500..520, 5))
  }

  @Test
  fun onsetPatchIsOnePointFiveBallDiametersClippedLikeANumpySlice() {
    // 1.5 × 4.27 cm × 2 px/cm = 12.8 → 13 px half
    assertEquals(Rect(87, 187, 114, 214), ClubheadOnset.patchRect(100.0, 200.0, 2.0, 640, 480))
    assertEquals(Rect(0, 0, 10, 15), ClubheadOnset.patchRect(-4.0, 0.6, 2.0, 640, 480))
  }
}
