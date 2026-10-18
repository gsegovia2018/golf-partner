package expo.modules.golfswing

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

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

/** One frame of the head track: where the head is relative to the reference frame, cm, the match score, on the search border. */
internal data class HeadPos(val dx: Double, val dy: Double, val score: Double, val edge: Boolean)

/**
 * P1 address from the image (apiVersion 6, detect.py `clubhead_address`): the last frame before
 * the clubhead starts moving back, the slow creep of a takeaway included. The clubhead itself is
 * followed with a template (masked around the ball, which it rests next to) through grey strips
 * around the ball, and its speed in cm/s decides. Replaces apiVersion ≤ 5's motion energy in a
 * patch around the ball, which missed the soled head (it rests in front of the ball), the creep
 * and heads that move after the hands. Pure JVM so it can be unit-tested.
 *
 * Strips are frame px (display-oriented, decimated like the copies) point-sampled every `step`
 * px over [stripRect]: `Gray(0, 0, …)` in sample units.
 */
internal object ClubheadTrack {
  /** The head track starts this long before the hands' still run (the creep can start earlier). */
  const val PRE_S = 0.5
  const val STRIP_D = 6.0
  const val SAMPLES = 6
  const val HEAD_MIN = 0.25
  const val HEAD_CM = 30.0
  const val TPL_W_CM = 8.0
  const val TPL_H_CM = 6.0
  const val BALL_MASK_D = 0.6
  const val SEARCH_D = 1.5
  const val LAG_S = 0.04
  const val HOLD_S = 0.1
  const val MOVING_CMS = 10.0
  const val FAST = 3.0
  const val LOST_NCC = 0.5

  /** The strip in frame px and its sampling step: ± [STRIP_D] ball diameters, ≥ 8 samples per diameter. */
  fun stripRect(ballX: Double, ballY: Double, pxPerCm: Double, frameW: Int, frameH: Int): Pair<Rect, Int> {
    val d = Ball.BALL_CM * pxPerCm
    val half = max(4, Math.rint(STRIP_D * d).toInt())
    val step = max(1, floor(d / 8).toInt())
    val bx = Math.rint(ballX).toInt()
    val by = Math.rint(ballY).toInt()
    return Pair(Rect(max(0, bx - half), max(0, by - half), min(frameW, bx + half + 1), min(frameH, by + half + 1)), step)
  }

  /** First frame of the track: [PRE_S] before the hands' still run. */
  fun start(runStart: Int, fps: Double) = max(0, runStart - Math.rint(PRE_S * fps).toInt())

  /** The detector frames for the resting head: [SAMPLES] evenly over [[lo], [leadArm]). */
  fun samples(lo: Int, leadArm: Int): List<Int> =
    (0 until SAMPLES).map { lo + floor(it * (leadArm - lo).toDouble() / SAMPLES + 0.5).toInt() }.distinct().sorted()

  /**
   * The earliest sample whose head ([heads]: frame → (x, y, score), frame px) scores ≥ [HEAD_MIN]
   * within [HEAD_CM] of the ball: (frame, x, y), else null.
   */
  fun restingHead(heads: Map<Int, Triple<Double, Double, Double>?>, ballX: Double, ballY: Double, pxPerCm: Double): Triple<Int, Double, Double>? {
    for (f in heads.keys.sorted()) {
      val h = heads[f] ?: continue
      if (h.third >= HEAD_MIN && hypot(h.first - ballX, h.second - ballY) / pxPerCm <= HEAD_CM) return Triple(f, h.first, h.second)
    }
    return null
  }

  /** Where the head rests without a detector: ½ diameter towards the golfer, 0.8 below the ball (toward the camera). */
  fun fallbackHead(ballX: Double, ballY: Double, handsX: Double, pxPerCm: Double): Pair<Double, Double> {
    val d = Ball.BALL_CM * pxPerCm
    val sgn = if (ballX >= handsX) 1.0 else -1.0
    return Pair(ballX - 0.5 * sgn * d, ballY + 0.8 * d)
  }

