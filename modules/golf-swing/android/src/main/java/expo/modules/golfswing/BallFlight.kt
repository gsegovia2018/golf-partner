package expo.modules.golfswing

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt
import kotlin.math.tan

/** A bright blob in one frame of the corridor, sample units. */
internal class FlightBlob(val x: Double, val y: Double, val area: Int)

/** The ball's flight: [vx], [vy] per captured frame, [residual] the worst point's distance from the line ([kept] points). */
internal class FlightFit(val vx: Double, val vy: Double, val residual: Double, val kept: Int, val chain: List<Pair<Int, FlightBlob>>)

/** What the speed rows are made of, frame px: the ball at rest and its own diameter, the flight, the clubhead. */
internal class SpeedRaw(
  val x: Double,
  val y: Double,
  val d: Double,
  val step: Int,
  val ball: FlightFit?,
  /** clubhead px per captured frame over [clubPoints] frames before impact; null = not seen. */
  val club: Double?,
  val clubPoints: Int,
  /** The impact frame the flight says ([BallFlight.contact]), which times the club. */
  val contact: Int,
)

/**
 * Face-on ball and clubhead speed (plan 2026-10-30 §5), ported from tools/swing-lab/ball_flight.py.
 *
 * The background is the per-pixel median of frames around the top (the club in the air, the ball
 * alone). The ball's own diameter comes from that sharp, static picture. After impact the ball is
 * a blob brighter than the background in a corridor toward the target; the longest chain with a
 * constant step is its flight, and a least-squares line through it gives px per captured frame.
 * The clubhead is the leading edge of the moving bright blob in a low band behind the ball over the
 * [CLUB_FRAMES] frames before impact (near the ground the arc is close to horizontal).
 *
 * Grids are frame px sampled every [step] px ([step] keeps the ball near [BALL_SAMPLES] samples);
 * the diameter is read at full resolution.
 */
internal object BallFlight {
  /** Corridor toward the target, ball diameters; the steepest launch looked for; below the ball. */
  const val CORRIDOR_D = 35.0
  const val UP_DEG = 40.0
  const val DOWN_D = 1.5
  const val FLIGHT_FRAMES = 10
  /** Grey levels brighter than the background. */
  const val DIFF_MIN = 22
  /** Blob area / the ball's: a blurred ball is a streak. */
  const val AREA_MIN = 0.25
  const val AREA_MAX = 6.0
  const val MIN_CHAIN = 3
  const val CLUB_FRAMES = 3
  const val CLUB_BAND_UP_D = 4.0
  const val CLUB_BAND_DOWN_D = 1.0
  const val CLUB_BEHIND_D = 25.0
  /** Grey change from the previous frame: the head moves fast. */
  const val MOVE_MIN = 30
  const val CLUB_MIN_AREA = 0.15
  /** Background: frames top ± [BG_HALF], every [BG_EVERY]. */
  const val BG_HALF = 6
  const val BG_EVERY = 2
  const val BALL_SAMPLES = 8.0
  /** The flight's line passes this close to the ball at rest (ball diameters). */
  const val ORIGIN_D = 1.5
  /** 210 mph: a faster run is noise. */
  const val MAX_BALL_MS = 94.0
  /** The flight leaves the ball's spot within this many frames of impact (a pose-timed impact is off by a few). */
  const val LEAVE_FRAMES = 4.0

  private val TAN_UP = tan(Math.toRadians(UP_DEG))

  fun step(d: Double) = max(1, floor(d / BALL_SAMPLES).toInt())
  fun bgFrames(top: Int, n: Int) = (top - BG_HALF..top + BG_HALF step BG_EVERY).filter { it in 0 until n }
  /**
   * The club frames and the one before the first (its motion is against the previous frame), for a
   * contact up to [LEAVE_FRAMES] either side of [impact] (the flight times it, [contact]).
   */
  fun clubFrames(impact: Int, n: Int) =
    (impact - CLUB_FRAMES - 1 - LEAVE_FRAMES.toInt() until impact + LEAVE_FRAMES.toInt()).filter { it in 0 until n }
  /** From [LEAVE_FRAMES] before [impact] (an early contact) to [FLIGHT_FRAMES] after it. */
  fun flightFrames(impact: Int, n: Int) = (impact + 1 - LEAVE_FRAMES.toInt()..impact + FLIGHT_FRAMES).filter { it in 0 until n }

