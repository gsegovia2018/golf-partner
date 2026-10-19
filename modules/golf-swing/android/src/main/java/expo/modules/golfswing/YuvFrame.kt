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

/** Packed output pixels for [YuvFrame.toRgb]/[YuvFrame.toRgba], one per converting thread. */
private class Scratch(val bytes: ByteArray, val channels: Int)

private val scratch = ThreadLocal<Scratch>()

private fun scratchFor(size: Int, channels: Int): ByteArray {
  scratch.get()?.let { if (it.bytes.size == size && it.channels == channels) return it.bytes }
  // RGBA: alpha is written once here; the converter only writes R, G, B
  val bytes = ByteArray(size).also { if (channels == 4) it.fill(-1) }
  scratch.set(Scratch(bytes, channels))
  return bytes
}

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
  fun toRgb(outW: Int, outH: Int, dst: ByteBuffer) = toPixels(outW, outH, dst, 3)

  private fun toPixels(outW: Int, outH: Int, dst: ByteBuffer, channels: Int, bands: BandRunner? = null) {
    val t = Tables(outW, outH)
    val rowBytes = if (channels == 3) rgbRowBytes(outW) else 4 * outW
    val size = rowBytes * outH
    val out = scratchFor(size, channels)
    val c = Colour.of(fullRange)
    val run = { y0: Int, y1: Int ->
      for (oy in y0 until y1) {
        val yr = t.yRow[oy]
        val cr = t.cRow[oy]
        var k = oy * rowBytes
        for (ox in 0 until outW) {
          val l = c.y[y[t.yCol[ox] + yr].toInt() and 0xFF]
          val ci = t.cCol[ox] + cr
          val cu = u[ci].toInt() and 0xFF
          val cv = v[ci].toInt() and 0xFF
          out[k] = c.clip[((l + c.rv[cv]) shr 10) + Colour.CLIP_OFFSET]
          out[k + 1] = c.clip[((l + c.gu[cu] + c.gv[cv]) shr 10) + Colour.CLIP_OFFSET]
          out[k + 2] = c.clip[((l + c.bu[cu]) shr 10) + Colour.CLIP_OFFSET]
          k += channels
        }
      }
    }
    if (bands == null) run(0, outH) else bands.run(outH, run)
    dst.position(0)
    dst.put(out, 0, size)
    dst.position(0)
  }

  /**
   * Display-oriented RGBA (alpha 255), rows packed: MediaPipe's SRGBA ImageFrame layout.
   * [bands] splits the rows over threads.
   */
  fun toRgba(outW: Int, outH: Int, dst: ByteBuffer, bands: BandRunner? = null) = toPixels(outW, outH, dst, 4, bands)

  /** Display-oriented opaque ARGB colour ints (Bitmap.createBitmap / setPixels). */
  fun toArgb(outW: Int, outH: Int, dst: IntArray) {
    val t = Tables(outW, outH)
    val c = Colour.of(fullRange)
    for (oy in 0 until outH) {
      val o = oy * outW
      for (ox in 0 until outW) {
        val l = c.y[y[t.yCol[ox] + t.yRow[oy]].toInt() and 0xFF]
        val ci = t.cCol[ox] + t.cRow[oy]
        val cu = u[ci].toInt() and 0xFF
        val cv = v[ci].toInt() and 0xFF
        val r = c.clip[((l + c.rv[cv]) shr 10) + Colour.CLIP_OFFSET].toInt() and 0xFF
        val g = c.clip[((l + c.gu[cu] + c.gv[cv]) shr 10) + Colour.CLIP_OFFSET].toInt() and 0xFF
        val b = c.clip[((l + c.bu[cu]) shr 10) + Colour.CLIP_OFFSET].toInt() and 0xFF
        dst[o + ox] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
      }
    }
  }

  private inner class Tables(val outW: Int, val outH: Int) {
    // coded luma index = colTerm[ox] + rowTerm[oy] (rotation keeps each coded axis on one display axis)
    val yCol = IntArray(outW)
    val cCol = IntArray(outW)
    val yRow = IntArray(outH)
    val cRow = IntArray(outH)

    init {
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
    }
  }

  /** (luma index, chroma index) of display pixel (dx, dy). */
  private fun indexTerms(dx: Int, dy: Int): Pair<Int, Int> {
    val cx = codedX(dx, dy)
    val cy = codedY(dx, dy)
    return Pair(cy * codedW + cx, (cy / 2) * cw + cx / 2)
  }

  /**
   * Grey patch of the working image over [r] (work px). [step] = frame px per work px: 2
   * averages 2 × 2 pixels with rounding (cv2.resize INTER_AREA at an exact factor 2), 1 is
   * the pixel itself.
   */
  fun grayStrip(r: Rect, step: Int): Gray {
    val out = ByteArray(r.w * r.h)
    var k = 0
    for (wy in r.y0 until r.y1) for (wx in r.x0 until r.x1) {
      out[k++] = if (step == 2) {
        val dx = (2 * wx).coerceAtMost(dispW - 2)
        val dy = (2 * wy).coerceAtMost(dispH - 2)
        ((gray(dx, dy) + gray(dx + 1, dy) + gray(dx, dy + 1) + gray(dx + 1, dy + 1) + 2) / 4).toByte()
      } else {
        gray(wx.coerceAtMost(dispW - 1), wy.coerceAtMost(dispH - 1)).toByte()
      }
    }
    return Gray(r.x0, r.y0, r.w, r.h, out)
  }

  /**
   * Grey of every [step]-th pixel of [r] (frame px), like numpy's `g[y0:y1:step, x0:x1:step]`:
   * `Gray(0, 0, …)` in sample units ([ClubheadTrack]'s address strips).
   */
  fun graySampled(r: Rect, step: Int): Gray {
    val nx = (r.w + step - 1) / step
    val ny = (r.h + step - 1) / step
    val out = ByteArray(nx * ny)
    var k = 0
    for (j in 0 until ny) for (i in 0 until nx) {
      out[k++] = gray((r.x0 + i * step).coerceAtMost(dispW - 1), (r.y0 + j * step).coerceAtMost(dispH - 1)).toByte()
    }
    return Gray(0, 0, nx, ny, out)
  }
}

