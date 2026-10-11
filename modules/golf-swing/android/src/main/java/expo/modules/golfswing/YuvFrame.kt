package expo.modules.golfswing

import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * An owned copy of one decoded frame (planar I420: full-size Y, quarter-size U and V) in
 * the decoder's coded orientation, plus the container rotation. Everything downstream
 * works in DISPLAY orientation (what the user sees, what the lab's OpenCV decode gives):
 * [toRgb] and [grayStrip] rotate while they read. Pure JVM so it can be unit-tested.
 *
 * Colour: BT.601, limited range unless [fullRange] — what ffmpeg/OpenCV assume for an
 * untagged clip, so grey levels match the lab's `cv2.cvtColor(BGR2GRAY)`.
 */
/** Bytes per RGB row as MediaPipe lays out an SRGB ImageFrame (rows 4-byte aligned). */
internal fun rgbRowBytes(width: Int) = (width * 3 + 3) / 4 * 4

internal class YuvFrame(val codedW: Int, val codedH: Int, val rotation: Int, val fullRange: Boolean) {
  val cw = (codedW + 1) / 2
  val ch = (codedH + 1) / 2
  val y = ByteArray(codedW * codedH)
  val u = ByteArray(cw * ch)
  val v = ByteArray(cw * ch)
  var frame = -1
  var ptsUs = 0L

  val dispW = if (rotation == 90 || rotation == 270) codedH else codedW
  val dispH = if (rotation == 90 || rotation == 270) codedW else codedH

  /** Coded x for display (dx, dy): one of the two depends only on dx, the other only on dy. */
  fun codedX(dx: Int, dy: Int) = when (rotation) {
    90 -> dy
    180 -> codedW - 1 - dx
    270 -> codedW - 1 - dy
    else -> dx
  }

  fun codedY(dx: Int, dy: Int) = when (rotation) {
    90 -> codedH - 1 - dx
    180 -> codedH - 1 - dy
    270 -> dx
    else -> dy
  }

  /** Luma at a display pixel, as the lab's 8-bit grey (limited range expanded to 0–255). */
  fun gray(dx: Int, dy: Int): Int {
    val l = y[codedY(dx, dy) * codedW + codedX(dx, dy)].toInt() and 0xFF
    return if (fullRange) l else ((l - 16) * 255 / 219.0).roundToInt().coerceIn(0, 255)
  }

  /**
   * Display-oriented RGB (3 bytes per pixel) at [outW] × [outH], nearest-neighbour when
   * scaled down, written from position 0 of [dst] (a direct buffer of [rgbRowBytes]·outH
   * bytes: MediaPipe's RGB ImageFrame pads every row to a multiple of 4 bytes).
   */
  fun toRgb(outW: Int, outH: Int, dst: ByteBuffer) {
    // coded luma index = colTerm[ox] + rowTerm[oy] (rotation keeps each coded axis on one display axis)
    val yCol = IntArray(outW)
    val cCol = IntArray(outW)
    val yRow = IntArray(outH)
    val cRow = IntArray(outH)
    for (ox in 0 until outW) {
      val dx = ((ox + 0.5) * dispW / outW).toInt().coerceAtMost(dispW - 1)
      val (yi, ci) = indexTerms(dx, 0)
      yCol[ox] = yi
      cCol[ox] = ci
    }
    val (y0, c0) = indexTerms(0, 0)
    for (oy in 0 until outH) {
      val dy = ((oy + 0.5) * dispH / outH).toInt().coerceAtMost(dispH - 1)
      val (yi, ci) = indexTerms(0, dy)
      yRow[oy] = yi - y0
      cRow[oy] = ci - c0
    }
    val row = ByteArray(rgbRowBytes(outW))
    dst.position(0)
    for (oy in 0 until outH) {
      var k = 0
      for (ox in 0 until outW) {
        var l = (y[yCol[ox] + yRow[oy]].toInt() and 0xFF)
        val cu = (u[cCol[ox] + cRow[oy]].toInt() and 0xFF) - 128
        val cv = (v[cCol[ox] + cRow[oy]].toInt() and 0xFF) - 128
        val r: Int
        val g: Int
        val b: Int
        if (fullRange) {
          // BT.601 full range, ×1024 fixed point
          l = l shl 10
          r = (l + 1436 * cv) shr 10
          g = (l - 352 * cu - 731 * cv) shr 10
          b = (l + 1815 * cu) shr 10
        } else {
          l = 1192 * max(0, l - 16)
          r = (l + 1634 * cv) shr 10
          g = (l - 401 * cu - 833 * cv) shr 10
          b = (l + 2066 * cu) shr 10
        }
        row[k++] = r.coerceIn(0, 255).toByte()
        row[k++] = g.coerceIn(0, 255).toByte()
        row[k++] = b.coerceIn(0, 255).toByte()
      }
      dst.put(row)
    }
    dst.position(0)
  }

  /** (luma index, chroma index) of display pixel (dx, dy). */
  private fun indexTerms(dx: Int, dy: Int): Pair<Int, Int> {
    val cx = codedX(dx, dy)
    val cy = codedY(dx, dy)
    return Pair(cy * codedW + cx, (cy / 2) * cw + cx / 2)
  }

  /**
   * Grey patch of the working image over [r] (work px). Work scale 0.5 averages 2 × 2 display
   * pixels with rounding (cv2.resize INTER_AREA at an exact factor 2); 1.0 is the pixel itself.
   */
  fun grayStrip(r: Rect, half: Boolean): Gray {
    val out = ByteArray(r.w * r.h)
    var k = 0
    for (wy in r.y0 until r.y1) for (wx in r.x0 until r.x1) {
      out[k++] = if (half) {
        val dx = (2 * wx).coerceAtMost(dispW - 2)
        val dy = (2 * wy).coerceAtMost(dispH - 2)
        ((gray(dx, dy) + gray(dx + 1, dy) + gray(dx, dy + 1) + gray(dx + 1, dy + 1) + 2) / 4).toByte()
      } else {
        gray(wx, wy).toByte()
      }
    }
    return Gray(r.x0, r.y0, r.w, r.h, out)
  }
}