  /** The frame-px rectangle the corridor and the club band read, for a ball at ([bx], [by]) of diameter [d]. */
  fun area(bx: Double, by: Double, d: Double, sgn: Int, w: Int, h: Int): Rect {
    val ahead = bx + sgn * CORRIDOR_D * d
    val behind = bx - sgn * CLUB_BEHIND_D * d
    return Rect(
      max(0, floor(min(ahead, behind)).toInt()),
      max(0, floor(by - TAN_UP * CORRIDOR_D * d).toInt()),
      min(w, ceil(max(ahead, behind)).toInt() + 1),
      min(h, ceil(by + max(DOWN_D, CLUB_BAND_DOWN_D) * d).toInt() + 1),
    )
  }

  /** The full-resolution patch [diameter] reads: ±2 d around the ball, clipped to the frame. */
  fun patch(bx: Double, by: Double, d: Double, w: Int, h: Int): Rect {
    val k = max(2, Math.rint(2 * d).toInt())
    val x = Math.rint(bx).toInt()
    val y = Math.rint(by).toInt()
    return Rect(max(0, x - k), max(0, y - k), min(w, x + k + 1), min(h, y + k + 1))
  }

  /** Per-pixel median of grids of one geometry (numpy.median: the mean of the middle two). */
  fun median(frames: List<Gray>): Gray {
    val g0 = frames[0]
    val n = g0.w * g0.h
    val out = ByteArray(n)
    val col = IntArray(frames.size)
    for (p in 0 until n) {
      for (k in frames.indices) col[k] = frames[k].px[p].toInt() and 0xFF
      col.sort()
      val m = col.size / 2
      out[p] = (if (col.size % 2 == 1) col[m] else (col[m - 1] + col[m] + 1) / 2).toByte()
    }
    return Gray(g0.x0, g0.y0, g0.w, g0.h, out)
  }

