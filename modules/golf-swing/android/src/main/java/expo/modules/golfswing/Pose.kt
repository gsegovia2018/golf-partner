package expo.modules.golfswing

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.sqrt

/** MediaPipe pose landmark indices (33-point topology). */
internal object Lm {
  const val COUNT = 33
  const val NOSE = 0
  const val L_SH = 11
  const val R_SH = 12
  const val L_EL = 13
  const val R_EL = 14
  const val L_WR = 15
  const val R_WR = 16
  const val L_HIP = 23
  const val R_HIP = 24
  const val L_KNEE = 25
  const val R_KNEE = 26
  const val L_ANK = 27
  const val R_ANK = 28
  const val L_TOE = 31
  const val R_TOE = 32
}

/**
 * One pose sample in display pixels. [lm] packs x, y, visibility per landmark
 * (33 × 3). [frame] is the container frame index, [ptsUs] its presentation time.
 */
internal class PoseSample(val frame: Int, val ptsUs: Long, val lm: FloatArray) {
  fun x(j: Int) = lm[3 * j]
  fun y(j: Int) = lm[3 * j + 1]
  fun vis(j: Int) = lm[3 * j + 2]

  /** Landmark bounding-box height: the lab's body height H (detect.py SamplingPolicy). */
  fun bodyHeight(): Float {
    var lo = Float.MAX_VALUE
    var hi = -Float.MAX_VALUE
    for (j in 0 until Lm.COUNT) {
      val v = y(j)
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    return hi - lo
  }
}

internal data class Pt(val x: Float, val y: Float) {
  fun dist(o: Pt) = hypot(x - o.x, y - o.y)
}

/** Hands = grip estimate (plan §4.5, D17). */
internal object Grip {
  /** Grip point per arm = wrist + k·(wrist − elbow). Anatomy prior, not a fit (§4.5). */
  const val K = 0.35f
  const val VIS_MIN = 0.5f

  fun arm(s: PoseSample, wr: Int, el: Int, k: Float = K) =
    Pt(s.x(wr) + k * (s.x(wr) - s.x(el)), s.y(wr) + k * (s.y(wr) - s.y(el)))

  /**
   * Single-sample grip with the visibility half of the §4.5 wrist gate: a wrist with
   * visibility < 0.5 is dropped (with its arm's grip point) when the other is visible;
   * both hidden → both kept. The jump half of the gate needs history; [gatedSeries] has it.
   */
  fun point(s: PoseSample, k: Float = K): Pt {
    val l = arm(s, Lm.L_WR, Lm.L_EL, k)
    val r = arm(s, Lm.R_WR, Lm.R_EL, k)
    val lv = s.vis(Lm.L_WR) >= VIS_MIN
    val rv = s.vis(Lm.R_WR) >= VIS_MIN
    return when {
      lv && !rv -> l
      rv && !lv -> r
      else -> Pt((l.x + r.x) / 2, (l.y + r.y) / 2)
    }
  }

  /**
   * Port of detect.py `gated_hands(idx, L, fixed=True, pts)`: per-side points are rejected
   * when the wrist's visibility is < 0.5 AND (it jumped > 1.5 × that forearm's median length
   * since the last accepted sample, OR the other wrist is visible). Accepted sides are
   * averaged; samples with no accepted side are linearly interpolated in frame index.
   * [k] = null combines the wrists themselves (the lab's wrist midpoint).
   */
  fun gatedSeries(samples: List<PoseSample>, k: Float? = K): Array<Pt> {
    val n = samples.size
    val ok = Array(n) { BooleanArray(2) { true } }
    val sides = arrayOf(intArrayOf(Lm.L_WR, Lm.L_EL), intArrayOf(Lm.R_WR, Lm.R_EL))
    for ((side, pair) in sides.withIndex()) {
      val wr = pair[0]
      val el = pair[1]
      val other = if (wr == Lm.L_WR) Lm.R_WR else Lm.L_WR
      val fore = Stats.median(FloatArray(n) { hypot(samples[it].x(wr) - samples[it].x(el), samples[it].y(wr) - samples[it].y(el)) })
      var lastX = if (n > 0) samples[0].x(wr) else 0f
      var lastY = if (n > 0) samples[0].y(wr) else 0f
      for (i in 0 until n) {
        val s = samples[i]
        val jump = hypot(s.x(wr) - lastX, s.y(wr) - lastY)
        if (s.vis(wr) < VIS_MIN && (jump > 1.5f * fore || s.vis(other) >= VIS_MIN)) {
          ok[i][side] = false
        } else {
          lastX = s.x(wr)
          lastY = s.y(wr)
        }
      }
    }
    fun pt(s: PoseSample, side: Int): Pt {
      val wr = sides[side][0]
      return if (k == null) Pt(s.x(wr), s.y(wr)) else arm(s, wr, sides[side][1], k)
    }
    val out = arrayOfNulls<Pt>(n)
    for (i in 0 until n) {
      val s = samples[i]
      out[i] = when {
        ok[i][0] && ok[i][1] -> pt(s, 0).let { a -> pt(s, 1).let { b -> Pt((a.x + b.x) / 2, (a.y + b.y) / 2) } }
        ok[i][0] -> pt(s, 0)
        ok[i][1] -> pt(s, 1)
        else -> null
      }
    }
    return interpolateGaps(samples.map { it.frame }, out)
  }

  private fun interpolateGaps(frames: List<Int>, pts: Array<Pt?>): Array<Pt> {
    val known = pts.indices.filter { pts[it] != null }
    if (known.isEmpty()) return Array(pts.size) { Pt(Float.NaN, Float.NaN) }
    return Array(pts.size) { i ->
      pts[i] ?: run {
        val after = known.firstOrNull { it > i }
        val before = known.lastOrNull { it < i }
        when {
          before == null -> pts[after!!]!!
          after == null -> pts[before]!!
          else -> {
            val t = (frames[i] - frames[before]).toFloat() / (frames[after] - frames[before])
            val a = pts[before]!!
            val b = pts[after]!!
            Pt(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y))
          }
        }
      }
    }
  }
}

internal object Stats {
  fun median(v: FloatArray): Float {
    if (v.isEmpty()) return Float.NaN
    val s = v.sortedArray()
    val m = s.size / 2
    return if (s.size % 2 == 1) s[m] else (s[m - 1] + s[m]) / 2
  }

  /** numpy.percentile with the default linear interpolation. */
  fun percentile(v: FloatArray, q: Double): Float {
    if (v.isEmpty()) return Float.NaN
    val s = v.sortedArray()
    val pos = q / 100.0 * (s.size - 1)
    val lo = floor(pos).toInt()
    val hi = minOf(lo + 1, s.size - 1)
    return (s[lo] + (pos - lo) * (s[hi] - s[lo])).toFloat()
  }

  /** 1.4826 × MAD: σ for Gaussian noise, robust to outliers (detect.py robust_sigma). */
  fun robustSigma(v: FloatArray): Float {
    val m = median(v)
    return 1.4826f * median(FloatArray(v.size) { abs(v[it] - m) })
  }

  /**
   * Jitter σ of a slowly drifting point from consecutive differences: the MAD removes the
   * drift (a constant mean of the differences) and √2 undoes the differencing.
   */
  fun diffSigma(xs: FloatArray): Float {
    if (xs.size < 3) return Float.NaN
    return robustSigma(FloatArray(xs.size - 1) { xs[it + 1] - xs[it] }) / sqrt(2f)
  }
}
