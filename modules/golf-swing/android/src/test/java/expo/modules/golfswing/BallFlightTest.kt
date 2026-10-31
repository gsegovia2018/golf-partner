package expo.modules.golfswing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.math.atan2
import kotlin.math.hypot

/**
 * Synthetic face-on frames (the same cases as src/swing/web/core/__tests__/ballFlight.test.js): grass
 * with a texture, a ball lit from above (top half white, bottom half grey), launched toward +x at
 * [LAUNCH] degrees, [V] px a frame; the clubhead a bright block sliding in along the ground.
 */
class BallFlightTest {
  private val w = 480
  private val h = 240
  private val bx = 80.0
  private val by = 200.0
  private val d = 14.0
  private val impact = 20

  private companion object {
    const val V = 32.0
    const val LAUNCH = 20.0
    const val CLUB_V = 24.0
  }

  private fun grass(x: Int, y: Int) = 90 + ((x * 7 + y * 13) % 11)

  /** The frame [f], frame px; [rest] draws the ball at rest, [flying] in flight, [clubAt] the head's leading x. */
  private fun frame(f: Int, sgn: Int = 1, restX: Double = bx, turf: Boolean = false): Gray {
    val px = ByteArray(w * h)
    val ball: Pair<Double, Double>? = when {
      f <= impact -> Pair(restX, by)
      else -> {
        val k = f - impact
        Pair(restX + sgn * V * k * Math.cos(Math.toRadians(LAUNCH)), by - V * k * Math.sin(Math.toRadians(LAUNCH)))
      }
    }
    val cx = if (f in impact - 4..impact) restX - sgn * CLUB_V * (impact - f) - sgn * d / 2 else null
    for (y in 0 until h) for (x in 0 until w) {
      var v = grass(x, y)
      if (ball != null && hypot(x - ball.first, y - ball.second) <= d / 2) v = if (y <= ball.second) 245 else 120
      // flying turf: a bright clump leaving the ball's spot slowly along the ground
      if (turf && f > impact && hypot(x - (restX + sgn * 10.0 * (f - impact)), y - (by - 1.5 * (f - impact))) <= d / 2) v = 220
      if (cx != null && y in (by - 1.2 * d).toInt()..(by + 0.4 * d).toInt() && (x - cx) * sgn in -1.6 * d..0.0) v = 230
      px[y * w + x] = v.toByte()
    }
    return Gray(0, 0, w, h, px)
  }

  private fun sampled(g: Gray, r: Rect, step: Int): Gray {
    val nx = (r.w + step - 1) / step
    val ny = (r.h + step - 1) / step
    val out = ByteArray(nx * ny)
    for (j in 0 until ny) for (i in 0 until nx) out[j * nx + i] = g.px[(r.y0 + j * step) * w + r.x0 + i * step]
    return Gray(0, 0, nx, ny, out)
  }

  private fun patch(g: Gray, r: Rect): Gray {
    val out = ByteArray(r.w * r.h)
    for (j in 0 until r.h) for (i in 0 until r.w) out[j * r.w + i] = g.px[(r.y0 + j) * w + r.x0 + i]
    return Gray(r.x0, r.y0, r.w, r.h, out)
  }

  private fun run(step: Int, sgn: Int = 1, ballX: Double = bx, turf: Boolean = false, guess: Int = impact): SpeedRaw? {
    val top = 5
    val n = 40
    val rect = BallFlight.area(ballX, by, d, sgn, w, h)
    val pr = BallFlight.patch(ballX, by, d, w, h)
    val bgF = BallFlight.bgFrames(top, n).map { frame(it, sgn, ballX, turf) }
    val frames = (BallFlight.clubFrames(guess, n) + BallFlight.flightFrames(guess, n)).associateWith { sampled(frame(it, sgn, ballX, turf), rect, step) }
    return BallFlight.measure(bgF.map { sampled(it, rect, step) }, bgF.map { patch(it, pr) }, frames, rect, step, ballX, by, d * 1.2, sgn, guess, 240.0)
  }

  @Test
  fun aHalfLitBallMeasuresItsWholeDiameter() {
    val pr = BallFlight.patch(bx, by, d, w, h)
    val g = frame(0)
    for (guess in listOf(0.8 * d, d, 1.25 * d)) {
      val (x, y, dd) = BallFlight.diameter(patch(g, pr), bx + 2, by - 1, guess)!!
      assertEquals("diameter from a guess of $guess", d, dd, 1.0)
      assertEquals(bx, x, 1.0)
      assertEquals(by - d / 4, y, 1.5) // the bright half's centroid
    }
  }

  @Test
  fun theFlightGivesSpeedAndLaunch() {
    val r = run(1)
    assertNotNull(r)
    val b = r!!.ball!!
    assertEquals(V, hypot(b.vx, b.vy), V * 0.02)
    assertEquals(LAUNCH, Math.toDegrees(atan2(-b.vy, b.vx)), 1.0)
    assertEquals(d, r.d, 1.0)
  }

  @Test
  fun sampledEveryOtherPixelReadsTheSame() {
    val r = run(2)!!
    assertEquals(V, hypot(r.ball!!.vx, r.ball!!.vy), V * 0.03)
    assertEquals(CLUB_V, r.club!!, CLUB_V * 0.1)
  }

  @Test
  fun theClubheadComesInBehindTheBall() {
    val r = run(1)!!
    assertNotNull(r.club)
    assertEquals(CLUB_V, r.club!!, CLUB_V * 0.05)
    assertEquals(3, r.clubPoints)
  }

  @Test
  fun aLeftHanderMirrors() {
    val r = run(1, sgn = -1, ballX = 400.0)!!
    val b = r.ball!!
    assertEquals(V, hypot(b.vx, b.vy), V * 0.02)
    assertEquals(LAUNCH, Math.toDegrees(atan2(-b.vy, -b.vx)), 1.0)
    assertEquals(CLUB_V, r.club!!, CLUB_V * 0.05)
  }

  @Test
  fun theBallNotTheTurfThatLeavesItsSpotWithIt() {
    val b = run(1, turf = true)!!.ball!!
    assertEquals(V, hypot(b.vx, b.vy), V * 0.02)
  }

  @Test
  fun aPoseImpactAFewFramesOffIsTimedByTheFlight() {
    for (guess in listOf(impact - 3, impact + 3)) {
      val r = run(1, guess = guess)!!
      assertEquals(impact, r.contact)
      assertEquals(V, hypot(r.ball!!.vx, r.ball!!.vy), V * 0.02)
      assertEquals(CLUB_V, r.club!!, CLUB_V * 0.05)
    }
  }

  @Test
  fun noBallInFlightMeansNoBallSpeed() {
    val top = 5
    val n = 40
    val rect = BallFlight.area(bx, by, d, 1, w, h)
    val pr = BallFlight.patch(bx, by, d, w, h)
    val still = frame(0)
    val bg = BallFlight.bgFrames(top, n).map { still }
    val frames = BallFlight.flightFrames(impact, n).associateWith { sampled(still, rect, 1) }
    val r = BallFlight.measure(bg.map { sampled(it, rect, 1) }, bg.map { patch(it, pr) }, frames, rect, 1, bx, by, d, 1, impact, 240.0)!!
    assertNull(r.ball)
    assertNull(r.club)
  }

  @Test
  fun stepKeepsTheBallNearEightSamples() {
    assertEquals(1, BallFlight.step(12.0))
    assertEquals(2, BallFlight.step(17.0))
    assertEquals(3, BallFlight.step(24.0))
  }
}
