package expo.modules.golfswing

import android.content.Context
import kotlin.math.abs
import kotlin.math.max

/** probeVideo (plan §3). */
internal object Probe {
  /** Frames decoded around the middle of the clip for the duplicate check (the swing is there). */
  private const val PROBE_FRAMES = 120
  private const val WINDOW = 60

  fun run(context: Context, path: String): Map<String, Any?> {
    val t = Media.scan(context, path)
    val start = max(0, t.frameCount / 2 - PROBE_FRAMES / 2)
    val startUs = t.firstPtsUs + (start * 1_000_000.0 / t.containerFps).toLong()
    val diffs = ArrayList<Float>()
    var prev: FloatArray? = null
    var seen = 0
    Media.decode(context, path, startUs) { _, ptsUs, img, full ->
      if (ptsUs < startUs) return@decode true
      val (w, h) = Media.cropSize(img)
      val f = YuvFrame(w, h, 0, full)
      Media.copy(img, f)
      val small = quarter(f)
      prev?.let { p -> diffs.add(meanAbsDiff(small, p)) }
      prev = small
      ++seen < PROBE_FRAMES
    }
    return mapOf(
      "width" to t.dispW,
      "height" to t.dispH,
      "durationMs" to t.durationUs / 1000.0,
      "frameCount" to t.frameCount,
      "containerFps" to t.containerFps,
      "captureFps" to Media.captureFps(context, path),
      "rotationDeg" to t.rotation,
      "duplicateFrameRatio" to duplicateRatio(diffs.toFloatArray()),
    )
  }

  /** 4 × 4 block means of the grey image (the lab diffs a quarter-size grey frame). */
  private fun quarter(f: YuvFrame): FloatArray {
    val w = f.codedW / 4
    val h = f.codedH / 4
    val out = FloatArray(w * h)
    for (by in 0 until h) for (bx in 0 until w) {
      var s = 0
      for (yy in 0 until 4) for (xx in 0 until 4) s += f.gray(bx * 4 + xx, by * 4 + yy)
      out[by * w + bx] = s / 16f
    }
    return out
  }

  private fun meanAbsDiff(a: FloatArray, b: FloatArray): Float {
    var s = 0.0
    for (i in a.indices) s += abs(a[i] - b[i])
    return (s / a.size).toFloat()
  }

  /**
   * detect.py `duplicate_frame_ratio`: in the 60-frame window with the most motion, the share
   * of consecutive-frame differences below 25 % of that window's median. A still scene
   * (median < 0.5 grey levels) is undecidable and reported as 0 (real).
   */
  fun duplicateRatio(diffs: FloatArray): Double {
    if (diffs.size < WINDOW) return 0.0
    var best = 0
    var bestSum = -1.0
    var sum = 0.0
    for (i in diffs.indices) {
      sum += diffs[i]
      if (i >= WINDOW) sum -= diffs[i - WINDOW]
      if (i >= WINDOW - 1 && sum > bestSum) {
        bestSum = sum
        best = i - WINDOW + 1
      }
    }
    val win = diffs.copyOfRange(best, best + WINDOW)
    val med = Stats.median(win)
    if (med < 0.5f) return 0.0
    return win.count { it < 0.25f * med }.toDouble() / WINDOW
  }
}
