package expo.modules.golfswing

import android.content.Context
import kotlin.math.abs

/**
 * probeVideo (plan §3): container facts only, no decoding, so the processing screen can show
 * the clip line at once. The duplicate-frame check needs decoded frames and moved into
 * analyzePose (which decodes every frame anyway): probeVideo reports duplicateFrameRatio null.
 */
internal object Probe {
  private const val WINDOW = 60

  fun run(context: Context, path: String): Map<String, Any?> {
    val t = Media.scan(context, path)
    return mapOf(
      "width" to t.dispW,
      "height" to t.dispH,
      "durationMs" to t.durationUs / 1000.0,
      "frameCount" to t.frameCount,
      "containerFps" to t.containerFps,
      "captureFps" to Media.captureFps(context, path),
      "rotationDeg" to t.rotation,
      "hdr" to t.hdr,
      "duplicateFrameRatio" to null,
    )
  }

  fun meanAbsDiff(a: FloatArray, b: FloatArray): Float {
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
