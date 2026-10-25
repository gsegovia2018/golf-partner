package com.golfpartner.shotsense

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

class ShotSenseTest {
  private val sr = OnsetDetector.SAMPLE_RATE

  // Low background noise, with a strike-like click (fast attack, ~5 ms ring
  // at 4 kHz) at each of `clicks` (sample indices).
  private fun audio(seconds: Double, clicks: List<Int>, noise: Double = 60.0, amp: Double = 16000.0): ShortArray {
    val rnd = Random(7)
    val x = DoubleArray((seconds * sr).toInt()) { rnd.nextGaussian() * noise }
    for (c in clicks) {
      for (i in 0 until sr / 20) {
        if (c + i >= x.size) break
        x[c + i] += amp * exp(-i / (0.005 * sr)) * sin(2 * PI * 4000 * i / sr)
      }
    }
    return ShortArray(x.size) { x[it].coerceIn(-32768.0, 32767.0).toInt().toShort() }
  }

  private fun feedAll(d: OnsetDetector, a: ShortArray): List<OnsetDetector.Onset> {
    val out = mutableListOf<OnsetDetector.Onset>()
    var i = 0
    while (i < a.size) {
      val n = minOf(2048, a.size - i)
      out += d.feed(a.copyOfRange(i, i + n), n)
      i += n
    }
    return out
  }

  @Test fun findsEachStrikeOnce() {
    val clicks = listOf(sr, (2.5 * sr).toInt())
    val onsets = feedAll(OnsetDetector(), audio(4.0, clicks))
    assertEquals(2, onsets.size)
    onsets.zip(clicks).forEach { (o, c) -> assertTrue("onset ${o.sample} near $c", kotlin.math.abs(o.sample - c) <= OnsetDetector.FRAME) }
  }

  @Test fun quietAudioHasNoOnsets() {
    assertEquals(0, feedAll(OnsetDetector(), audio(3.0, emptyList())).size)
  }

  @Test fun slowSwellIsNotAStrike() {
    // Wind-like: noise whose level ramps up 30 dB over a second.
    val rnd = Random(3)
    val a = ShortArray(3 * sr) { i ->
      val g = 30.0 * Math.pow(10.0, 1.5 * (i.toDouble() / sr).coerceAtMost(1.0))
      (rnd.nextGaussian() * g).coerceIn(-32768.0, 32767.0).toInt().toShort()
    }
    assertEquals(0, feedAll(OnsetDetector(), a).size)
  }

  @Test fun featuresDescribeAStrike() {
    val clip = audio(1.0, listOf(sr / 2))
    val f = StrikeFeatures.compute(clip, sr / 2, sr)
    assertTrue("peak ${f.peakDb}", f.peakDb > -10 && f.peakDb <= 0)
    assertTrue("rise ${f.riseMs}", f.riseMs <= 3)
    assertTrue("decay ${f.decayMs}", f.decayMs in 5.0..40.0)
    assertTrue("centroid ${f.centroidHz}", f.centroidHz in 2500.0..6000.0)
  }

  @Test fun wavHeaderAndDecimation() {
    val pcm = ShortArray(100) { (it * 10).toShort() }
    val half = StrikeFeatures.decimate2(pcm)
    assertEquals(50, half.size)
    assertEquals(20.toShort(), half[1])
    val wav = StrikeFeatures.wav(half, 22050)
    assertEquals(44 + 100, wav.size)
    assertEquals("RIFF", String(wav, 0, 4))
    assertEquals("WAVE", String(wav, 8, 4))
    assertEquals(22050, (wav[24].toInt() and 0xff) or ((wav[25].toInt() and 0xff) shl 8) or ((wav[26].toInt() and 0xff) shl 16))
  }

  @Test fun ringReadsOnlyWhatItHolds() {
    val r = AudioRing(10)
    r.write(ShortArray(15) { it.toShort() }, 15)
    assertNull(r.read(2, 4))
    assertEquals(listOf<Short>(6, 7, 8), r.read(6, 3)!!.toList())
    assertNull(r.read(13, 4))
  }

  @Test fun motionPeakInRange() {
    val w = MotionWindow(8)
    for (i in 0 until 12) w.add(i * 10L, i.toFloat())
    assertEquals(9f, w.peak(0, 95), 0f)
    assertEquals(0f, w.peak(0, 30), 0f) // pushed out of the window
  }

  @Test fun oneSwingPerBurst() {
    val d = SwingDetector(threshold = 3f, refractoryNs = 2_000_000_000L)
    val ms = 1_000_000L
    val rates = listOf(0f, 2f, 4f, 9f, 6f, 1f, 0f)
    val swings = rates.mapIndexedNotNull { i, g -> d.feed(i * 10 * ms, g) }
    assertEquals(1, swings.size)
    assertEquals(9f, swings[0].peak, 0f)
    assertEquals(30 * ms, swings[0].tNs)
    // A second burst 1 s later is the same swing (follow-through).
    assertNull(listOf(5f, 1f).mapIndexedNotNull { i, g -> d.feed(1000 * ms + i * 10 * ms, g) }.firstOrNull())
    // 3 s later: a new swing.
    assertNotNull(listOf(5f, 1f).mapIndexedNotNull { i, g -> d.feed(3000 * ms + i * 10 * ms, g) }.firstOrNull())
  }
}
