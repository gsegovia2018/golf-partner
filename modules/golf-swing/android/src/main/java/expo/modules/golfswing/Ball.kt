package expo.modules.golfswing

import kotlin.math.PI
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

  // Impact (apiVersion 6, detect.py ball_gone_frame): the ball still sitting where it was, matched
  // against its own picture. The old rule (the first big frame difference in the ball's footprint
  // after the top) fired when the shaft swept over the ball, 2-7 frames early.
  /** Template half size, ball diameters (the ball and a ring of ground). */
  const val GONE_TPL_D = 0.7
  /** The match may shift this much: the ball's spot, not its exact pixel. */
  const val GONE_SEARCH_D = 0.4
  /** "Still there": NCC at least this ... */
  const val GONE_MATCH = 0.7
  /** ... on a patch with at least this share of the template's contrast. */
  const val GONE_CONTRAST = 0.7
  /** Gone = absent this long without coming back. */
  const val GONE_FOR_S = 0.1

  /**
   * The first frame after [after] (the hands' top) from which the ball is absent for
   * [GONE_FOR_S]; impact = that − 1. [strips] maps frame → working grey (same origin for all);
   * the ball at ([ballWorkX], [ballWorkY]) with diameter [dWork], work px; [fps] = capture rate.
   *
   * Template = the per-pixel median over [tplFrames] (lead arm → top: the club is in the air, the
   * ball sits alone) of the UPPER half of a ±[GONE_TPL_D] patch around the re-centred ball, centre
   * row included (the club arrives from below, so the lower half is covered first). Present =
   * [match] ≥ [GONE_MATCH] within ±[GONE_SEARCH_D]. A brief absence (the hosel in front of the
   * ball) does not count, nor does a match that comes back. null when the patch leaves the strip
   * or the ball never goes.
   */
  fun goneFrame(strips: Map<Int, Gray>, ballWorkX: Double, ballWorkY: Double, dWork: Double, tplFrames: IntRange, after: Int, fps: Double): Int? {
    val fs = tplFrames.mapNotNull { strips[it] }
    if (fs.isEmpty()) return null
    val r = max(2, Math.rint(GONE_TPL_D * dWork).toInt())
    val s = max(1, Math.rint(GONE_SEARCH_D * dWork).toInt())
    val h = max(1, Math.rint(dWork).toInt())
    val x = Math.rint(ballWorkX).toInt()
    val y = Math.rint(ballWorkY).toInt()
    val m = 2 * h + r + s + 2
    if (!fs[0].contains(x - m, y - m) || !fs[0].contains(x + m, y + m)) return null
    val n = 2 * m + 1
    // per-pixel median of the static frames over the ±m square (numpy.median: mean of the middle two)
    val med = DoubleArray(n * n)
    val col = DoubleArray(fs.size)
    for (j in 0 until n) for (i in 0 until n) {
      for (k in fs.indices) col[k] = fs[k].at(x - m + i, y - m + j).toDouble()
      med[j * n + i] = medianOf(col)
    }
    val (cx, cy) = recentre(med, n, m, m, dWork)
    val tw = 2 * r + 1
    val th = r + 1
    val tpl = DoubleArray(tw * th) { med[(cy - r + it / tw) * n + (cx - r + it % tw)] }
    val bx = x - m + cx
    val by = y - m + cy
    val need = max(2, Math.rint(GONE_FOR_S * fps).toInt())
    val later = strips.keys.filter { it > after }.sorted()
    val present = HashMap<Int, Boolean>()
    val ww = tw + 2 * s
    val wh = th + 2 * s
    val win = DoubleArray(ww * wh)
    for (f in later) {
      val g = strips.getValue(f)
      if (!g.contains(bx - r - s, by - r - s) || !g.contains(bx + r + s, by + s)) continue
      for (j in 0 until wh) for (i in 0 until ww) win[j * ww + i] = g.at(bx - r - s + i, by - r - s + j).toDouble()
      present[f] = match(win, ww, wh, tpl, tw, th) >= GONE_MATCH
    }
    for (f in later) {
      if ((0 until need).all { present[f + it] == false }) return f
    }
    return null
  }

  /**
   * The ball's centre in a static grey image [med] ([n] × [n]): the brightest 3 × 3 sum within
   * ±d of ([x], [y]), then the centroid of the pixels within ±0.7 d of it that are at least half
   * way from the ground (median of ±2 d) to that window's brightest pixel.
   */
  fun recentre(med: DoubleArray, n: Int, x: Int, y: Int, d: Double): Pair<Int, Int> {
    val h = max(1, Math.rint(d).toInt())
    val r = max(1, Math.rint(0.7 * d).toInt())
    var best = -1.0
    var cx = x
    var cy = y
    for (yy in y - h..y + h) for (xx in x - h..x + h) {
      var v = 0.0
      for (b in -1..1) for (a in -1..1) v += med[(yy + b) * n + xx + a]
      if (v > best) {
        best = v
        cx = xx
        cy = yy
      }
    }
    var top = Double.NEGATIVE_INFINITY
    for (yy in cy - r..cy + r) for (xx in cx - r..cx + r) top = max(top, med[yy * n + xx])
    val ring = DoubleArray((4 * h + 1) * (4 * h + 1))
    var k = 0
    for (yy in y - 2 * h..y + 2 * h) for (xx in x - 2 * h..x + 2 * h) ring[k++] = med[yy * n + xx]
    val lvl = (top + medianOf(ring)) / 2
    var sx = 0.0
    var sy = 0.0
    var cnt = 0
    for (yy in cy - r..cy + r) for (xx in cx - r..cx + r) {
      if (med[yy * n + xx] >= lvl) {
        sx += xx
        sy += yy
        cnt++
      }
    }
    return Pair(floor(sx / cnt + 0.5).toInt(), floor(sy / cnt + 0.5).toInt())
  }

  /**
   * The best zero-mean NCC of [tpl] ([tw] × [th]) over [win] ([ww] × [wh]) among the offsets whose
   * patch keeps ≥ [GONE_CONTRAST] of the template's contrast (an empty patch of grass can
   * correlate, it can't be as contrasted); −2 when no offset qualifies.
   */
  fun match(win: DoubleArray, ww: Int, wh: Int, tpl: DoubleArray, tw: Int, th: Int): Double {
    val tm = tpl.average()
    var tn = 0.0
    for (v in tpl) tn += (v - tm) * (v - tm)
    tn = sqrt(tn)
    var best = -2.0
    if (tn == 0.0) return best
    val np = tw * th
    for (dy in 0..wh - th) for (dx in 0..ww - tw) {
      var sum = 0.0
      for (j in 0 until th) for (i in 0 until tw) sum += win[(dy + j) * ww + dx + i]
      val qm = sum / np
      var qn = 0.0
      var dot = 0.0
      for (j in 0 until th) for (i in 0 until tw) {
        val q = win[(dy + j) * ww + dx + i] - qm
        qn += q * q
        dot += q * (tpl[j * tw + i] - tm)
      }
      qn = sqrt(qn)
      if (qn == 0.0 || qn < GONE_CONTRAST * tn) continue
      best = max(best, dot / (qn * tn))
    }
    return best
  }

  private fun medianOf(v: DoubleArray): Double {
    val s = v.sortedArray()
    val m = s.size / 2
    return if (s.size % 2 == 1) s[m] else (s[m - 1] + s[m]) / 2
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
