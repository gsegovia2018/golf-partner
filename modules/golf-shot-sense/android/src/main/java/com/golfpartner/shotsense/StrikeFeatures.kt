package com.golfpartner.shotsense

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The numbers logged for each strike, read from the clip around it, and the
 * clip itself as a small WAV. Pure.
 *
 *  - peakDb: loudest sample within 20 ms of the onset, dBFS.
 *  - riseMs: 1 ms RMS envelope, from the last window 20 dB under the peak to
 *    the peak (a strike: a few ms; a voice or a slammed door: more).
 *  - decayMs: from the peak until the envelope is 20 dB under it again
 *    (capped at the clip's end).
 *  - centroidHz: spectral centroid of 1024 samples from just before the onset.
 */
object StrikeFeatures {
  data class Features(val peakDb: Double, val riseMs: Double, val decayMs: Double, val centroidHz: Double)

  fun compute(clip: ShortArray, onset: Int, sampleRate: Int): Features {
    val win = max(1, sampleRate / 1000)
    val env = DoubleArray(clip.size / win) { k ->
      var s = 0.0
      for (i in k * win until (k + 1) * win) s += clip[i].toDouble() * clip[i]
      sqrt(s / win)
    }
    val from = onset.coerceIn(0, clip.size)
    val to = min(clip.size, onset + OnsetDetector.FRAME + sampleRate / 50)
    var peak = 0
    var peakI = from
    for (i in from until to) {
      val a = abs(clip[i].toInt())
      if (a > peak) { peak = a; peakI = i }
    }
    val peakDb = 20 * log10(max(peak, 1) / 32768.0)

    val kp = (peakI / win).coerceIn(0, max(0, env.size - 1))
    var riseMs = 0.0
    var decayMs = 0.0
    if (env.isNotEmpty()) {
      val low = env[kp] * 0.1
      var k = kp
      while (k > 0 && kp - k < 50 && env[k - 1] >= low) k -= 1
      riseMs = (kp - k).toDouble() * win * 1000 / sampleRate
      k = kp
      while (k + 1 < env.size && env[k + 1] >= low) k += 1
      decayMs = (k - kp).toDouble() * win * 1000 / sampleRate
    }
    return Features(peakDb, riseMs, decayMs, centroid(clip, max(0, onset - 64), sampleRate))
  }

  private fun centroid(clip: ShortArray, start: Int, sampleRate: Int): Double {
    val n = FFT_N
    val re = DoubleArray(n)
    val im = DoubleArray(n)
    for (i in 0 until n) {
      val j = start + i
      val x = if (j < clip.size) clip[j] / 32768.0 else 0.0
      re[i] = x * (0.5 - 0.5 * cos(2 * PI * i / (n - 1)))
    }
    fft(re, im)
    var num = 0.0
    var den = 0.0
    for (k in 1 until n / 2) {
      val mag = sqrt(re[k] * re[k] + im[k] * im[k])
      num += mag * k * sampleRate / n
      den += mag
    }
    return if (den > 0) num / den else 0.0
  }

  // In-place radix-2 FFT; n must be a power of two.
  private fun fft(re: DoubleArray, im: DoubleArray) {
    val n = re.size
    var j = 0
    for (i in 1 until n) {
      var bit = n shr 1
      while (j and bit != 0) { j = j xor bit; bit = bit shr 1 }
      j = j xor bit
      if (i < j) {
        var t = re[i]; re[i] = re[j]; re[j] = t
        t = im[i]; im[i] = im[j]; im[j] = t
      }
    }
    var len = 2
    while (len <= n) {
      val ang = -2 * PI / len
      for (i in 0 until n step len) {
        for (k in 0 until len / 2) {
          val wr = cos(ang * k)
          val wi = sin(ang * k)
          val a = i + k
          val b = a + len / 2
          val xr = re[b] * wr - im[b] * wi
          val xi = re[b] * wi + im[b] * wr
          re[b] = re[a] - xr; im[b] = im[a] - xi
          re[a] += xr; im[a] += xi
        }
      }
      len = len shl 1
    }
  }

  /** Halves the sample rate: a [1 2 1]/4 low-pass, then every second sample. */
  fun decimate2(x: ShortArray): ShortArray = ShortArray(x.size / 2) { i ->
    val c = 2 * i
    val l = if (c > 0) x[c - 1].toInt() else x[c].toInt()
    val r = if (c + 1 < x.size) x[c + 1].toInt() else x[c].toInt()
    ((l + 2 * x[c] + r) / 4).toShort()
  }

  /** A mono PCM16 WAV file. */
  fun wav(pcm: ShortArray, sampleRate: Int): ByteArray {
    val data = pcm.size * 2
    val out = ByteArray(44 + data)
    fun str(at: Int, s: String) { s.forEachIndexed { i, ch -> out[at + i] = ch.code.toByte() } }
    fun i32(at: Int, v: Int) { for (b in 0 until 4) out[at + b] = (v shr (8 * b)).toByte() }
    fun i16(at: Int, v: Int) { out[at] = v.toByte(); out[at + 1] = (v shr 8).toByte() }
    str(0, "RIFF"); i32(4, 36 + data); str(8, "WAVE")
    str(12, "fmt "); i32(16, 16); i16(20, 1); i16(22, 1); i32(24, sampleRate); i32(28, sampleRate * 2); i16(32, 2); i16(34, 16)
    str(36, "data"); i32(40, data)
    for (i in pcm.indices) i16(44 + 2 * i, pcm[i].toInt())
    return out
  }

  const val FFT_N = 1024
}

/** The last [capacity] samples, addressed by absolute sample index. */
class AudioRing(private val capacity: Int) {
  private val buf = ShortArray(capacity)
  var written = 0L
    private set

  fun write(block: ShortArray, len: Int) {
    for (i in 0 until len) buf[((written + i) % capacity).toInt()] = block[i]
    written += len
  }

  /** Samples [from, from + len), or null when part of it is gone or not here yet. */
  fun read(from: Long, len: Int): ShortArray? {
    if (from < written - capacity || from < 0 || from + len > written) return null
    return ShortArray(len) { i -> buf[((from + i) % capacity).toInt()] }
  }
}
