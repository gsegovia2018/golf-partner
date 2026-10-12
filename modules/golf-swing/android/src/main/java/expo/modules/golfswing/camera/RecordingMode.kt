package expo.modules.golfswing.camera

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * One way the phone can record (plan §3 `listRecordingModes`). [fps] is the fixed rate the
 * file is recorded at. [recordMin] / [previewMin] are the lower ends of the AE target ranges
 * used while recording and while only previewing; for a high-speed mode the recording range
 * is always the fixed [fps, fps] and the preview may use a variable [30, fps] range.
 */
data class RecordingMode(
  val cameraId: String,
  val width: Int,
  val height: Int,
  val fps: Int,
  val highSpeed: Boolean,
  val recordMin: Int = fps,
  val previewMin: Int = fps,
) {
  fun toMap(): Map<String, Any> = mapOf(
    "cameraId" to cameraId,
    "width" to width,
    "height" to height,
    "fps" to fps,
    "highSpeed" to highSpeed,
  )

  fun matches(cameraId: String, width: Int, height: Int, fps: Int, highSpeed: Boolean) =
    this.cameraId == cameraId && this.width == width && this.height == height && this.fps == fps && this.highSpeed == highSpeed
}

/** The JVM-pure part of mode selection, unit-tested in RecordingModeTest. */
internal object ModeRanking {
  private const val MAX_LONG = 1920
  private const val MAX_SHORT = 1080
  private const val TARGET_SHORT = 720

  /** ≤ 1080p: the analysis decodes every frame, so more pixels only cost time (plan §3, §4.1). */
  fun fits(width: Int, height: Int) = max(width, height) <= MAX_LONG && min(width, height) <= MAX_SHORT

  /**
   * Best first: the highest fps, then a high-speed session over an ordinary one at the same
   * rate, then the size closest to 720p (impact sharpness matters more than pixels: 720p240
   * beats 1080p120, and at equal fps 720p decodes faster), then the camera order the phone
   * reports (its main back camera first). One entry per size/fps/kind.
   */
  fun rank(modes: List<RecordingMode>): List<RecordingMode> = modes
    .filter { fits(it.width, it.height) && it.fps > 0 }
    .sortedWith(
      compareByDescending<RecordingMode> { it.fps }
        .thenByDescending { it.highSpeed }
        .thenBy { abs(min(it.width, it.height) - TARGET_SHORT) }
    )
    .distinctBy { listOf(it.width, it.height, it.fps, it.highSpeed) }

  /** Fixed-rate high-speed ranges ([fps, fps], ≥ 120) and the widest preview range for the same top rate. */
  fun highSpeedModes(cameraId: String, width: Int, height: Int, ranges: List<Pair<Int, Int>>): List<RecordingMode> =
    ranges.filter { (lo, hi) -> lo == hi && hi >= 120 }.map { (_, hi) ->
      val previewMin = ranges.filter { (lo, top) -> top == hi && lo < top }.minOfOrNull { it.first } ?: hi
      RecordingMode(cameraId, width, height, hi, highSpeed = true, recordMin = hi, previewMin = previewMin)
    }

  /**
   * The ordinary-session mode for one size: the AE range with the highest top that the size can
   * deliver (1e9 / min frame duration), preferring a fixed range at that top. null if none fits.
   */
  fun ordinaryMode(cameraId: String, width: Int, height: Int, minFrameDurationNs: Long, ranges: List<Pair<Int, Int>>): RecordingMode? {
    val sizeMax = if (minFrameDurationNs > 0) (1e9 / minFrameDurationNs + 0.5).toInt() else Int.MAX_VALUE
    val best = ranges.filter { it.second <= sizeMax }
      .maxWithOrNull(compareBy<Pair<Int, Int>> { it.second }.thenBy { it.first }) ?: return null
    return RecordingMode(cameraId, width, height, best.second, highSpeed = false, recordMin = best.first, previewMin = best.first)
  }
}
