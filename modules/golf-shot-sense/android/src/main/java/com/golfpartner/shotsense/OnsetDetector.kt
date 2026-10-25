package com.golfpartner.shotsense

import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.sin

/**
 * Finds sharp transients (a club striking a ball) in mono PCM16 audio.
 *
 * 1.5 kHz high-pass, then energy per [FRAME] samples (2.9 ms at 44.1 kHz). A
 * frame is an onset when it is [RISE_DB] over a slow background estimate,
 * [JUMP_DB] over the frame before it (a strike rises within a millisecond; a
 * gust of wind or a passing cart does not), above [FLOOR_DB], and at least
 * [REFRACTORY_MS] after the previous onset. The background rises slowly and
 * falls fast, so a strike does not lift it for the next one.
 *
 * Pure: fed blocks of samples, returns onsets by absolute sample index (the
 * start of the onset frame). shortcut: the thresholds are uncalibrated; the
 * clips the service keeps are what will tune them.
 */
class OnsetDetector(private val sampleRate: Int = SAMPLE_RATE) {
  data class Onset(val sample: Long, val frameDb: Double, val bgDb: Double)

  private val hp = Biquad.highPass(sampleRate, HP_HZ)
  private val refractory = (REFRACTORY_MS * sampleRate / 1000.0).toLong()
  private var acc = 0.0
  private var n = 0
  private var processed = 0L
  private var frameStart = 0L
  private var bg = Double.NaN
  private var prev = Double.NaN
  private var lastOnset = Long.MIN_VALUE / 2

  fun feed(block: ShortArray, len: Int = block.size): List<Onset> {
    var out: MutableList<Onset>? = null
    for (i in 0 until len) {
      if (n == 0) frameStart = processed
      val y = hp.process(block[i] / 32768.0)
      acc += y * y
      n += 1
      processed += 1
      if (n < FRAME) continue
      val db = 10 * log10(acc / FRAME + 1e-12)
      acc = 0.0
      n = 0
      if (bg.isNaN()) bg = db
      if (prev.isNaN()) prev = db
      if (db - bg >= RISE_DB && db - prev >= JUMP_DB && db >= FLOOR_DB && frameStart - lastOnset >= refractory) {
        (out ?: mutableListOf<Onset>().also { out = it }).add(Onset(frameStart, db, bg))
        lastOnset = frameStart
      }
      bg += (if (db > bg) UP else DOWN) * (db - bg)
      prev = db
    }
    return out ?: emptyList()
  }

  companion object {
    const val SAMPLE_RATE = 44100
    const val FRAME = 128
    const val HP_HZ = 1500.0
    const val RISE_DB = 18.0
    const val JUMP_DB = 9.0
    const val FLOOR_DB = -50.0
    const val REFRACTORY_MS = 300.0
    // Per-frame smoothing of the background (344 frames a second).
    const val UP = 0.002
    const val DOWN = 0.02
  }
}

/** One RBJ biquad section, direct form I. */
class Biquad(
  private val b0: Double, private val b1: Double, private val b2: Double,
  private val a1: Double, private val a2: Double,
) {
  private var x1 = 0.0
  private var x2 = 0.0
  private var y1 = 0.0
  private var y2 = 0.0

  fun process(x: Double): Double {
    val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1; x1 = x
    y2 = y1; y1 = y
    return y
  }

  companion object {
    fun highPass(sampleRate: Int, f0: Double, q: Double = 0.7071): Biquad {
      val w0 = 2 * Math.PI * f0 / sampleRate
      val alpha = sin(w0) / (2 * q)
      val c = cos(w0)
      val a0 = 1 + alpha
      return Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - alpha) / a0)
    }
  }
}