/**
 * BT.601 YUV → RGB as lookup tables (×1024 fixed point): R = clip((Y' + rv[V]) >> 10),
 * G = clip((Y' + gu[U] + gv[V]) >> 10), B = clip((Y' + bu[U]) >> 10). Limited range
 * expands Y 16–235 and UV 16–240; full range uses them as they are.
 */
internal class Colour private constructor(full: Boolean) {
  val y = IntArray(256) { if (full) it shl 10 else 1192 * max(0, it - 16) }
  val rv = IntArray(256) { (if (full) 1436 else 1634) * (it - 128) }
  val gu = IntArray(256) { -(if (full) 352 else 401) * (it - 128) }
  val gv = IntArray(256) { -(if (full) 731 else 833) * (it - 128) }
  val bu = IntArray(256) { (if (full) 1815 else 2066) * (it - 128) }
  val clip = ByteArray(2 * CLIP_OFFSET) { (it - CLIP_OFFSET).coerceIn(0, 255).toByte() }

  companion object {
    const val CLIP_OFFSET = 512
    private val FULL = Colour(true)
    private val LIMITED = Colour(false)
    fun of(full: Boolean) = if (full) FULL else LIMITED
  }
}

/**
 * Splits rows [0, n) into bands run in parallel (the calling thread takes one). [onThread]
 * gets each pool thread's id as it starts (at raised priority).
 */
internal class BandRunner(private val threads: Int, private val onThread: (Int) -> Unit = {}) {
  private val pool = java.util.concurrent.Executors.newFixedThreadPool(max(1, threads - 1)) { r ->
    Thread({
      PerfHint.raiseThisThread()
      PerfHint.myTid()?.let(onThread)
      r.run()
    }, "golf-swing-convert").apply { isDaemon = true }
  }

  fun run(n: Int, work: (Int, Int) -> Unit) {
    val per = (n + threads - 1) / threads
    val futures = (1 until threads).mapNotNull { b ->
      val y0 = b * per
      val y1 = minOf(n, y0 + per)
      if (y0 < y1) pool.submit { work(y0, y1) } else null
    }
    work(0, minOf(n, per))
    for (f in futures) {
      try {
        f.get()
      } catch (e: java.util.concurrent.ExecutionException) {
        throw e.cause ?: e
      }
    }
  }

  fun shutdown() {
    pool.shutdownNow()
  }
}
