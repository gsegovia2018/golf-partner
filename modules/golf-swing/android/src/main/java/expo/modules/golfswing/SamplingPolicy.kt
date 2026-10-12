package expo.modules.golfswing

import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Pass-1 sampling policy (plan §4.2, D17): sparse before the swing, every frame from motion
 * start to impact, every 2nd frame after impact until grip and nose stop, sparse after that.
 * It never decides a phase; it only decides which frames get a pose inference. Pure: fed
 * pose observations, it answers [wants] per frame and reports transitions from [observe].
 *
 * Time base: [fps] is the capture rate of one container frame step (captureFps, else 240 —
 * plan §4.2: a 30 fps slow-mo container samples like a 240 fps recording), used only to turn
 * the plan's seconds (0.5 s calibration, 0.15 s hold) into frames.
 *
 * Thresholds are per clip, from the pose jitter, never a fixed H/s constant (§4.2):
 * - σ (grip, nose) = jitter from consecutive differences over the first 0.5 s of the still
 *   run (PLAN-GAP: differences, not raw − smoothed, so a slow drift at address — the lab clip
 *   drifts ~5 px in its first 0.5 s — does not inflate σ or fire the trigger).
 * - moving = the grip is more than 3σ√2 (3σ of a difference of two noisy points) away from the
 *   median of the last 4 still samples (PLAN-GAP: a rolling reference for the same reason).
 * - stopped = the 0.15 s displacement is ≤ 3 × its 25th percentile over the still run
 *   (the lab's "stopped" statistic measured on the still samples), floored at 3σ√2.
 *
 * PLAN-GAPs (the plan's state machine is silent on these):
 * - A trigger with no rise afterwards (waggle, forward press) falls back to sparse once the
 *   grip has been stopped for 0.15 s, and the still run restarts there.
 * - Impact (end of the dense zone) = the grip has risen ≥ 0.2 H above its trigger height
 *   (H = landmark box height), then descended ≥ 0.2 H, then come back up by 0.02 H (the
 *   lab's descent segmentation tolerance). Late by a few frames at worst: only costs.
 * - The after-impact zone also ends after 1.5 s even if the golfer never holds still.
 * - The dense zone ends after 3 s of capture time even without an impact (a practice swing
 *   that never comes down, a walk-off, a pose lost mid-swing): every frame of a long clip at
 *   every-frame cost is the worst case for time. It continues as the after-impact zone, with
 *   [impactFrame] left unknown (-1).
 */
internal class SamplingPolicy(
  fps: Double,
  val sparseEvery: Int = 8,
  val afterImpactEvery: Int = 2,
  val denseEvery: Int = 1,
) {
  enum class Zone { STILL, SWING, AFTER_IMPACT, DONE }

  sealed class Event {
    object None : Event()
    /** Dense sampling starts after [frame]; frames before it lost to sparse sampling must be back-filled. */
    data class Trigger(val frame: Int) : Event()
    /** The trigger was a waggle: back to sparse from [frame]. */
    data class Reset(val frame: Int) : Event()
    data class Impact(val frame: Int) : Event()
    /** The dense zone hit its 3 s cap at [frame] without an impact. */
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
  var impactFrame = -1
    private set

  fun wants(frame: Int): Boolean {
    val every = when (zone) {
      Zone.STILL, Zone.DONE -> sparseEvery
      Zone.SWING -> denseEvery
      Zone.AFTER_IMPACT -> afterImpactEvery
    }
    return frame >= origin && (frame - origin) % every == 0
  }

  /** Feed observations in frame order; older or repeated frames are ignored. */
  fun observe(o: Obs): Event {
    if (o.frame <= lastFrame) return Event.None
    lastFrame = o.frame
    return when (zone) {
      Zone.STILL -> observeStill(o)
      Zone.SWING -> observeSwing(o)
      Zone.AFTER_IMPACT -> observeAfterImpact(o)
      Zone.DONE -> Event.None
    }
  }

  private fun observeStill(o: Obs): Event {
    if (!calibrated) calibrate(o.frame)
    if (calibrated && still.size >= 4) {
      val ref = rollingRef()
      if (o.grip.dist(ref) > moveRadius(sigmaGrip)) {
        zone = Zone.SWING
        origin = o.frame
        triggerFrame = o.frame
        refY = ref.y
        topY = o.grip.y
        bottomY = -Float.MAX_VALUE
        risen = false
        window.clear()
        window.addLast(o)
        return Event.Trigger(o.frame)
      }
    }
    still.add(o)
    return Event.None
  }

  private fun observeSwing(o: Obs): Event {
    push(o)
    if (o.frame - triggerFrame > denseMaxFrames) {
      zone = Zone.AFTER_IMPACT
      origin = o.frame
      afterFrom = o.frame
      window.clear()
      return Event.DenseCapped(o.frame)
    }
    val g = o.grip.y
    if (!risen) {
      topY = minOf(topY, g)
      if (refY - topY >= 0.2f * bodyH) {
        risen = true
      } else if (stopped(window, grip = true, noseToo = false)) {
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
      bottomY = -Float.MAX_VALUE
      return Event.None
    }
    if (g > bottomY) {
      bottomY = g
      bottomFrame = o.frame
    }
    if (bottomY - topY >= 0.2f * bodyH && g < bottomY - 0.02f * bodyH) {
      zone = Zone.AFTER_IMPACT
      origin = o.frame
      impactFrame = bottomFrame
      afterFrom = bottomFrame
      window.clear()
      return Event.Impact(bottomFrame)
    }
    return Event.None
  }

  private fun observeAfterImpact(o: Obs): Event {
    push(o)
    if (stopped(window, grip = true, noseToo = true) || o.frame - afterFrom > afterImpactMaxFrames) {
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
  private fun stopped(w: ArrayDeque<Obs>, grip: Boolean, noseToo: Boolean): Boolean {
    if (w.size < 4 || w.last().frame - w.first().frame < holdFrames - sparseEvery.coerceAtMost(holdFrames / 2)) return false
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
