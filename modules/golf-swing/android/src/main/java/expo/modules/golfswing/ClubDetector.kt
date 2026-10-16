package expo.modules.golfswing

import android.content.Context
import android.os.SystemClock
import android.util.Log
import org.json.JSONObject
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.gpu.CompatibilityList
import org.tensorflow.lite.gpu.GpuDelegate
import java.io.FileInputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import kotlin.math.abs
import kotlin.math.max

/**
 * The learned club detector (plan 2026-10-16 §3–4): YOLOX-tiny fine-tuned on the Golf Club
 * Tracking dataset, `club_yolox_tiny_v1.tflite` (fp32: LiteRT 1.4's XNNPACK splits an fp16-weight
 * graph into ~116 partitions, 2× slower on a Pixel 8 Pro) on the LiteRT interpreter: the GPU
 * delegate where LiteRT's compatibility list allows it, else CPU (XNNPACK) with [THREADS] threads.
 * One instance per pass 2, used from one thread; [close] frees the interpreter and the delegate.
 * Pre- and post-processing are [ClubDecode] / [ClubRules].
 */
internal class ClubDetector private constructor(
  private val interpreter: Interpreter,
  private val nchw: Boolean,
  private val gpu: GpuDelegate?,
) : AutoCloseable {
  /** 'gpu' or 'cpu': what this instance runs on (timings.clubDelegate). */
  val delegate: String get() = if (gpu != null) "gpu" else "cpu"

  companion object {
    const val MODEL = "club_yolox_tiny_v1"
    private const val THREADS = 4
    private const val FIXTURES = "club"

    /** Loads the model (mapped from the APK when stored uncompressed) and checks its I/O shapes. */
    fun open(context: Context): ClubDetector {
      val model = try {
        context.assets.openFd("$MODEL.tflite").use { fd ->
          FileInputStream(fd.fileDescriptor).channel.use { it.map(FileChannel.MapMode.READ_ONLY, fd.startOffset, fd.declaredLength) }
        }
      } catch (e: IOException) {
        // a compressed asset cannot be mapped: read it into a direct buffer instead
        val bytes = context.assets.open("$MODEL.tflite").use { it.readBytes() }
        ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply {
          put(bytes)
          rewind()
        }
      }
      // GPU first (MediaPipe already runs pose there); any failure to build it falls back to CPU
      var gpu: GpuDelegate? = null
      val interp = try {
        val compat = CompatibilityList()
        if (!compat.isDelegateSupportedOnThisDevice) throw UnsupportedOperationException("gpu not on the compatibility list")
        gpu = GpuDelegate(compat.bestOptionsForThisDevice)
        Interpreter(model, Interpreter.Options().addDelegate(gpu))
      } catch (e: Throwable) {
        gpu?.close()
        gpu = null
        Log.i(PoseAnalyzer.TAG, "club detector on cpu: ${e.message}")
        Interpreter(model, Interpreter.Options().setNumThreads(THREADS))
      }
      try {
        val s = ClubDecode.SIZE
        val inShape = interp.getInputTensor(0).shape().toList()
        val nchw = when (inShape) {
          listOf(1, s, s, 3) -> false
          listOf(1, 3, s, s) -> true
          else -> throw IllegalStateException("club model input $inShape")
        }
        val outShape = interp.getOutputTensor(0).shape().toList()
        check(outShape == listOf(1, ClubDecode.ROWS, ClubDecode.COLS)) { "club model output $outShape" }
        return ClubDetector(interp, nchw, gpu)
      } catch (e: Throwable) {
        interp.close()
        gpu?.close()
        throw e
      }
    }

    /**
     * Debug builds only (plan §3.5): the lab's golden inputs (`assets/club/<clip>.input.bin`, the
     * module's test resources merged into debug assets) through the real interpreter, compared
     * with the lab's boxes (`<clip>.boxes.json`, Python TFLite): every lab box and every box we
     * find above 0.08 must pair up at IoU ≥ 0.9 and score ± 0.05 (fp16 + XNNPACK vs fp32).
     */
    fun selfTest(context: Context): Map<String, Any?> {
      val clips = (context.assets.list(FIXTURES) ?: emptyArray()).filter { it.endsWith(".input.bin") }.map { it.removeSuffix(".input.bin") }.sorted()
      val rows = ArrayList<Map<String, Any?>>()
      var delegate = "cpu"
      open(context).use { d ->
        delegate = d.delegate
        for (clip in clips) {
          val bgr = context.assets.open("$FIXTURES/$clip.input.bin").use { it.readBytes() }
          val rgb = ByteArray(bgr.size)
          for (p in 0 until bgr.size / 3) {
            rgb[3 * p] = bgr[3 * p + 2]
            rgb[3 * p + 1] = bgr[3 * p + 1]
            rgb[3 * p + 2] = bgr[3 * p]
          }
          val t = SystemClock.elapsedRealtime()
          val raw = d.infer(rgb)
          val ms = SystemClock.elapsedRealtime() - t
          val got = ClubDecode.boxes(raw)
          val json = JSONObject(context.assets.open("$FIXTURES/$clip.boxes.json").use { String(it.readBytes()) }).getJSONArray("boxes640")
          val want = (0 until json.length()).map { i ->
            val b = json.getJSONObject(i)
            ClubBox(b.getInt("cls"), b.getDouble("score"), b.getDouble("x1"), b.getDouble("y1"), b.getDouble("x2"), b.getDouble("y2"))
          }
          var worstIou = 1.0
          var worstScore = 0.0
          var unpaired = 0
          fun pair(a: ClubBox, others: List<ClubBox>) {
            val m = others.filter { it.cls == a.cls }.maxByOrNull { ClubDecode.iou(a, it) }
            val iou = m?.let { ClubDecode.iou(a, it) } ?: 0.0
            if (m == null || iou < 0.9 || abs(m.score - a.score) > 0.05) unpaired++
            worstIou = minOf(worstIou, iou)
            if (m != null) worstScore = max(worstScore, abs(m.score - a.score))
          }
          want.forEach { pair(it, got) }
          got.filter { it.score > 0.08 }.forEach { pair(it, want) }
          val rawDiff = try {
            val fb = ByteBuffer.wrap(context.assets.open("$FIXTURES/$clip.raw.bin").use { it.readBytes() }).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
            var m = 0.0
            for (i in raw.indices) m = max(m, abs(raw[i] - fb.get(i)).toDouble())
            m
          } catch (e: IOException) {
            null
          }
          rows += mapOf(
            "clip" to clip, "passed" to (unpaired == 0), "expected" to want.size, "found" to got.size,
            "unpaired" to unpaired, "worstIou" to worstIou, "worstScoreDiff" to worstScore, "maxRawDiff" to rawDiff, "ms" to ms.toInt(),
          )
        }
      }
      val out = mapOf("passed" to (rows.isNotEmpty() && rows.all { it["passed"] == true }), "model" to MODEL, "delegate" to delegate, "clips" to rows)
      Log.i(PoseAnalyzer.TAG, "clubSelfTest $out")
      return out
    }
  }

  private val input = ByteBuffer.allocateDirect(4 * ClubDecode.SIZE * ClubDecode.SIZE * 3).order(ByteOrder.nativeOrder())
  private val output = ByteBuffer.allocateDirect(4 * ClubDecode.ROWS * ClubDecode.COLS).order(ByteOrder.nativeOrder())

  /** The raw [1, ROWS, COLS] output for one SIZE × SIZE RGB frame ([YuvFrame.toRgb] at 640 × 640). */
  fun infer(rgb: ByteArray): FloatArray {
    ClubDecode.fill(rgb, input.asFloatBuffer(), nchw)
    input.rewind()
    output.rewind()
    interpreter.run(input, output)
    output.rewind()
    val fb = output.asFloatBuffer()
    return FloatArray(fb.remaining()).also { fb.get(it) }
  }

  /** Boxes of one frame in 640-px model units, after decode + NMS. */
  fun detect(rgb: ByteArray): List<ClubBox> = ClubDecode.boxes(infer(rgb))

  override fun close() {
    interpreter.close()
    gpu?.close()
  }
}