  /**
   * The ball's own diameter on the static background patch [bg] (frame px): the pixels at least half
   * way from the ground (the patch's median) to the ball's brightest, connected to its centre within
   * ±1.2 d. In sunlight only one half of the ball is bright, but a half-lit sphere still spans the
   * whole diameter along its terminator, so the widest extent over four directions is the diameter.
   * (centre x, centre y, diameter) frame px; null when the ball is not inside the patch.
   */
  fun diameter(bg: Gray, bx: Double, by: Double, d: Double): Triple<Double, Double, Double>? {
    val gx = Math.rint(bx).toInt()
    val gy = Math.rint(by).toInt()
    val dd = Math.rint(d).toInt()
    if (!bg.contains(gx - dd, gy - dd) || !bg.contains(gx + dd, gy + dd)) return null
    val x1 = bg.x0 + bg.w - 1
    val y1 = bg.y0 + bg.h - 1
    fun at(x: Int, y: Int) = bg.at(x.coerceIn(bg.x0, x1), y.coerceIn(bg.y0, y1))
    val r = max(1, Math.rint(0.5 * d).toInt())
    var best = -1
    var cx = gx
    var cy = gy
    for (y in max(bg.y0, gy - r)..min(y1, gy + r)) for (x in max(bg.x0, gx - r)..min(x1, gx + r)) {
      var s = 0
      for (b in -1..1) for (a in -1..1) s += at(x + a, y + b)
      if (s > best) {
        best = s
        cx = x
        cy = y
      }
    }
    var top = 0
    for (y in max(bg.y0, cy - r)..min(y1, cy + r)) for (x in max(bg.x0, cx - r)..min(x1, cx + r)) top = max(top, bg.at(x, y))
    val all = FloatArray(bg.w * bg.h) { (bg.px[it].toInt() and 0xFF).toFloat() }
    val lvl = (top + Stats.median(all)) / 2.0
    if (bg.at(cx, cy) < lvl) return null
    val k = Math.rint(1.2 * d).toInt()
    val bx0 = max(bg.x0, cx - k)
    val by0 = max(bg.y0, cy - k)
    val bx1 = min(x1, cx + k)
    val by1 = min(y1, cy + k)
    val bw = bx1 - bx0 + 1
    val seen = BooleanArray(bw * (by1 - by0 + 1))
    val stack = ArrayDeque<Int>()
    stack.addLast((cy - by0) * bw + (cx - bx0))
    seen[(cy - by0) * bw + (cx - bx0)] = true
    var n = 0
    var sx = 0.0
    var sy = 0.0
    val lo = DoubleArray(4) { Double.POSITIVE_INFINITY }
    val hi = DoubleArray(4) { Double.NEGATIVE_INFINITY }
    while (stack.isNotEmpty()) {
      val p = stack.removeLast()
      val x = bx0 + p % bw
      val y = by0 + p / bw
      n++
      sx += x
      sy += y
      val proj = doubleArrayOf(x.toDouble(), y.toDouble(), (x + y).toDouble(), (x - y).toDouble())
      for (i in 0 until 4) {
        lo[i] = min(lo[i], proj[i])
        hi[i] = max(hi[i], proj[i])
      }
      for (b in -1..1) for (a in -1..1) {
        val qx = x + a
        val qy = y + b
        if (qx < bx0 || qy < by0 || qx > bx1 || qy > by1) continue
        val q = (qy - by0) * bw + (qx - bx0)
        if (!seen[q] && bg.at(qx, qy) >= lvl) {
          seen[q] = true
          stack.addLast(q)
        }
      }
    }
    var ext = 0.0
    for (i in 0 until 4) ext = max(ext, (hi[i] - lo[i]) / (if (i < 2) 1.0 else sqrt(2.0)) + 1)
    return Triple(sx / n, sy / n, ext)
  }

  /** 8-connected components of [mask] ([w] × [h]), in raster order of their first pixel: each as its pixel indices. */
  private fun components(mask: BooleanArray, w: Int, h: Int): List<IntArray> {
    val label = BooleanArray(w * h)
    val out = ArrayList<IntArray>()
    val stack = IntArray(w * h)
    for (start in 0 until w * h) {
      if (!mask[start] || label[start]) continue
      var sp = 0
      stack[sp++] = start
      label[start] = true
      val pix = ArrayList<Int>()
      while (sp > 0) {
        val p = stack[--sp]
        pix.add(p)
        val px = p % w
        val py = p / w
        for (oy in -1..1) for (ox in -1..1) {
          val qx = px + ox
          val qy = py + oy
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue
          val q = qy * w + qx
          if (mask[q] && !label[q]) {
            label[q] = true
            stack[sp++] = q
          }
        }
      }
      out.add(pix.sorted().toIntArray())
    }
    return out
  }

