package expo.modules.golfswing

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * One radial shaft search (plan §4.3), ported from tools/swing-lab/detect.py `ShaftSearch`
 * (d15). v1 (D16) runs it only at address and impact, seeded with the hands → ball direction.
 * Everything is in working-image px. Pure JVM so it can be unit-tested.
 */
internal data class ShaftFound(
  val angleDeg: Int,
  val lengthPx: Double,
  val ratio: Double,
  val endX: Double,
  val endY: Double,
  val headX: Double,
  val headY: Double,
  val hidden: Boolean,
  val conf: Double,
)

internal object ShaftSearch {
  private const val HALF_WIDTH_DEG = 15
  private const val LENGTH_DROP = 0.35
  private const val HIDDEN_RATIO = 2.5
  private const val HIDDEN_LENGTH = 0.3

  /** Half size of the patch [search] reads around the hands: the rays, the blob window, Sobel and bilinear margins. */
  fun patchHalf(exp: Double, ballD: Double) = ceil(exp).toInt() + blobHalf(ballD) + 4

  private fun blobHalf(ballD: Double) = max(2, Math.rint(0.75 * ballD).toInt())

  /**
   * [g] must cover [patchHalf] around the hands (clipped to the image); [imgW] × [imgH] is the
   * whole working image (rays leaving it read 0, like cv2.remap's constant border).
   * [centerDeg] null = free 360° search. Angles are image angles (y down), 0° = +x.
   */
  fun search(g: Gray, imgW: Int, imgH: Int, hx: Double, hy: Double, exp: Double, ballD: Double, centerDeg: Double?): ShaftFound {
    val grad = Sobel(g)
    val r0 = max(2.0, 0.15 * exp)
    val nr = max(1, ceil((exp + 1e-6 - r0) / 1.0).toInt())
    val prof = Array(360) { FloatArray(nr) }
    val score = DoubleArray(360)
    for (t in 0 until 360) {
      val th = Math.toRadians(t.toDouble())
      val dx = cos(th)
      val dy = sin(th)
      val row = prof[t]
      var s = 0.0
      for (k in 0 until nr) {
        val r = r0 + k
        val x = (hx + dx * r).toFloat()
        val y = (hy + dy * r).toFloat()
        val gx = grad.sample(grad.gx, x, y, imgW, imgH)
        val gy = grad.sample(grad.gy, x, y, imgW, imgH)
        val par = abs(gx * dx + gy * dy)
        val perp = abs(-gx * dy + gy * dx)
        row[k] = (perp - par).toFloat()
        s += row[k]
      }
      score[t] = s
    }
    val med = median(score)
    val cand = if (centerDeg == null) IntArray(360) { it } else
      IntArray(2 * HALF_WIDTH_DEG + 1) { Math.floorMod(Math.rint(centerDeg + it - HALF_WIDTH_DEG).toInt(), 360) }
    var k = cand[0]
    for (c in cand) if (score[c] > score[k]) k = c
    val best = score[k]
    val ratio = if (med > 0) best / med else if (best > 0) Double.POSITIVE_INFINITY else 0.0

    // length along the best ray: where the window-averaged profile drops below 35 % of its peak
    val win = max(3, Math.rint(0.05 * exp).toInt())
    val p = boxSame(prof[k], win)
    var kp = 0
    for (i in p.indices) if (p[i] > p[kp]) kp = i
    var below = -1
    for (i in kp + 1 until p.size) if (p[i] < LENGTH_DROP * p[kp]) { below = i; break }
    val length = r0 + (if (below >= 0) below else nr - 1)
    val rad = Math.toRadians(k.toDouble())
    val ex = hx + cos(rad) * length
    val ey = hy + sin(rad) * length
    val (bx, by) = blob(g, imgW, imgH, ex, ey, ballD)
    val conf = ((ratio - 1) / 4).coerceIn(0.0, 1.0) * min(1.0, length / exp)
    val hidden = ratio < HIDDEN_RATIO || length < HIDDEN_LENGTH * exp
    return ShaftFound(k, length, ratio, ex, ey, bx, by, hidden, conf)
  }

