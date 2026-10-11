package expo.modules.golfswing

import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.ByteBuffer

class GripAndFrameTest {
  private fun sample(frame: Int, lWr: Pt, lEl: Pt, lVis: Float, rWr: Pt, rEl: Pt, rVis: Float): PoseSample {
    val lm = FloatArray(Lm.COUNT * 3) { if (it % 3 == 2) 1f else 0f }
    fun set(j: Int, p: Pt, v: Float) {
      lm[3 * j] = p.x
      lm[3 * j + 1] = p.y
      lm[3 * j + 2] = v
    }
    set(Lm.L_WR, lWr, lVis)
    set(Lm.L_EL, lEl, 1f)
    set(Lm.R_WR, rWr, rVis)
    set(Lm.R_EL, rEl, 1f)
    return PoseSample(frame, 0, lm)
  }

  @Test
  fun gripIsWristPlusPointThreeFiveForearm() {
    val s = sample(0, Pt(100f, 200f), Pt(100f, 100f), 1f, Pt(120f, 200f), Pt(120f, 100f), 1f)
    val g = Grip.point(s)
    assertEquals(110f, g.x, 1e-4f)
    assertEquals(235f, g.y, 1e-4f)
  }

  @Test
  fun aHiddenWristIsDroppedWhenTheOtherIsVisible() {
    val s = sample(0, Pt(100f, 200f), Pt(100f, 100f), 0.2f, Pt(140f, 200f), Pt(140f, 100f), 0.9f)
    assertEquals(140f, Grip.point(s).x, 1e-4f)
  }

  @Test
  fun gatedSeriesRejectsAJumpOfAHiddenWristAndInterpolates() {
    val ok = { f: Int -> sample(f, Pt(100f, 200f), Pt(100f, 100f), 0.3f, Pt(100f, 200f), Pt(100f, 100f), 0.3f) }
    // frame 1: both wrists hidden and 200 px away (> 1.5 forearm): rejected, interpolated
    val bad = sample(1, Pt(300f, 200f), Pt(300f, 100f), 0.2f, Pt(300f, 200f), Pt(300f, 100f), 0.2f)
    val g = Grip.gatedSeries(listOf(ok(0), bad, ok(2)))
    assertEquals(100f, g[1].x, 1e-4f)
    assertEquals(235f, g[1].y, 1e-4f)
  }

  @Test
  fun duplicateRatioSpotsFrameDoubling() {
    val doubled = FloatArray(80) { if (it % 2 == 0) 6f else 0.1f }
    assertEquals(0.5, Probe.duplicateRatio(doubled), 1e-9)
    assertEquals(0.0, Probe.duplicateRatio(FloatArray(80) { 5f + it % 3 }), 1e-9)
    assertEquals(0.0, Probe.duplicateRatio(FloatArray(80) { 0.1f }), 1e-9)
  }

  /** 4 × 2 coded frame, luma = 10·x + y + 16 (limited range), rotated by 90° for display. */
  @Test
  fun rotationMapsDisplayPixelsToCodedPixels() {
    val f = YuvFrame(4, 2, 90, fullRange = true)
    for (y in 0 until 2) for (x in 0 until 4) f.y[y * 4 + x] = (10 * x + y).toByte()
    assertEquals(2, f.dispW)
    assertEquals(4, f.dispH)
    // clockwise 90°: display (0, 0) is coded (0, H-1) — the bottom-left corner
    assertEquals(1, f.gray(0, 0))
    assertEquals(0, f.gray(1, 0))
    assertEquals(31, f.gray(0, 3))
    val strip = f.grayStrip(Rect(0, 0, 2, 4), half = false)
    assertEquals(31, strip.at(0, 3))
  }

  @Test
  fun rgbOfNeutralGreyIsGrey() {
    val f = YuvFrame(2, 2, 0, fullRange = false)
    f.y.fill(126.toByte())
    f.u.fill(128.toByte())
    f.v.fill(128.toByte())
    assertEquals(8, rgbRowBytes(2))
    val buf = ByteBuffer.allocateDirect(rgbRowBytes(2) * 2)
    f.toRgb(2, 2, buf)
    // (126 - 16) × 255 / 219 = 128; each 6-byte row is padded to 8
    for (row in 0 until 2) for (i in 0 until 6) assertEquals(128, buf.get(row * 8 + i).toInt() and 0xFF)
  }
}