  /** Bright blobs in the corridor ahead of the ball; [g], [bg] sample grids, ([bx], [by]) and [d] in samples. */
  fun candidates(g: Gray, bg: Gray, bx: Double, by: Double, d: Double, sgn: Int): List<FlightBlob> {
    val x0 = max(0.0, min(bx, bx + sgn * CORRIDOR_D * d)).toInt()
    val x1 = min(g.w.toDouble(), max(bx, bx + sgn * CORRIDOR_D * d)).toInt()
    val y0 = max(0.0, by - TAN_UP * CORRIDOR_D * d).toInt()
    val y1 = min(g.h.toDouble(), by + DOWN_D * d).toInt()
    if (x1 <= x0 || y1 <= y0) return emptyList()
    val w = x1 - x0
    val h = y1 - y0
    val mask = BooleanArray(w * h) {
      val x = x0 + it % w
      val y = y0 + it / w
      g.at(x, y) - bg.at(x, y) > DIFF_MIN
    }
    val ballArea = PI * d * d / 4
    val out = ArrayList<FlightBlob>()
    for (c in components(mask, w, h)) {
      if (c.size < AREA_MIN * ballArea || c.size > AREA_MAX * ballArea) continue
      var sx = 0.0
      var sy = 0.0
      for (p in c) {
        sx += p % w
        sy += p / w
      }
      val cx = sx / c.size + x0
      val cy = sy / c.size + y0
      val ahead = (cx - bx) * sgn
      if (ahead < 0.5 * d) continue
      if (by - cy > TAN_UP * ahead + d) continue
      out.add(FlightBlob(cx, cy, c.size))
    }
    return out
  }

  /** Does the line through the run's first and last blob pass within [ORIGIN_D] of the ball at rest? */
  private fun throughRest(run: List<Pair<Int, FlightBlob>>, bx: Double, by: Double, d: Double): Boolean {
    val a = run.first().second
    val b = run.last().second
    val l = hypot(b.x - a.x, b.y - a.y)
    if (l == 0.0) return false
    return abs((b.x - a.x) * (by - a.y) - (b.y - a.y) * (bx - a.x)) / l <= ORIGIN_D * d
  }

  /**
   * Of the runs of blobs (one per consecutive frame, a near-constant step toward the target) of at
   * least [MIN_CHAIN] whose line passes through the ball at rest ([bx], [by]), fits a straight line
   * within half a ball, moves under [maxStep] a frame and leaves the ball's spot within [LEAVE_FRAMES]
   * of [impact], the one that covers the most ground (first to last blob): the ball outruns the club
   * and the turf, and a fast ball leaves the corridor first, so neither the longest nor the fastest
   * run is it. Ties: the longer.
   */
  fun chain(
    cands: Map<Int, List<FlightBlob>>,
    d: Double,
    sgn: Int,
    bx: Double,
    by: Double,
    maxStep: Double = Double.POSITIVE_INFINITY,
    impact: Int? = null,
  ): List<Pair<Int, FlightBlob>> {
    val runs = ArrayList<List<Pair<Int, FlightBlob>>>()
    for (f0 in cands.keys.sorted()) {
      for (a in cands.getValue(f0)) {
        for (b in cands[f0 + 1] ?: emptyList()) {
          var sx = b.x - a.x
          var sy = b.y - a.y
          if (sx * sgn < d) continue
          if (-sy < -0.2 * abs(sx) || -sy > TAN_UP * abs(sx)) continue
          val run = arrayListOf(f0 to a, f0 + 1 to b)
          var f = f0 + 1
          var p = b
          while (cands.containsKey(f + 1)) {
            val px = p.x + sx
            val py = p.y + sy
            val tol = 0.25 * hypot(sx, sy) + d
            val c = cands.getValue(f + 1).filter { hypot(it.x - px, it.y - py) <= tol }.minByOrNull { hypot(it.x - px, it.y - py) } ?: break
            sx = (c.x - run[0].second.x) / (f + 1 - run[0].first)
            sy = (c.y - run[0].second.y) / (f + 1 - run[0].first)
            run.add(f + 1 to c)
            f++
            p = c
          }
          if (run.size >= MIN_CHAIN && throughRest(run, bx, by, d)) runs.add(run)
        }
      }
    }
    var best: List<Pair<Int, FlightBlob>> = emptyList()
    var bestSpan = 0.0
    for (run in runs) {
      val r = fit(run, d) ?: continue
      val v = hypot(r.vx, r.vy)
      if (r.residual > 0.5 * d || v > maxStep) continue
      if (impact != null) {
        // when the line is at the ball's spot, along its direction of travel
        val (f0, p0) = run[0]
        val t0 = f0 - ((p0.x - bx) * r.vx + (p0.y - by) * r.vy) / (v * v)
        if (abs(t0 - (impact + 0.5)) > LEAVE_FRAMES) continue
      }
      val span = hypot(run.last().second.x - run[0].second.x, run.last().second.y - run[0].second.y)
      if (best.isEmpty() || span > bestSpan + 1e-9 || (abs(span - bestSpan) <= 1e-9 && run.size > best.size)) {
        best = run
        bestSpan = span
      }
    }
    return best
  }

