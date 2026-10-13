package expo.modules.golfswing

import android.graphics.Bitmap
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Low-resolution scrub proxies (plan D28): every [every]-th frame of the whole clip as a small
 * JPEG, `<dir>/<frame>.jpg`, written by pass 2 while it decodes anyway. The marking canvas shows
 * the nearest one under the finger while the golfer drags the whole-clip track, and swaps in the
 * full-resolution still on release. Pure JVM except [write], so the geometry is unit-tested.
 */
internal object Proxies {
  /** The short side of a proxy, px (a 9:16 portrait clip gives 160 × 284). */
  const val SHORT_SIDE = 160
  private const val JPEG_QUALITY = 70

  /**
   * The proxy frames of a clip of [n] frames: the multiples of [every] inside [range] (clamped to the
   * clip; null = the whole clip), so the JS finds one by rounding to [every]. None when [every] < 1.
   */
  fun frames(n: Int, every: Int, range: IntRange? = null): List<Int> {
    if (every < 1 || n < 1) return emptyList()
    val lo = (range?.first ?: 0).coerceIn(0, n - 1)
    val hi = (range?.last ?: (n - 1)).coerceIn(0, n - 1)
    if (lo > hi) return emptyList()
    val first = (lo + every - 1) / every * every
    return (first..hi step every).toList()
  }

  /** Proxy size for a display-oriented frame, short side [SHORT_SIDE], never larger than the frame. */
  fun size(dispW: Int, dispH: Int): Pair<Int, Int> {
    val s = min(1.0, SHORT_SIDE.toDouble() / max(1, min(dispW, dispH)))
    return Pair(max(1, (dispW * s).roundToInt()), max(1, (dispH * s).roundToInt()))
  }

  /** Display-oriented ARGB of [f] at proxy size (nearest neighbour: blurry by design, cheap). */
  fun pixels(f: YuvFrame): Triple<IntArray, Int, Int> {
    val (w, h) = size(f.dispW, f.dispH)
    val px = IntArray(w * h)
    f.toArgb(w, h, px)
    return Triple(px, w, h)
  }

  fun write(px: IntArray, w: Int, h: Int, file: File) {
    val bmp = Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
    try {
      FileOutputStream(file).use { bmp.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
    } finally {
      bmp.recycle()
    }
  }
}
