package expo.modules.golfswing

import kotlin.math.hypot
import kotlin.math.sin

/**
 * Where to look for the ball (plan §4.3, D17): after the club has left it — from the lead
 * arm reaching level in the backswing to the hands' highest point — the club is in the air
 * and the scene around the ball is static. Native never decides phases (§2.3); this is only
 * a conservative search window, so it uses the hands' highest point (the START of the top
 * plateau, never later than the JS `top`) and the d15 lead-arm rule on lightly filtered
 * series (5-sample median instead of the zero-lag One-Euro: the window only bounds a search).
 */
internal object BallWindow {
  data class Window(val leadArm: Int, val handsTop: Int)

  private const val LEVEL_TOL_DEG = 5.0

  /** [samples] in frame order; the swing runs from [startFrame] to [endFrame] (the policy's impact). */
  fun find(samples: List<PoseSample>, startFrame: Int, endFrame: Int, rightHanded: Boolean): Window? {
    if (samples.size < 5) return null
    val grip = median5(Grip.gatedSeries(samples, Grip.K))
    val mid = Grip.gatedSeries(samples, null)
    val leadSh = if (rightHanded) Lm.L_SH else Lm.R_SH
    val leadWr = if (rightHanded) Lm.L_WR else Lm.R_WR
    val trailSh = if (rightHanded) Lm.R_SH else Lm.L_SH
    val trailWr = if (rightHanded) Lm.R_WR else Lm.L_WR
    // arm end = the wrist blended with the gated wrist midpoint by its visibility (d15 arm_end)
    fun end(wr: Int) = median5(Array(samples.size) {
      val s = samples[it]
      val v = s.vis(wr).coerceIn(0f, 1f)
      Pt(v * s.x(wr) + (1 - v) * mid[it].x, v * s.y(wr) + (1 - v) * mid[it].y)
    })
    fun joint(j: Int) = median5(Array(samples.size) { Pt(samples[it].x(j), samples[it].y(j)) })
    val lead = end(leadWr)
    val trail = end(trailWr)
    val ls = joint(leadSh)
    val ts = joint(trailSh)
    val armPx = maxOf(
      Stats.percentile(FloatArray(samples.size) { hypot(lead[it].x - ls[it].x, lead[it].y - ls[it].y) }, 95.0),
      Stats.percentile(FloatArray(samples.size) { hypot(trail[it].x - ts[it].x, trail[it].y - ts[it].y) }, 95.0),
    )
    val band = armPx * sin(Math.toRadians(LEVEL_TOL_DEG)).toFloat()

    val inSwing = samples.indices.filter { samples[it].frame in startFrame..endFrame }
    if (inSwing.size < 3) return null
    val top = inSwing.minByOrNull { grip[it].y } ?: return null
    val lead0 = inSwing.firstOrNull { it <= top && lead[it].y - ls[it].y <= band }
    val leadArm = lead0?.let { samples[it].frame } ?: ((samples[inSwing.first()].frame + samples[top].frame) / 2)
    val handsTop = samples[top].frame
    return if (handsTop > leadArm) Window(leadArm, handsTop) else null
  }

  private fun median5(p: Array<Pt>): Array<Pt> = Array(p.size) { i ->
    val lo = maxOf(0, i - 2)
    val hi = minOf(p.size - 1, i + 2)
    val n = hi - lo + 1
    Pt(Stats.median(FloatArray(n) { p[lo + it].x }), Stats.median(FloatArray(n) { p[lo + it].y }))
  }
}
