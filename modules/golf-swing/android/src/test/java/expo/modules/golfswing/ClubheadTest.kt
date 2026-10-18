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
import kotlin.math.max
import kotlin.math.min
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

  // ---- image-based address (apiVersion 6: the clubhead's track)

  /** A track standing still, then moving at [speeds] (frame → cm/s along x) from a frame on. */
  private fun trackOf(range: IntRange, fps: Double, speed: (Int) -> Double, score: (Int) -> Double = { 0.95 }): Map<Int, HeadPos> {
    val out = LinkedHashMap<Int, HeadPos>()
    var x = 0.0
    for (f in range) {
      x += speed(f) / fps
      out[f] = HeadPos(x, 0.0, score(f), false)
    }
    return out
  }

  @Test
  fun addressIsTheLastFrameBeforeTheHeadMovesBack() {
    // 100 fps: lag 4 frames, hold 10. Still to 100, then 30 cm/s: the backward speed is 7.5 cm/s
    // at 101 and 15 at 102, so 101 is the last "not moving" frame (a frame of latency at this speed)
    val t = trackOf(0..200, 100.0, { if (it > 100) 30.0 else 0.0 })
    assertEquals(101, ClubheadTrack.address(t, 10, 200, 100.0, clipStart = false))
  }

  @Test
  fun theSlowCreepCountsAndAShortPauseInsideItDoesNot() {
    // creep at 15 cm/s from 60, a 6-frame pause (< hold) at 90, faster from 110, gone at 150
    val t = trackOf(0..200, 100.0, {
      when {
        it <= 60 -> 0.0
        it in 90..95 -> 0.0
        it < 110 -> 15.0
        else -> 25.0
      }
    }, score = { if (it >= 150) 0.3 else 0.95 })
    val a = ClubheadTrack.address(t, 10, 200, 100.0, clipStart = false)!!
    assertTrue("address $a", a in 60..62)
  }

  @Test
  fun jitterBelowTheMovingSpeedIsStill() {
    // ±0.02 cm frame to frame (2 cm/s over the lag at most), then the takeaway
    val out = LinkedHashMap<Int, HeadPos>()
    for (f in 0..200) out[f] = HeadPos(if (f > 120) (f - 120) * 0.5 else if (f % 2 == 0) 0.02 else 0.0, 0.0, 0.95, false)
    assertEquals(120, ClubheadTrack.address(out, 0, 200, 100.0, clipStart = false))
  }

  @Test
  fun aTrackThatStartsMidCreepIsTheClipStartOnlyAtTheClipStart() {
    val t = trackOf(0..100, 100.0, { if (it < 80) 15.0 else 60.0 })
    assertEquals(4, ClubheadTrack.address(t, 0, 100, 100.0, clipStart = true)) // the first frame with a speed
    assertNull(ClubheadTrack.address(t, 0, 100, 100.0, clipStart = false))
  }

  @Test
  fun samplesSpreadOverTheWindowAndTheEarliestHeadAtTheBallWins() {
    assertEquals(listOf(100, 117, 133, 150, 167, 183), ClubheadTrack.samples(100, 200))
    val heads = mapOf(
      100 to null,
      117 to Triple(500.0, 500.0, 0.9), // far from the ball (a spare club)
      133 to Triple(110.0, 210.0, 0.2), // too weak
      150 to Triple(112.0, 212.0, 0.8),
      167 to Triple(111.0, 211.0, 0.9),
    )
    assertEquals(Triple(150, 112.0, 212.0), ClubheadTrack.restingHead(heads, 100.0, 200.0, 2.0))
    assertNull(ClubheadTrack.restingHead(mapOf(1 to null), 100.0, 200.0, 2.0))
  }

  @Test
  fun fallbackHeadSitsTowardTheGolferAndTheCamera() {
    // d = 4.27 × 2 = 8.54 px; hands left of the ball (right-hander filmed down the line)
    val (x, y) = ClubheadTrack.fallbackHead(100.0, 200.0, 40.0, 2.0)
    assertEquals(100 - 0.5 * 8.54, x, 1e-9)
    assertEquals(200 + 0.8 * 8.54, y, 1e-9)
    assertEquals(100 + 0.5 * 8.54, ClubheadTrack.fallbackHead(100.0, 200.0, 160.0, 2.0).first, 1e-9)
  }

  @Test
  fun stripIsSixDiametersSampledToEightPerDiameter() {
    // d = 4.27 × 5 = 21.35 px: half 128, step 2
    val (r, step) = ClubheadTrack.stripRect(500.0, 900.0, 5.0, 1080, 1920)
    assertEquals(Rect(372, 772, 629, 1029), r)
    assertEquals(2, step)
    assertEquals(Rect(0, 0, 78, 129), ClubheadTrack.stripRect(-51.0, 0.4, 5.0, 1080, 1920).first)
    assertEquals(1, ClubheadTrack.stripRect(500.0, 900.0, 1.5, 1080, 1920).second)
  }

  /** A textured strip with a fixed ball and a bright clubhead block at ([hx], [hy]) (sub-pixel by area). */
  private fun stripWith(hx: Double, hy: Double, seed: Long): Gray {
    val w = 120
    val h = 120
    val rnd = java.util.Random(seed)
    val px = ByteArray(w * h)
    for (y in 0 until h) for (x in 0 until w) {
      // static texture (the same in every frame) plus a little sensor noise
      var v = 80.0 + 20 * sin(x * 0.7) * cos(y * 0.45) + rnd.nextInt(3)
      if (hypot(x - 60.0, y - 60.0) <= 4.5) v = 230.0
      // the head: a 12 × 6 block, its edges covered by area for sub-pixel moves
      val cx = (min(x + 1.0, hx + 6) - max(x.toDouble(), hx - 6)).coerceIn(0.0, 1.0)
      val cy = (min(y + 1.0, hy + 3) - max(y.toDouble(), hy - 3)).coerceIn(0.0, 1.0)
      v = v * (1 - cx * cy) + 200 * cx * cy
      px[y * w + x] = v.toInt().coerceIn(0, 255).toByte()
    }
    return Gray(0, 0, w, h, px)
  }

  @Test
  fun trackFollowsTheHeadPastTheBallItRestsBeside() {
    // strip px = frame px (step 1), 2 px/cm: d = 8.5 px; the head rests below-left of the ball
    val strips = HashMap<Int, Gray>()
    for (f in 0..20) strips[f] = stripWith(54.0 + (if (f > 10) (f - 10) * 0.5 else 0.0), 67.0, f.toLong())
    val t = ClubheadTrack.track(strips, Pair(0, 0), 1, 0, 54.0, 67.0, 60.0, 60.0, 2.0)
    assertEquals(21, t.size)
    assertEquals(0.0, t.getValue(5).dx, 0.05)
    // 10 frames × 0.5 px = 5 px = 2.5 cm
    assertEquals(2.5, t.getValue(20).dx, 0.15)
    assertEquals(0.0, t.getValue(20).dy, 0.15)
    // the static texture inside the template lowers the score as the head moves off: still tracked
    assertTrue(t.values.all { it.score > ClubheadTrack.LOST_NCC && !it.edge })
    assertEquals(1.0, t.getValue(0).score, 1e-9)
  }

  @Test
  fun noTrackWhenTheSearchLeavesTheStrip() {
    val strips = mapOf(0 to stripWith(54.0, 67.0, 0))
    assertTrue(ClubheadTrack.track(strips, Pair(0, 0), 1, 0, 3.0, 67.0, 60.0, 60.0, 2.0).isEmpty())
    assertTrue(ClubheadTrack.track(strips, Pair(0, 0), 1, 7, 54.0, 67.0, 60.0, 60.0, 2.0).isEmpty()) // no strip at ref
  }

  @Test
  fun maskedNccIgnoresTheMaskedPixels() {
    // a window equal to the template except inside the "masked" pixels: a perfect match
    val rnd = java.util.Random(3)
    val g = Gray(0, 0, 5, 5, ByteArray(25) { (50 + rnd.nextInt(150)).toByte() })
    val idx = listOf(0, 1, 2, 4, 6, 8) // a 3-wide template without offsets 3, 5, 7
    val tpl = DoubleArray(idx.size) { k -> g.at(1 + idx[k] % 3, 1 + idx[k] / 3).toDouble() }
    g.px[2 * 5 + 1] = 0 // offset 3 at (1, 1): masked, so the match stays perfect
    val out = DoubleArray(9)
    ClubheadTrack.maskedNcc(g, 0, 0, 3, idx, tpl, 3, out)
    assertEquals(1.0, out[4], 1e-9)
    assertTrue(out.withIndex().all { (i, v) -> i == 4 || v < 0.99 })
  }
}
