package expo.modules.golfswing

import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Pass-1 sampling policy "sparse165" (plan §4.2, owner decision 2026-10-12: reach the time goal
 * by inferring fewer frames). Strides:
 *
 *   STILL      every [sparseEvery] (16)  until the grip leaves its still reference (trigger)
 *   BACKSWING  every [midEvery] (4)      motion start → the top is seen
 *   DOWNSWING  every frame               from the top back-fill to impact + [margin] (6)
 *   FOLLOW     every [followEvery] (2)   → the grip and the nose stop (the finish)
 *   DONE       every [sparseEvery]
 *
 * The top is only known once the grip has come down from it, so the policy reports it late
 * ([Event.Top], ~14 frames at 240 fps on the lab clip) with the frame to back-fill from:
 * [topBack] (20) frames before the one it was seen at. The caller re-runs those frames from
 * its ring of decoded frames. The trigger likewise back-fills the 16-stride gap at the 4-stride.
 * Validated in the lab: tools/swing-lab/detect.py --sampling sparse165 mirrors this class
 * (SparsePolicy) — keep the two in step.
 *
 * It never decides a phase; it only decides which frames get a pose inference. Pure: fed pose
 * observations, it answers [wants] per frame and reports transitions from [observe].
 *
 * Time base: [fps] is the capture rate of one container frame step (captureFps, else 240 —
 * plan §4.2: a 30 fps slow-mo container samples like a 240 fps recording), used only to turn
 * the plan's seconds (0.5 s calibration, 0.15 s hold, 1.5 s / 3 s caps) into frames.
 *
 * Thresholds are per clip, from the pose jitter, never a fixed H/s constant (§4.2):
 * - σ (grip, nose) = jitter from consecutive differences over the first 0.5 s of the still
 *   run (PLAN-GAP: differences, not raw − smoothed, so a slow drift at address does not
 *   inflate σ or fire the trigger).
 * - moving = the grip is more than 3σ√2 away from the median of the last 4 still samples.
 * - top = the grip has risen ≥ 0.2 H above its trigger height and then dropped more than 3σ√2
 *   below its highest sample (H = landmark box height).
 * - stopped = the 0.15 s displacement is ≤ 3 × its 25th percentile over the still run,
 *   floored at 3σ√2.
 *
 * PLAN-GAPs:
 * - A trigger with no rise afterwards (waggle, forward press) falls back to sparse once the
 *   grip has been stopped for 0.15 s, and the still run restarts there.
 * - Impact = the grip has descended ≥ 0.2 H from the top, then come back up by 0.02 H; the
 *   frames to impact + [margin] stay dense.
 * - FOLLOW also ends 1.5 s after impact; the swing zones end 3 s after the trigger even with
 *   no impact ([Event.DenseCapped], [impactFrame] left −1).
 * - DONE is final: only the first swing in a clip gets the dense pass.
 */
