package com.golfpartner.shotsense

/**
 * The last few seconds of one motion magnitude (gyroscope rad/s, or the
 * accelerometer's distance from 1 g), timestamped in elapsed-realtime ns, so
 * a strike can ask "did the phone swing around then?". Pure.
 */
class MotionWindow(private val capacity: Int = 512) {
  private val ts = LongArray(capacity)
  private val vs = FloatArray(capacity)
  private var count = 0L

  fun add(tNs: Long, value: Float) {
    val i = (count % capacity).toInt()
    ts[i] = tNs
    vs[i] = value
    count += 1
  }

  /** The largest value in [fromNs, toNs], 0 when none is held. */
  fun peak(fromNs: Long, toNs: Long): Float {
    var best = 0f
    val n = minOf(count, capacity.toLong()).toInt()
    for (k in 0 until n) {
      val i = ((count - 1 - k) % capacity).toInt()
      if (ts[i] in fromNs..toNs && vs[i] > best) best = vs[i]
    }
    return best
  }
}

/**
 * Swings from the gyroscope: a burst over [threshold] rad/s is one swing,
 * reported at its peak once the rate falls under half the threshold. Bursts
 * within [refractoryNs] of the last swing's peak belong to it (the follow
 * through, a twirl of the club). A practice swing is a swing too: the strike
 * is what tells them apart. shortcut: threshold uncalibrated. Pure.
 */
class SwingDetector(
  private val threshold: Float = 3f,
  private val refractoryNs: Long = 2_000_000_000L,
) {
  data class Swing(val tNs: Long, val peak: Float)

  private var inBurst = false
  private var peak = 0f
  private var peakT = 0L
  private var lastSwing = Long.MIN_VALUE / 2

  fun feed(tNs: Long, gyro: Float): Swing? {
    if (!inBurst) {
      if (gyro < threshold) return null
      inBurst = true
      peak = gyro
      peakT = tNs
      return null
    }
    if (gyro > peak) { peak = gyro; peakT = tNs }
    if (gyro >= threshold / 2) return null
    inBurst = false
    if (peakT - lastSwing < refractoryNs) return null
    lastSwing = peakT
    return Swing(peakT, peak)
  }
}
