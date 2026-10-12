package expo.modules.golfswing.camera

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.media.MediaRecorder

/**
 * `listRecordingModes()` (plan §3): every back camera's constrained high-speed sizes/rates
 * (Camera2 `getHighSpeedVideoSizes`, the only route to real 120/240 fps) plus the ordinary
 * MediaRecorder sizes at their best AE rate, ranked by [ModeRanking.rank]. An empty list means
 * no usable back camera; a list without `highSpeed` entries is the fallback-card case.
 */
internal object CameraModes {
  /** 16:9 only: the preview, the guide box and the portrait framing all assume it. */
  private fun isWide(w: Int, h: Int) = w * 9 == h * 16

  fun query(context: Context): List<RecordingMode> {
    val manager = context.getSystemService(CameraManager::class.java) ?: return emptyList()
    val out = ArrayList<RecordingMode>()
    for (id in manager.cameraIdList) {
      val ch = try { manager.getCameraCharacteristics(id) } catch (_: Exception) { continue }
      if (ch.get(CameraCharacteristics.LENS_FACING) != CameraMetadata.LENS_FACING_BACK) continue
      val map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: continue
      val caps = ch.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: IntArray(0)

      if (caps.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_CONSTRAINED_HIGH_SPEED_VIDEO)) {
        for (size in map.highSpeedVideoSizes) {
          if (!isWide(size.width, size.height)) continue
          val ranges = map.getHighSpeedVideoFpsRangesFor(size).map { it.lower to it.upper }
          out += ModeRanking.highSpeedModes(id, size.width, size.height, ranges)
        }
      }

      val ae = ch.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)?.map { it.lower to it.upper } ?: emptyList()
      val sizes = map.getOutputSizes(MediaRecorder::class.java) ?: emptyArray()
      for (size in sizes) {
        if (!isWide(size.width, size.height)) continue
        val minDur = map.getOutputMinFrameDuration(MediaRecorder::class.java, size)
        ModeRanking.ordinaryMode(id, size.width, size.height, minDur, ae)?.let { out += it }
      }
    }
    return ModeRanking.rank(out)
  }

  fun sensorOrientation(context: Context, cameraId: String): Int {
    val manager = context.getSystemService(CameraManager::class.java) ?: return 90
    return try {
      manager.getCameraCharacteristics(cameraId).get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
    } catch (_: Exception) {
      90
    }
  }
}
