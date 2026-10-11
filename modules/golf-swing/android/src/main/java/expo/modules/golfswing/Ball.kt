package expo.modules.golfswing

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * A grey patch of the working image (the decoded frame at work scale, plan §4.3: half
 * resolution from 720p up). [x0], [y0] place it in working-image coordinates; values are
 * 0–255 grey (unsigned bytes), like the lab's cv2 grey.
 */
internal class Gray(val x0: Int, val y0: Int, val w: Int, val h: Int, val px: ByteArray) {
  fun at(x: Int, y: Int): Int = px[(y - y0) * w + (x - x0)].toInt() and 0xFF
  fun contains(x: Int, y: Int) = x >= x0 && y >= y0 && x < x0 + w && y < y0 + h
}

/** Integer rectangle [x0, x1) × [y0, y1). */
internal data class Rect(val x0: Int, val y0: Int, val x1: Int, val y1: Int) {
  val w get() = x1 - x0
  val h get() = y1 - y0
  fun isEmpty() = w <= 0 || h <= 0
}

internal data class BallFound(val x: Double, val y: Double, val r: Double, val conf: Double, val frames: Int)

/** Ball blob + impact refinement (plan §4.3), ported from tools/swing-lab/detect.py (d15). */
internal object Ball {
  const val BALL_CM = 4.27
  const val LEG_FRACTION = 0.49
  const val DEFAULT_HEIGHT_CM = 176.0

  /**
   * The lab's ROI (detect_ball): x from the lead-foot toe to hands x ± 0.3 W (towards the
   * ball side), y from ankle y − 0.1 H to ankle y + 0.05 H; display px in, work px out.
   */
  fun roi(toeX: Float, ankleY: Float, handsX: Float, sgn: Int, w: Int, h: Int, ws: Double, workW: Int, workH: Int): Rect {
    val a = toeX.toDouble()
    val b = handsX + sgn * 0.3 * w
    val lo = min(a, b)
    val hi = max(a, b)
    return Rect(
      max(0.0, lo * ws).toInt(),
      max(0.0, (ankleY - 0.1 * h) * ws).toInt(),
      min(workW.toDouble(), hi * ws).toInt(),
      min(workH.toDouble(), (ankleY + 0.05 * h) * ws).toInt(),
    )
  }

  private class Cand(val dist: Double, val cx: Double, val cy: Double, val circ: Double, val contrast: Double)

  /**
   * detect.py `detect_ball` on the search frames (club in the air, scene static, D17):
   * brightest-2 % components inside [roi], area within ±50 % of the expected ball, fill of
   * the enclosing circle > 0.7, the one closest to the ray from the hands 45° down towards
   * the ball side. Median over the frames. [hands] and [roi] in work px; result in display px.
   */
  fun detect(frames: List<Gray>, roi: Rect, hands: Pt, sgn: Int, expDWork: Double, ws: Double): BallFound? {
    val expArea = PI * (expDWork / 2) * (expDWork / 2)
    val found = ArrayList<Cand>()
    for (g in frames) {
      val r = Rect(max(roi.x0, g.x0), max(roi.y0, g.y0), min(roi.x1, g.x0 + g.w), min(roi.y1, g.y0 + g.h))
      if (r.isEmpty()) continue
      val best = bestBlob(g, r, hands, sgn, expArea) ?: continue
      found.add(best)
    }
    if (found.isEmpty()) return null
    fun med(sel: (Cand) -> Double) = Stats.median(FloatArray(found.size) { sel(found[it]).toFloat() }).toDouble()
    val circ = med { it.circ }
    val contrast = med { it.contrast }
    return BallFound(
      x = med { it.cx } / ws,
      y = med { it.cy } / ws,
      r = expDWork / ws / 2,
      conf = 0.5 * min(1.0, circ) + 0.5 * min(1.0, max(0.0, contrast) / 60),
      frames = found.size,
    )
  }