  /** Slope and intercept of the least-squares line v(f). */
  private fun line(f: DoubleArray, v: DoubleArray): Pair<Double, Double> {
    val mf = f.average()
    val mv = v.average()
    var num = 0.0
    var den = 0.0
    for (i in f.indices) {
      num += (f[i] - mf) * (v[i] - mv)
      den += (f[i] - mf) * (f[i] - mf)
    }
    val k = if (den == 0.0) 0.0 else num / den
    return Pair(k, mv - k * mf)
  }

  /**
   * The line through [run]; the worst point is dropped while it sits more than half a ball off the
   * line and [MIN_CHAIN] would remain (the first blob after contact can merge with the club).
   */
  fun fit(run: List<Pair<Int, FlightBlob>>, d: Double): FlightFit? {
    if (run.size < MIN_CHAIN) return null
    val pts = ArrayList(run)
    while (true) {
      val f = DoubleArray(pts.size) { pts[it].first.toDouble() }
      val (vx, x0) = line(f, DoubleArray(pts.size) { pts[it].second.x })
      val (vy, y0) = line(f, DoubleArray(pts.size) { pts[it].second.y })
      var worst = 0
      var res = -1.0
      for (i in pts.indices) {
        val e = hypot(pts[i].second.x - (vx * f[i] + x0), pts[i].second.y - (vy * f[i] + y0))
        if (e > res) {
          res = e
          worst = i
        }
      }
      if (res <= 0.5 * d || pts.size <= MIN_CHAIN) return FlightFit(vx, vy, res, pts.size, pts)
      pts.removeAt(worst)
    }
  }

  /**
   * The leading point (toward the target) of the largest moving, brighter-than-background blob in the
   * band behind the ball; sample units, null when none is big enough.
   */
  fun clubEdge(g: Gray, prev: Gray, bg: Gray, bx: Double, by: Double, d: Double, sgn: Int): Pair<Double, Double>? {
    val x0 = max(0.0, min(bx + sgn * d, bx - sgn * CLUB_BEHIND_D * d)).toInt()
    val x1 = min(g.w.toDouble(), max(bx + sgn * d, bx - sgn * CLUB_BEHIND_D * d)).toInt()
    val y0 = max(0.0, by - CLUB_BAND_UP_D * d).toInt()
    val y1 = min(g.h.toDouble(), by + CLUB_BAND_DOWN_D * d).toInt()
    if (x1 <= x0 || y1 <= y0) return null
    val w = x1 - x0
    val h = y1 - y0
    val mask = BooleanArray(w * h) {
      val x = x0 + it % w
      val y = y0 + it / w
      abs(g.at(x, y) - prev.at(x, y)) > MOVE_MIN && g.at(x, y) - bg.at(x, y) > DIFF_MIN
    }
    val big = components(mask, w, h).maxByOrNull { it.size } ?: return null
    if (big.size < CLUB_MIN_AREA * PI * d * d / 4) return null
    var lead = big[0]
    for (p in big) if ((p % w) * sgn > (lead % w) * sgn) lead = p
    return Pair((lead % w + x0).toDouble(), (lead / w + y0).toDouble())
  }

