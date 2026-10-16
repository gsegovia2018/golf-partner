package expo.modules.golfswing

import java.nio.FloatBuffer
import kotlin.math.max
import kotlin.math.min

/** One detector box: [cls] = [ClubDecode.SHAFT] / [ClubDecode.HEAD] / [ClubDecode.HANDS], corners in the caller's units. */
internal data class ClubBox(val cls: Int, val score: Double, val x1: Double, val y1: Double, val x2: Double, val y2: Double) {
  val cx get() = (x1 + x2) / 2
  val cy get() = (y1 + y2) / 2

  fun scaled(sx: Double, sy: Double) = ClubBox(cls, score, x1 * sx, y1 * sy, x2 * sx, y2 * sy)
}

/**
 * The club detector's pre- and post-processing (plan 2026-10-16 §3.4), ported from
 * tools/swing-lab/export_tflite.py `decode_nms` (= YOLOX `postprocess`). The graph already
 * decodes and sigmoids: [ROWS] × [COLS] floats per frame = cx, cy, w, h, obj, shaft, head, hands
 * in 640-px model units; NMS is ours. Pure JVM so it can be unit-tested against the lab's fixtures.
 */
internal object ClubDecode {
  const val SHAFT = 0
  const val HEAD = 1
  const val HANDS = 2
  val NAMES = listOf("shaft", "head", "hands")

  /** Model input side: the frame is stretched (not letterboxed) to SIZE × SIZE, like cv2.resize in training. */
  const val SIZE = 640
  const val ROWS = 8400
  const val COLS = 8
  const val CONF = 0.03
  const val NMS_IOU = 0.45

  /**
   * Boxes of one raw output: x1 = cx − w/2 …, cls = argmax, score = obj × max class, kept at
   * score ≥ [conf]; greedy NMS per class at [nmsIou] (torchvision batched_nms: class-wise, not
   * agnostic). Sorted by score, highest first.
   */
  fun boxes(raw: FloatArray, n: Int = ROWS, conf: Double = CONF, nmsIou: Double = NMS_IOU): List<ClubBox> {
    val byClass = Array(NAMES.size) { ArrayList<ClubBox>() }
    for (i in 0 until n) {
      val o = i * COLS
      var cls = 0
      for (c in 1 until NAMES.size) if (raw[o + 5 + c] > raw[o + 5 + cls]) cls = c
      val score = raw[o + 4].toDouble() * raw[o + 5 + cls].toDouble()
      if (score < conf) continue
      val cx = raw[o].toDouble()
      val cy = raw[o + 1].toDouble()
      val w = raw[o + 2].toDouble()
      val h = raw[o + 3].toDouble()
      byClass[cls] += ClubBox(cls, score, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
    }
    val out = ArrayList<ClubBox>()
    for (rows in byClass) {
      val sorted = rows.sortedByDescending { it.score } // stable: ties keep row order, like the lab
      val alive = BooleanArray(sorted.size) { true }
      for (i in sorted.indices) {
        if (!alive[i]) continue
        val a = sorted[i]
        out += a
        val areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
        for (j in i + 1 until sorted.size) {
          if (!alive[j]) continue
          val b = sorted[j]
          val inter = max(0.0, min(a.x2, b.x2) - max(a.x1, b.x1)) * max(0.0, min(a.y2, b.y2) - max(a.y1, b.y1))
          val union = areaA + (b.x2 - b.x1) * (b.y2 - b.y1) - inter
          if (inter / max(union, 1e-12) > nmsIou) alive[j] = false
        }
      }
    }
    return out.sortedByDescending { it.score }
  }

  /** IoU without the +1 pixel (eval_yolo.py `iou`); 0 for empty boxes. */
  fun iou(a: ClubBox, b: ClubBox): Double {
    val inter = max(0.0, min(a.x2, b.x2) - max(a.x1, b.x1)) * max(0.0, min(a.y2, b.y2) - max(a.y1, b.y1))
    val union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter
    return if (union > 0) inter / union else 0.0
  }

  /**
   * The model input from [rgb] (SIZE × SIZE × 3 bytes, R, G, B: [YuvFrame.toRgb]'s layout): floats
   * 0–255 in **B, G, R** order (the lab feeds OpenCV's BGR), no normalisation; NHWC, or NCHW when
   * [nchw] (read from the input tensor's shape, plan §3.2).
   */
  fun fill(rgb: ByteArray, dst: FloatBuffer, nchw: Boolean) {
    val px = SIZE * SIZE
    dst.rewind()
    if (nchw) {
      for (c in 0 until 3) {
        val k = 2 - c
        for (p in 0 until px) dst.put((rgb[3 * p + k].toInt() and 0xFF).toFloat())
      }
    } else {
      for (p in 0 until px) {
        val o = 3 * p
        dst.put((rgb[o + 2].toInt() and 0xFF).toFloat())
        dst.put((rgb[o + 1].toInt() and 0xFF).toFloat())
        dst.put((rgb[o].toInt() and 0xFF).toFloat())
      }
    }
    dst.rewind()
  }
}