  private fun bestBlob(g: Gray, r: Rect, hands: Pt, sgn: Int, expArea: Double): Cand? {
    val w = r.w
    val h = r.h
    val v = IntArray(w * h) { g.at(r.x0 + it % w, r.y0 + it / w) }
    val thr = percentile98(v)
    val label = IntArray(w * h)
    var best: Cand? = null
    var next = 0
    val stack = IntArray(w * h)
    val dx = 1 / sqrt(2.0) * sgn
    val dy = 1 / sqrt(2.0)
    for (start in 0 until w * h) {
      if (v[start] < thr || label[start] != 0) continue
      next++
      // 8-connected flood fill (cv2.connectedComponentsWithStats, connectivity=8)
      var sp = 0
      stack[sp++] = start
      label[start] = next
      var area = 0
      var sx = 0L
      var sy = 0L
      var sum = 0L
      var minX = w
      var minY = h
      var maxX = -1
      var maxY = -1
      while (sp > 0) {
        val p = stack[--sp]
        val px = p % w
        val py = p / w
        area++
        sx += px
        sy += py
        sum += v[p]
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
        for (oy in -1..1) for (ox in -1..1) {
          val qx = px + ox
          val qy = py + oy
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue
          val q = qy * w + qx
          if (label[q] == 0 && v[q] >= thr) {
            label[q] = next
            stack[sp++] = q
          }
        }
      }
      if (area < 0.5 * expArea || area > 1.5 * expArea) continue
      val bw = maxX - minX + 1
      val bh = maxY - minY + 1
      val rad = max(bw, bh) / 2.0
      val circ = area / (PI * rad * rad)
      if (circ <= 0.7) continue
      val cx = sx.toDouble() / area + r.x0
      val cy = sy.toDouble() / area + r.y0
      val relX = cx - hands.x
      val relY = cy - hands.y
      val along = max(0.0, relX * dx + relY * dy)
      val dist = hypot(relX - along * dx, relY - along * dy)
      // contrast = mean inside − median of the bbox grown by 3 px (clipped like a numpy slice)
      val ax0 = max(0, minX - 3)
      val ay0 = max(0, minY - 3)
      val ax1 = min(w, minX + bw + 3)
      val ay1 = min(h, minY + bh + 3)
      val around = FloatArray((ax1 - ax0) * (ay1 - ay0))
      var k = 0
      for (yy in ay0 until ay1) for (xx in ax0 until ax1) around[k++] = v[yy * w + xx].toFloat()
      val contrast = sum.toDouble() / area - Stats.median(around)
      if (best == null || dist < best.dist) best = Cand(dist, cx, cy, circ, contrast)
    }
    return best
  }

  /** numpy.percentile(v, 98), linear interpolation, on 0–255 integers via a histogram. */
  fun percentile98(v: IntArray): Double {
    val hist = IntArray(256)
    for (x in v) hist[x]++
    val pos = 0.98 * (v.size - 1)
    val lo = floor(pos).toInt()
    fun kth(k: Int): Int {
      var acc = 0
      for (b in 0 until 256) {
        acc += hist[b]
        if (acc > k) return b
      }
      return 255
    }
    val a = kth(lo)
    val b = kth(min(lo + 1, v.size - 1))
    return a + (pos - lo) * (b - a)
  }

  /**
   * detect.py `ball_gone_frame`: the patch is the ball's own footprint (half = max(2,
   * round(d/2)) work px); noise = the max frame-to-frame patch difference over [quiet]
   * (floor 0.5 grey levels); ballGone = the first frame after [after] whose difference to
   * the previous frame exceeds 4 × noise. [strips] maps frame → grey; only consecutive
   * frames are compared.
   */
  fun goneFrame(strips: Map<Int, Gray>, ballWorkX: Double, ballWorkY: Double, dWork: Double, quiet: IntRange, after: Int): Int? {
    val half = max(2, Math.rint(0.5 * dWork).toInt())
    val bx = Math.rint(ballWorkX).toInt()
    val by = Math.rint(ballWorkY).toInt()
    fun diff(a: Gray, b: Gray): Double? {
      var s = 0L
      var n = 0
      for (y in max(0, by - half)..by + half) for (x in max(0, bx - half)..bx + half) {
        if (!a.contains(x, y) || !b.contains(x, y)) return null
        s += abs(a.at(x, y) - b.at(x, y))
        n++
      }
      return if (n == 0) null else s.toDouble() / n
    }
    val q = quiet.mapNotNull { f -> strips[f]?.let { a -> strips[f - 1]?.let { b -> diff(a, b) } } }
    if (q.isEmpty()) return null
    val noise = max(q.max(), 0.5)
    for (f in strips.keys.sorted()) {
      if (f <= after) continue
      val a = strips[f] ?: continue
      val b = strips[f - 1] ?: continue
      val d = diff(a, b) ?: continue
      if (d > 4 * noise) return f
    }
    return null
  }

  /** pxPerCm from the camera-nearer (trail) leg at address (plan §4.6, detect.py leg_scale). */
  fun pxPerCm(still: List<PoseSample>, rightHanded: Boolean, heightCm: Double): Double {
    val hip = if (rightHanded) Lm.R_HIP else Lm.L_HIP
    val knee = if (rightHanded) Lm.R_KNEE else Lm.L_KNEE
    val ank = if (rightHanded) Lm.R_ANK else Lm.L_ANK
    val legs = FloatArray(still.size) {
      val s = still[it]
      hypot(s.x(hip) - s.x(knee), s.y(hip) - s.y(knee)) + hypot(s.x(knee) - s.x(ank), s.y(knee) - s.y(ank))
    }
    return Stats.median(legs) / (LEG_FRACTION * heightCm)
  }
}