  /**
   * The impact the flight says: the frame nearest the moment its line is at the ball's spot ([bx],
   * [by]), the last one with the ball on it (as ballGoneFrame − 1); a pose-timed [impact] is off by a
   * few frames and the club fit needs the exact one.
   * Within [LEAVE_FRAMES] of [impact]; [impact] without a flight.
   */
  fun contact(fit: FlightFit?, bx: Double, by: Double, impact: Int): Int {
    if (fit == null) return impact
    val f = DoubleArray(fit.chain.size) { fit.chain[it].first.toDouble() }
    val x0 = line(f, DoubleArray(f.size) { fit.chain[it].second.x }).second
    val y0 = line(f, DoubleArray(f.size) { fit.chain[it].second.y }).second
    val t0 = ((bx - x0) * fit.vx + (by - y0) * fit.vy) / (fit.vx * fit.vx + fit.vy * fit.vy)
    return Math.rint(t0).toInt().coerceIn(impact - LEAVE_FRAMES.toInt(), impact + LEAVE_FRAMES.toInt())
  }

  /** Clubhead px per captured frame (sample units) over the [CLUB_FRAMES] before [impact], and the points used. */
  fun club(frames: Map<Int, Gray>, bg: Gray, impact: Int, bx: Double, by: Double, d: Double, sgn: Int): Pair<Double?, Int> {
    val pts = ArrayList<Triple<Int, Double, Double>>()
    for (f in impact - CLUB_FRAMES until impact) {
      val g = frames[f] ?: continue
      val prev = frames[f - 1] ?: continue
      val e = clubEdge(g, prev, bg, bx, by, d, sgn) ?: continue
      pts.add(Triple(f, e.first, e.second))
    }
    if (pts.size < 2) return Pair(null, pts.size)
    val f = DoubleArray(pts.size) { pts[it].first.toDouble() }
    val vx = line(f, DoubleArray(pts.size) { pts[it].second }).first
    val vy = line(f, DoubleArray(pts.size) { pts[it].third }).first
    return Pair(if (vx * sgn > 0) hypot(vx, vy) else null, pts.size)
  }

  /**
   * Everything from the decoded grids: [bgArea] / [bgPatch] the background frames over [rect]
   * (sampled every [step]) and over the ball's full-resolution patch, [frames] the club and flight
   * frames over [rect]. The ball guess ([bx], [by], [d]) and the result are frame px.
   */
  fun measure(
    bgArea: List<Gray>,
    bgPatch: List<Gray>,
    frames: Map<Int, Gray>,
    rect: Rect,
    step: Int,
    bx: Double,
    by: Double,
    d: Double,
    sgn: Int,
    impact: Int,
    fps: Double,
  ): SpeedRaw? {
    if (bgArea.isEmpty() || bgPatch.isEmpty()) return null
    val (x, y, dd) = diameter(median(bgPatch), bx, by, d) ?: return null
    val bg = median(bgArea)
    val sx = (x - rect.x0) / step
    val sy = (y - rect.y0) / step
    val sd = dd / step
    val cands = LinkedHashMap<Int, List<FlightBlob>>()
    for (f in impact + 1 - LEAVE_FRAMES.toInt()..impact + FLIGHT_FRAMES) frames[f]?.let { cands[f] = candidates(it, bg, sx, sy, sd, sgn) }
    val maxStep = MAX_BALL_MS * 100 * (dd / Ball.BALL_CM) / fps / step
    val raw = fit(chain(cands, sd, sgn, sx, sy, maxStep, impact), sd)
    val at = contact(raw, sx, sy, impact)
    val fit = raw?.let { r ->
      FlightFit(r.vx * step, r.vy * step, r.residual * step, r.kept,
        r.chain.map { (f, b) -> f to FlightBlob(rect.x0 + b.x * step, rect.y0 + b.y * step, b.area) })
    }
    val (club, n) = club(frames, bg, at, sx, sy, sd, sgn)
    return SpeedRaw(x, y, dd, step, fit, club?.let { it * step }, n, at)
  }
}