internal class SamplingPolicy(
  fps: Double,
  val sparseEvery: Int = 16,
  val midEvery: Int = 4,
  val followEvery: Int = 2,
  val margin: Int = 6,
  val topBack: Int = 20,
) {
  enum class Zone { STILL, BACKSWING, DOWNSWING, FOLLOW, DONE }

  sealed class Event {
    object None : Event()
    /** Motion started at [frame]; re-run [from] … [frame] at the [SamplingPolicy.midEvery] stride. */
    data class Trigger(val frame: Int, val from: Int) : Event()
    /** The trigger was a waggle: back to sparse from [frame]. */
    data class Reset(val frame: Int) : Event()
    /** The top was seen at [frame]; re-run every frame [from] … [frame]. */
    data class Top(val frame: Int, val from: Int) : Event()
    data class Impact(val frame: Int) : Event()
    /** The swing zones hit their 3 s cap at [frame] without an impact. */
    data class DenseCapped(val frame: Int) : Event()
    data class Done(val frame: Int) : Event()
  }

  data class Obs(val frame: Int, val grip: Pt, val nose: Pt, val bodyH: Float)

  val holdFrames = max(2, ceil(0.15 * fps).toInt())
  private val calibFrames = ceil(0.5 * fps).toInt()
  private val afterImpactMaxFrames = ceil(1.5 * fps).toInt()
  private val denseMaxFrames = ceil(3.0 * fps).toInt()
  private var afterFrom = -1

  var zone = Zone.STILL
    private set
  private var origin = 0
  /** FOLLOW: every frame up to here (impact + margin), then [followEvery]. */
  private var denseUntil = -1
  private var lastFrame = -1

  private val still = ArrayList<Obs>()
  private var calibrated = false
  var sigmaGrip = Float.NaN
    private set
  private var sigmaNose = Float.NaN
  private var stopGrip = Float.NaN
  private var stopNose = Float.NaN
  var bodyH = Float.NaN
    private set

  private val window = ArrayDeque<Obs>()
  private var refY = 0f
  private var topY = Float.MAX_VALUE
  private var bottomY = -Float.MAX_VALUE
  private var bottomFrame = -1
  private var risen = false

  var triggerFrame = -1
    private set
  var topSeenFrame = -1
    private set
  var impactFrame = -1
    private set

  /** The stride of the current zone. */
  val every: Int
    get() = when (zone) {
      Zone.STILL, Zone.DONE -> sparseEvery
      Zone.BACKSWING -> midEvery
      Zone.DOWNSWING -> 1
      Zone.FOLLOW -> followEvery
    }

  fun wants(frame: Int): Boolean {
    // FOLLOW starts at impact + margin, but the frames up to it stay dense
    if (zone == Zone.FOLLOW && frame <= denseUntil) return true
    if (frame < origin) return false
    return (frame - origin) % every == 0
  }

  /** Feed observations in frame order; older or repeated frames are ignored. */
  fun observe(o: Obs): Event {
    if (o.frame <= lastFrame) return Event.None
    lastFrame = o.frame
    return when (zone) {
      Zone.STILL -> observeStill(o)
      Zone.BACKSWING -> observeBackswing(o)
      Zone.DOWNSWING -> observeDownswing(o)
      Zone.FOLLOW -> observeFollow(o)
      Zone.DONE -> Event.None
    }
  }

  private fun observeStill(o: Obs): Event {
    if (!calibrated) calibrate(o.frame)
    if (calibrated && still.size >= 4) {
      val ref = rollingRef()
      if (o.grip.dist(ref) > moveRadius(sigmaGrip)) {
        zone = Zone.BACKSWING
        origin = o.frame
        triggerFrame = o.frame
        refY = ref.y
        topY = o.grip.y
        risen = false
        window.clear()
        window.addLast(o)
        return Event.Trigger(o.frame, o.frame - (sparseEvery - midEvery))
      }
    }
    still.add(o)
    return Event.None
  }

  private fun capped(o: Obs): Event? {
    if (o.frame - triggerFrame <= denseMaxFrames) return null
    zone = Zone.FOLLOW
    origin = o.frame
    afterFrom = o.frame
    denseUntil = o.frame
    window.clear()
    return Event.DenseCapped(o.frame)
  }

  private fun observeBackswing(o: Obs): Event {
    push(o)
    capped(o)?.let { return it }
    val g = o.grip.y
    if (!risen) {
      topY = minOf(topY, g)
      if (refY - topY >= 0.2f * bodyH) {
        risen = true
      } else if (stopped(grip = true, noseToo = false)) {
        zone = Zone.STILL
        origin = o.frame
        still.clear()
        still.addAll(window)
        window.clear()
        return Event.Reset(o.frame)
      }
      return Event.None
    }
    if (g < topY) {
      topY = g
      return Event.None
    }
    if (g > topY + moveRadius(sigmaGrip)) {
      zone = Zone.DOWNSWING
      origin = o.frame
      topSeenFrame = o.frame
      bottomY = g
      bottomFrame = o.frame
      return Event.Top(o.frame, o.frame - topBack)
    }
    return Event.None
  }

  private fun observeDownswing(o: Obs): Event {
    push(o)
    capped(o)?.let { return it }
    val g = o.grip.y
    if (g < topY) {
      topY = g
      bottomY = -Float.MAX_VALUE
      return Event.None
    }
    if (g > bottomY) {
      bottomY = g
      bottomFrame = o.frame
    }
    if (bottomY - topY >= 0.2f * bodyH && g < bottomY - 0.02f * bodyH) {
      impactFrame = bottomFrame
      afterFrom = bottomFrame
      denseUntil = max(o.frame, bottomFrame + margin)
      zone = Zone.FOLLOW
      origin = denseUntil
      window.clear()
      return Event.Impact(bottomFrame)
    }
    return Event.None
  }

  private fun observeFollow(o: Obs): Event {
    push(o)
    if ((o.frame > denseUntil && stopped(grip = true, noseToo = true)) || o.frame - afterFrom > afterImpactMaxFrames) {
      zone = Zone.DONE
      origin = o.frame
      return Event.Done(o.frame)
    }
    return Event.None
  }

  private fun push(o: Obs) {
    window.addLast(o)
    while (window.size > 1 && window.first().frame < o.frame - holdFrames) window.removeFirst()
  }

  /** The window covers the hold time and its two ends (median of 3) moved less than "stopped". */
  private fun stopped(grip: Boolean, noseToo: Boolean): Boolean {
    val w = window
    if (w.size < 4 || w.last().frame - w.first().frame < holdFrames - midEvery) return false
    fun end(sel: (Obs) -> Pt, from: Int) = (from until from + 3).map { sel(w[it]) }.let { ps ->
      Pt(Stats.median(FloatArray(3) { ps[it].x }), Stats.median(FloatArray(3) { ps[it].y }))
    }
    val gOk = !grip || end({ it.grip }, 0).dist(end({ it.grip }, w.size - 3)) <= stopGrip
    val nOk = !noseToo || end({ it.nose }, 0).dist(end({ it.nose }, w.size - 3)) <= stopNose
    return gOk && nOk
  }

  private fun rollingRef(): Pt {
    val last = still.takeLast(4)
    return Pt(Stats.median(FloatArray(last.size) { last[it].grip.x }), Stats.median(FloatArray(last.size) { last[it].grip.y }))
  }

  private fun moveRadius(sigma: Float) = 3f * sqrt(2f) * sigma

  /** σ, "stopped" and H from the first 0.5 s of the still run (at least 4 samples). */
  private fun calibrate(now: Int) {
    if (still.size < 4 || (now - still.first().frame < calibFrames && still.size < calibFrames / sparseEvery)) return
    val c = still.filter { it.frame - still.first().frame <= calibFrames }.let { if (it.size >= 4) it else still }
    bodyH = Stats.median(FloatArray(c.size) { c[it].bodyH })
    val floor = max(0.5f, 0.003f * bodyH)
    fun sigma(sel: (Obs) -> Pt) = max(
      floor,
      max(
        Stats.diffSigma(FloatArray(c.size) { sel(c[it]).x }),
        Stats.diffSigma(FloatArray(c.size) { sel(c[it]).y }),
      ),
    )
    sigmaGrip = sigma { it.grip }
    sigmaNose = sigma { it.nose }
    // 0.15 s displacement between still samples that far apart (P25 × 3, the lab's "stopped")
    val lag = max(1, Math.round(holdFrames.toFloat() / sparseEvery))
    fun stop(sel: (Obs) -> Pt, sigma: Float): Float {
      val d = FloatArray(max(0, c.size - lag)) { sel(c[it]).dist(sel(c[it + lag])) }
      val p25 = if (d.isEmpty()) 0f else Stats.percentile(d, 25.0)
      return max(3f * p25, moveRadius(sigma))
    }
    stopGrip = stop({ it.grip }, sigmaGrip)
    stopNose = stop({ it.nose }, sigmaNose)
    calibrated = true
  }
}