  /** numpy.convolve(v, ones(n) / n, "same"): the window of output i starts at i − n / 2. */
  fun boxSame(v: FloatArray, n: Int): DoubleArray = DoubleArray(v.size) { i ->
    var s = 0.0
    val lo = i - n / 2
    for (j in lo until lo + n) if (j >= 0 && j < v.size) s += v[j]
    s / n
  }

  /**
   * The clubhead blob: the most contrasting pixel (|3×3 Gaussian − window median|) within a
   * window of 1.5 ball diameters around the shaft end; the end itself when the window leaves
   * the image.
   */
  fun blob(g: Gray, imgW: Int, imgH: Int, x: Double, y: Double, ballD: Double): Pair<Double, Double> {
    val half = blobHalf(ballD)
    val x0 = Math.rint(x).toInt() - half
    val y0 = Math.rint(y).toInt() - half
    val n = 2 * half + 1
    if (x0 < 0 || y0 < 0 || x0 + n > imgW || y0 + n > imgH) return Pair(x, y)
    if (!g.contains(x0, y0) || !g.contains(x0 + n - 1, y0 + n - 1)) return Pair(x, y)
    // cv2.GaussianBlur((3, 3), 0) = separable [1/4, 1/2, 1/4], BORDER_REFLECT_101 at the window edge
    fun at(i: Int, j: Int) = g.at(x0 + reflect(i, n), y0 + reflect(j, n)).toDouble()
    val h = DoubleArray(n * n)
    for (j in 0 until n) for (i in 0 until n) h[j * n + i] = 0.25 * at(i - 1, j) + 0.5 * at(i, j) + 0.25 * at(i + 1, j)
    val b = DoubleArray(n * n)
    for (j in 0 until n) for (i in 0 until n) {
      b[j * n + i] = 0.25 * h[reflect(j - 1, n) * n + i] + 0.5 * h[j * n + i] + 0.25 * h[reflect(j + 1, n) * n + i]
    }
    val m = median(b)
    var best = 0
    for (q in b.indices) if (abs(b[q] - m) > abs(b[best] - m)) best = q
    return Pair((x0 + best % n).toDouble(), (y0 + best / n).toDouble())
  }

  /** BORDER_REFLECT_101: −1 → 1, n → n − 2. */
  fun reflect(i: Int, n: Int): Int = when {
    n == 1 -> 0
    i < 0 -> -i
    i >= n -> 2 * n - 2 - i
    else -> i
  }

  fun median(v: DoubleArray): Double {
    val s = v.sortedArray()
    val m = s.size / 2
    return if (s.size % 2 == 1) s[m] else (s[m - 1] + s[m]) / 2
  }

  /** 3×3 Sobel of a patch (cv2.Sobel ksize 3, BORDER_REFLECT_101 at the patch edge). */
  private class Sobel(val g: Gray) {
    val gx = FloatArray(g.w * g.h)
    val gy = FloatArray(g.w * g.h)

    init {
      val w = g.w
      val h = g.h
      fun v(i: Int, j: Int) = (g.px[reflect(j, h) * w + reflect(i, w)].toInt() and 0xFF).toFloat()
      for (j in 0 until h) for (i in 0 until w) {
        gx[j * w + i] = (v(i + 1, j - 1) + 2 * v(i + 1, j) + v(i + 1, j + 1)) - (v(i - 1, j - 1) + 2 * v(i - 1, j) + v(i - 1, j + 1))
        gy[j * w + i] = (v(i - 1, j + 1) + 2 * v(i, j + 1) + v(i + 1, j + 1)) - (v(i - 1, j - 1) + 2 * v(i, j - 1) + v(i + 1, j - 1))
      }
    }

