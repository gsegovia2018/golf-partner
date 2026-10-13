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

  /** The proxy frames of a clip of [n] frames: 0, every, 2·every, …; none when [every] < 1. */
  fun frames(n: Int, every: Int): List<Int> = if (every < 1 || n < 1) emptyList() else (0 until n step every).toList()

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