  /**
   * Per frame of [strips]: the head relative to where it is at [ref] (cm), the masked NCC and
   * whether the best offset lies on the search border. [origin] = the strip rect's top-left and
   * [step] its sampling, frame px; [headX], [headY], [ballX], [ballY] frame px. Empty when the
   * template and its search do not fit in the strip.
   */
  fun track(
    strips: Map<Int, Gray>, origin: Pair<Int, Int>, step: Int, ref: Int,
    headX: Double, headY: Double, ballX: Double, ballY: Double, pxPerCm: Double,
  ): Map<Int, HeadPos> {
    val pps = pxPerCm / step
    val d = Ball.BALL_CM * pps
    val x = Math.rint((headX - origin.first) / step).toInt()
    val y = Math.rint((headY - origin.second) / step).toInt()
    val tw = max(2, Math.rint(TPL_W_CM / 2 * pps).toInt())
    val th = max(2, Math.rint(TPL_H_CM / 2 * pps).toInt())
    val s = max(2, Math.rint(SEARCH_D * d).toInt())
    val g = strips[ref] ?: return emptyMap()
    if (y - th - s < 0 || x - tw - s < 0 || y + th + s >= g.h || x + tw + s >= g.w) return emptyMap()
    val nw = 2 * tw + 1
    val nh = 2 * th + 1
    val bx = (ballX - origin.first) / step
    val by = (ballY - origin.second) / step
    val maskR2 = (BALL_MASK_D * d) * (BALL_MASK_D * d)
    // template pixels outside the ball's disc, as offsets into the window
    val idx = ArrayList<Int>()
    for (j in 0 until nh) for (i in 0 until nw) {
      val px = x - tw + i
      val py = y - th + j
      if ((px - bx) * (px - bx) + (py - by) * (py - by) > maskR2) idx += j * nw + i
    }
    if (idx.size < 4) return emptyMap()
    val tpl = DoubleArray(idx.size) { k -> g.at(x - tw + idx[k] % nw, y - th + idx[k] / nw).toDouble() }
    val out = LinkedHashMap<Int, HeadPos>()
    val n = 2 * s + 1
    val r = DoubleArray(n * n)
    for (f in strips.keys.sorted()) {
      val w = strips.getValue(f)
      if (w.w != g.w || w.h != g.h) continue
      maskedNcc(w, x - tw - s, y - th - s, nw, idx, tpl, n, r)
      var best = 0
      for (k in r.indices) if (r[k] > r[best]) best = k
      val mx = best % n
      val my = best / n
      val v = r[best]
      val ox = if (mx in 1 until n - 1) parabola(r[best - 1], r[best + 1], v) else 0.0
      val oy = if (my in 1 until n - 1) parabola(r[best - n], r[best + n], v) else 0.0
      val edge = mx == 0 || my == 0 || mx == n - 1 || my == n - 1
      out[f] = HeadPos((mx + ox - s) / pps, (my + oy - s) / pps, v, edge)
    }
    return out
  }

  /**
   * Zero-mean NCC of the template (values [tpl] at window offsets [idx], window row width [nw])
   * at each of the [n] × [n] offsets of [g] from ([x0], [y0]), row-major into [out]; −1 where
   * either side is flat (detect.py masked_ncc).
   */
  fun maskedNcc(g: Gray, x0: Int, y0: Int, nw: Int, idx: List<Int>, tpl: DoubleArray, n: Int, out: DoubleArray) {
    val tm = tpl.average()
    var tn = 0.0
    for (v in tpl) tn += (v - tm) * (v - tm)
    tn = sqrt(tn)
    val q = DoubleArray(idx.size)
    for (dy in 0 until n) for (dx in 0 until n) {
      var sum = 0.0
      for (k in idx.indices) {
        q[k] = g.at(x0 + dx + idx[k] % nw, y0 + dy + idx[k] / nw).toDouble()
        sum += q[k]
      }
      val qm = sum / idx.size
      var qn = 0.0
      var dot = 0.0
      for (k in idx.indices) {
        val a = q[k] - qm
        qn += a * a
        dot += a * (tpl[k] - tm)
      }
      qn = sqrt(qn)
      out[dy * n + dx] = if (qn > 0 && tn > 0) dot / (qn * tn) else -1.0
    }
  }

  /** Sub-sample offset of a peak from its neighbours (a parabola through three samples). */
  fun parabola(a: Double, b: Double, c: Double): Double {
    val d = a - 2 * c + b
    return if (d >= 0) 0.0 else 0.5 * (a - b) / d
  }

  /**
   * The address from a [track] (detect.py `address_from_track`). speed(f) = displacement over
   * [LAG_S], cm/s. The head has gone at the first frame after [ref] where tracking is lost
   * (score < [LOST_NCC] or on the search border) or the speed passes [FAST] × [MOVING_CMS], else
   * [leadArm]. Walking back from there through the moving frames (> [MOVING_CMS]), the address is
   * the end of the first stretch of [HOLD_S] not-moving frames (a pause inside the takeaway is
   * shorter). Reaching the first tracked frame: that frame when the track starts at the clip's
   * start ([clipStart]: the clip begins mid-creep), else null.
   */
  fun address(track: Map<Int, HeadPos>, ref: Int, leadArm: Int, fps: Double, clipStart: Boolean): Int? {
    val lag = max(1, Math.rint(LAG_S * fps).toInt())
    val hold = max(2, Math.rint(HOLD_S * fps).toInt())
    fun speed(f: Int): Double? {
      val a = track[f] ?: return null
      val b = track[f - lag] ?: return null
      return hypot(a.dx - b.dx, a.dy - b.dy) / (lag / fps)
    }
    var gone = leadArm
    for (f in track.keys.sorted()) {
      if (f <= ref) continue
      val p = track.getValue(f)
      val v = speed(f)
      if (p.score < LOST_NCC || p.edge || (v != null && v > FAST * MOVING_CMS)) {
        gone = f
        break
      }
    }
    val moving = HashMap<Int, Boolean>()
    for (f in track.keys) {
      if (f >= gone) continue
      val v = speed(f) ?: continue
      moving[f] = v > MOVING_CMS
    }
    if (moving.isEmpty()) return null
    val first = moving.keys.min()
    var f = gone - 1
    while (true) {
      while (f >= first && moving[f] != false) f--
      if (f - hold < first) return if (clipStart) first else null
      if ((f - hold..f).all { moving[it] == false }) return f
      f--
    }
  }
}