    /**
     * cv2.remap INTER_LINEAR with a constant 0 border: coordinates quantised to 1/32 px as
     * OpenCV does, neighbours outside the image (or the patch) read 0.
     */
    fun sample(a: FloatArray, x: Float, y: Float, imgW: Int, imgH: Int): Double {
      val ix = Math.rint((x * 32f).toDouble()).toInt()
      val iy = Math.rint((y * 32f).toDouble()).toInt()
      val x0 = ix shr 5
      val y0 = iy shr 5
      val fx = (ix and 31) / 32.0
      val fy = (iy and 31) / 32.0
      fun px(xx: Int, yy: Int): Double {
        if (xx < 0 || yy < 0 || xx >= imgW || yy >= imgH || !g.contains(xx, yy)) return 0.0
        return a[(yy - g.y0) * g.w + (xx - g.x0)].toDouble()
      }
      return (1 - fy) * ((1 - fx) * px(x0, y0) + fx * px(x0 + 1, y0)) + fy * ((1 - fx) * px(x0, y0 + 1) + fx * px(x0 + 1, y0 + 1))
    }
  }
}

/**
 * P1 address from the image (plan §5.1, D17), ported from detect.py `clubhead_onset`: the
 * last frame before the clubhead starts moving back. At address the clubhead is soled behind
 * the ball, so its motion shows up as change in a patch around the ball. Signal = mean
 * absolute frame-to-frame difference of the patch, 3-sample median; noise ceiling = the max
 * of the same signal while the ball sits alone (lead arm → top). Onset = start of the LAST
 * run of ≥ [minRun] samples above the ceiling that starts no later than [latest] (waggles come
 * earlier); address = onset − 1.
 */
internal object ClubheadOnset {
  fun detect(patches: Map<Int, Gray>, run: IntRange, latest: Int, quiet: IntRange, minRun: Int): Int? {
    val (_, ms) = signal(patches, quiet)
    val (fr, m3) = signal(patches, run)
    if (ms.isEmpty() || fr.isEmpty()) return null
    val ceiling = ms.max()
    val need = max(2, minRun)
    var start: Int? = null
    var k = 0
    while (k < m3.size) {
      if (m3[k] > ceiling) {
        var e = k
        while (e + 1 < m3.size && m3[e + 1] > ceiling) e++
        if (e - k + 1 >= need && fr[k] <= latest) start = fr[k]
        k = e + 1
      } else {
        k++
      }
    }
    return start?.let { it - 1 }
  }

  /** (frames, 3-sample median of the frame-to-frame patch difference) over [range]. */
  fun signal(patches: Map<Int, Gray>, range: IntRange): Pair<IntArray, DoubleArray> {
    val fr = range.filter { patches[it] != null && patches[it - 1] != null }.toIntArray()
    val fd = DoubleArray(fr.size) { meanAbsDiff(patches.getValue(fr[it]), patches.getValue(fr[it] - 1)) }
    val m3 = DoubleArray(fd.size) { i ->
      val lo = max(0, i - 1)
      val hi = min(fd.size - 1, i + 1)
      ShaftSearch.median(fd.copyOfRange(lo, hi + 1))
    }
    return Pair(fr, m3)
  }

  private fun meanAbsDiff(a: Gray, b: Gray): Double {
    val n = min(a.px.size, b.px.size)
    if (n == 0) return 0.0
    var s = 0L
    for (i in 0 until n) s += abs((a.px[i].toInt() and 0xFF) - (b.px[i].toInt() and 0xFF))
    return s.toDouble() / n
  }

  /** The patch around the ball, ±1.5 ball diameters (floor 3 px), in frame px, clipped like a numpy slice. */
  fun patchRect(ballX: Double, ballY: Double, pxPerCm: Double, frameW: Int, frameH: Int): Rect {
    val half = max(3, Math.rint(1.5 * Ball.BALL_CM * pxPerCm).toInt())
    val bx = Math.rint(ballX).toInt()
    val by = Math.rint(ballY).toInt()
    return Rect(max(0, bx - half), max(0, by - half), min(frameW, bx + half + 1), min(frameH, by + half + 1))
  }
}
