package expo.modules.golfswing

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.google.mediapipe.framework.image.ByteBufferImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.TreeMap
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

internal class AnalyzeOptions(
  val model: String,
  val sparseEvery: Int,
  val afterImpactEvery: Int,
  val denseEvery: Int,
  val rightHanded: Boolean,
  val heightCm: Double,
)

/**
 * analyzePose (plan §3, §4.1–4.3): one sequential decode; pose on the frames the
 * [SamplingPolicy] wants; the ball found once the club has left it; ballGoneFrame.
 *
 * Threads: this one decodes, copies each frame into an 8-frame ring (the back-fill source,
 * §4.2), converts wanted frames to RGB and queues them (bounded, 4) for the pose thread, so
 * decoding overlaps inference inside the swing. Before the trigger (still zone) each sparse
 * sample is waited for: the trigger must be known before the next frame leaves the ring.
 *
 * Back-fill vs VIDEO mode: MediaPipe's VIDEO mode needs increasing timestamps and tracks
 * between calls, so the frames before the trigger can't go through the instance that has
 * already seen the trigger frame. The trigger switches to a spare instance (created up front)
 * that runs the ring from trigger − 7 onwards, the trigger frame again included.
 */
internal class PoseAnalyzer(
  private val context: Context,
  private val opts: AnalyzeOptions,
  private val cancelled: () -> Boolean,
  private val progress: (stage: String, done: Int, total: Int) -> Unit,
) {
  companion object {
    const val TAG = "GolfSwing"
    private const val RING = 8
    private const val QUEUE = 4
    /** Long side fed to the pose model; the lab clip (850) goes in at full size. */
    private const val MAX_SIDE = 960
    private const val SEARCH_MARGIN_CM = 8.0
  }

  private class Result(val frame: Int, val ptsUs: Long, val norm: FloatArray?, val error: Throwable? = null)

  private lateinit var track: TrackInfo
  private lateinit var policy: SamplingPolicy
  private lateinit var worker: PoseWorker
  private val ring = arrayOfNulls<YuvFrame>(RING)
  private var cur = -1
  private var outW = 0
  private var outH = 0
  private val samples = TreeMap<Int, PoseSample>()
  private val norm = TreeMap<Int, FloatArray>()
  private val events = ArrayDeque<SamplingPolicy.Event>()
  private var inFlight = 0
  private var blockedNs = 0L
  private var stillFrom = 0

  // ball search state (fixed at the trigger, from the still address samples)
  private val strips = HashMap<Int, Gray>()
  private var stripRect: Rect? = null
  private var halfScale = false
  private var ws = 1.0
  private var addressHands: Pt? = null
  private var addressRoi: Rect? = null
  private var expDWork = 0.0

  fun run(path: String): Map<String, Any?> {
    val t0 = SystemClock.elapsedRealtimeNanos()
    track = Media.scan(context, path)
    val captureFps = Media.captureFps(context, path)
    policy = SamplingPolicy(captureFps ?: 240.0, opts.sparseEvery, opts.afterImpactEvery, opts.denseEvery)
    val scale = min(1.0, MAX_SIDE.toDouble() / max(track.dispW, track.dispH))
    outW = (track.dispW * scale).roundToInt()
    outH = (track.dispH * scale).roundToInt()
    ws = if (min(track.dispW, track.dispH) >= 720) 0.5 else 1.0
    halfScale = ws == 0.5

    worker = PoseWorker(loadModel(), rgbRowBytes(outW) * outH)
    worker.start()
    val total = track.frameCount
    val step = max(1, total / 50)
    try {
      Media.decode(context, path, 0) { n, ptsUs, img, full ->
        if (cancelled()) throw CancelledException()
        val slot = n % RING
        val f = ring[slot]?.takeIf { it.codedW == Media.cropSize(img).first && it.codedH == Media.cropSize(img).second }
          ?: Media.cropSize(img).let { (w, h) -> YuvFrame(w, h, track.rotation, full) }
        ring[slot] = f
        Media.copy(img, f)
        f.frame = n
        f.ptsUs = ptsUs
        cur = n
        stripRect?.let { strips[n] = f.grayStrip(it, halfScale) }
        settle(block = false)
        if (policy.wants(n)) {
          submit(f, fresh = false)
          // still zone: wait, so a trigger at n is known while n − 7 … n are in the ring
          if (policy.zone == SamplingPolicy.Zone.STILL) settle(block = true)
        }
        if (n % step == 0) {
          progress("decode", n + 1, total)
          progress("pose", (samples.lastEntry()?.key ?: -1) + 1, total)
        }
        true
      }
      settle(block = true)
    } finally {
      worker.stopAndJoin()
    }
    val totalNs = SystemClock.elapsedRealtimeNanos() - t0
    progress("pose", total, total)

    val list = samples.values.toList()
    val ball = findBall(list)
    val timings = mapOf(
      "decodeMs" to ((totalNs - blockedNs).coerceAtLeast(0) / 1e6).roundToInt(),
      "inferMs" to (worker.inferNs / 1e6).roundToInt(),
      "totalMs" to (totalNs / 1e6).roundToInt(),
      "inferences" to worker.inferences,
      "delegate" to worker.delegate,
    )
    Log.i(
      TAG,
      "analyzePose frames=$total inferences=${worker.inferences} withPose=${samples.size} trigger=${policy.triggerFrame} " +
        "impact~${policy.impactFrame} sigma=${policy.sigmaGrip} bodyH=${policy.bodyH} createMs=${worker.createNs / 1_000_000} " +
        "ball=${ball.first} ballGone=${ball.second} timings=$timings",
    )
    return mapOf(
      "video" to mapOf(
        "width" to track.dispW,
        "height" to track.dispH,
        "containerFps" to track.containerFps,
        "frameCount" to total,
      ),
      "frames" to norm.map { (i, lm) ->
        mapOf(
          "i" to i,
          "tMs" to samples[i]!!.ptsUs / 1000.0,
          "lm" to List(Lm.COUNT) { j ->
            doubleArrayOf(round5(lm[3 * j]), round5(lm[3 * j + 1]), round5(lm[3 * j + 2]))
          },
        )
      },
      "ball" to ball.first,
      "ballGoneFrame" to ball.second,
      "timings" to timings,
    )
  }

  private fun round5(v: Float) = Math.round(v * 100000.0) / 100000.0

  private fun loadModel(): ByteBuffer {
    val name = "pose_landmarker_${opts.model}.task"
    val bytes = try {
      context.assets.open(name).use { it.readBytes() }
    } catch (e: java.io.IOException) {
      throw IllegalArgumentException("model '${opts.model}' is not bundled", e)
    }
    return ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply {
      put(bytes)
      rewind()
    }
  }

  private fun submit(f: YuvFrame, fresh: Boolean) {
    val buf = worker.takeBuffer { blockedNs += it }
    f.toRgb(outW, outH, buf)
    worker.put(Job.Frame(f.frame, f.ptsUs, buf, fresh)) { blockedNs += it }
    inFlight++
  }

  /** Consumes pose results (all in flight when [block]) and acts on the policy's transitions. */
  private fun settle(block: Boolean) {
    var mustDrain = block
    while (true) {
      while (true) {
        val r = if (mustDrain && inFlight > 0) worker.awaitResult { blockedNs += it } else worker.pollResult() ?: break
        inFlight--
        consume(r)
        if (mustDrain && inFlight == 0) break
      }
      val e = events.removeFirstOrNull() ?: return
      when (e) {
        is SamplingPolicy.Event.Trigger -> onTrigger(e.frame)
        is SamplingPolicy.Event.Reset -> {
          Log.i(TAG, "sampling reset at ${e.frame} (no swing after the trigger)")
          strips.clear()
          stripRect = null
          stillFrom = e.frame
          worker.put(Job.Spare) { blockedNs += it }
          mustDrain = true
        }
        is SamplingPolicy.Event.Impact -> Log.i(TAG, "dense zone ends, impact ~${e.frame}")
        is SamplingPolicy.Event.Done -> {
          Log.i(TAG, "after-impact zone ends at ${e.frame}")
          stripRect = null
        }
        SamplingPolicy.Event.None -> Unit
      }
    }
  }

  private fun consume(r: Result) {
    r.error?.let { throw it }
    val lm = r.norm ?: return
    val px = FloatArray(lm.size)
    for (j in 0 until Lm.COUNT) {
      px[3 * j] = lm[3 * j] * track.dispW
      px[3 * j + 1] = lm[3 * j + 1] * track.dispH
      px[3 * j + 2] = lm[3 * j + 2]
    }
    val s = PoseSample(r.frame, r.ptsUs, px)
    samples[r.frame] = s
    norm[r.frame] = lm
    val e = policy.observe(SamplingPolicy.Obs(r.frame, Grip.point(s), Pt(s.x(Lm.NOSE), s.y(Lm.NOSE)), s.bodyHeight()))
    if (e != SamplingPolicy.Event.None) events.addLast(e)
  }

  private fun onTrigger(m: Int) {
    Log.i(TAG, "sampling trigger at $m (decoded up to $cur)")
    startStrips(m)
    val from = max(m - (opts.sparseEvery - 1), cur - (RING - 1)).coerceAtLeast(0)
    var first = true
    for (f in from..cur) {
      val yuv = ring[f % RING] ?: continue
      if (yuv.frame != f) continue
      stripRect?.let { if (f !in strips) strips[f] = yuv.grayStrip(it, halfScale) }
      submit(yuv, fresh = first)
      first = false
    }
  }

  /** Fixes the ball-search geometry from the still address samples (lab ROI + margin for the patch). */
  private fun startStrips(m: Int) {
    val still = samples.subMap(stillFrom, m).values.toList().takeLast(16)
    if (still.isEmpty()) return
    fun med(sel: (PoseSample) -> Float) = Stats.median(FloatArray(still.size) { sel(still[it]) })
    val right = opts.rightHanded
    val toe = if (right) Lm.L_TOE else Lm.R_TOE
    val grips = still.map { Grip.point(it) }
    val hands = Pt(Stats.median(FloatArray(grips.size) { grips[it].x }), Stats.median(FloatArray(grips.size) { grips[it].y }))
    val ankleY = med { (it.y(Lm.L_ANK) + it.y(Lm.R_ANK)) / 2 }
    val pxCm = Ball.pxPerCm(still, right, opts.heightCm)
    expDWork = Ball.BALL_CM * pxCm * ws
    val workW = (track.dispW * ws).roundToInt()
    val workH = (track.dispH * ws).roundToInt()
    val roi = Ball.roi(med { it.x(toe) }, ankleY, hands.x, if (right) 1 else -1, track.dispW, track.dispH, ws, workW, workH)
    val margin = ceil(SEARCH_MARGIN_CM * pxCm * ws).toInt()
    addressRoi = roi
    addressHands = Pt((hands.x * ws).toFloat(), (hands.y * ws).toFloat())
    stripRect = Rect(max(0, roi.x0 - margin), max(0, roi.y0 - margin), min(workW, roi.x1 + margin), min(workH, roi.y1 + margin))
      .takeIf { !roi.isEmpty() }
  }

  /** Ball on three frames between lead-arm level and the hands' top, then ballGoneFrame. */
  private fun findBall(list: List<PoseSample>): Pair<Map<String, Any?>?, Int?> {
    val roi = addressRoi ?: return Pair(null, null)
    val hands = addressHands ?: return Pair(null, null)
    if (policy.triggerFrame < 0) return Pair(null, null)
    val end = if (policy.impactFrame >= 0) policy.impactFrame else list.last().frame
    val win = BallWindow.find(list, policy.triggerFrame, end, opts.rightHanded) ?: return Pair(null, null)
    val mid = (win.leadArm + win.handsTop) / 2
    val frames = listOf(win.leadArm, mid, win.handsTop).distinct().mapNotNull { strips[it] }
    val b = Ball.detect(frames, roi, hands, if (opts.rightHanded) 1 else -1, expDWork, ws) ?: run {
      Log.i(TAG, "ball not found in ${win.leadArm}..${win.handsTop}")
      return Pair(null, null)
    }
    val gone = Ball.goneFrame(strips, b.x * ws, b.y * ws, expDWork, (win.leadArm + 1)..win.handsTop, win.handsTop)
    Log.i(TAG, "ball search window ${win.leadArm}..${win.handsTop}: $b gone=$gone")
    val ball = mapOf(
      "x" to b.x / track.dispW,
      "y" to b.y / track.dispH,
      "r" to b.r / track.dispW,
      "conf" to b.conf,
      "frame" to mid,
    )
    return Pair(ball, gone)
  }

  /** The pose thread: owns the landmarkers (current + spare), GPU first with CPU fallback. */
  private inner class PoseWorker(private val model: ByteBuffer, bufBytes: Int) : Thread("golf-swing-pose") {
    private val jobs = ArrayBlockingQueue<Job>(QUEUE)
    private val results = LinkedBlockingQueue<Result>()
    private val pool = ArrayBlockingQueue<ByteBuffer>(QUEUE + 2).apply {
      repeat(QUEUE + 2) { add(ByteBuffer.allocateDirect(bufBytes)) }
    }
    @Volatile private var failure: Throwable? = null
    @Volatile var delegate = "gpu"
    @Volatile var inferNs = 0L
    @Volatile var inferences = 0
    @Volatile var createNs = 0L
    private var current: PoseLandmarker? = null
    private var spare: PoseLandmarker? = null
    private var lastTs = Long.MIN_VALUE

    private fun create(): PoseLandmarker {
      val t = SystemClock.elapsedRealtimeNanos()
      fun build(d: Delegate) = PoseLandmarker.createFromOptions(
        context,
        PoseLandmarker.PoseLandmarkerOptions.builder()
          .setBaseOptions(BaseOptions.builder().setModelAssetBuffer(model.duplicate()).setDelegate(d).build())
          .setRunningMode(RunningMode.VIDEO)
          .setNumPoses(1)
          .build(),
      )
      val lm = if (delegate == "gpu") {
        try {
          build(Delegate.GPU)
        } catch (e: Throwable) {
          Log.w(TAG, "GPU delegate unavailable, using CPU", e)
          delegate = "cpu"
          build(Delegate.CPU)
        }
      } else {
        build(Delegate.CPU)
      }
      createNs += SystemClock.elapsedRealtimeNanos() - t
      return lm
    }

    override fun run() {
      try {
        current = create()
        spare = create()
        while (true) {
          when (val j = jobs.take()) {
            is Job.Frame -> runFrame(j)
            Job.Spare -> if (spare == null) spare = create()
            Job.Stop -> break
          }
        }
      } catch (e: Throwable) {
        failure = e
        results.put(Result(-1, 0, null, e))
      } finally {
        current?.close()
        spare?.close()
      }
    }

    private fun runFrame(j: Job.Frame) {
      if (j.fresh) {
        current?.close()
        current = spare ?: create()
        spare = null
        lastTs = Long.MIN_VALUE
      }
      val ts = max(Math.round(j.ptsUs / 1000.0), lastTs + 1)
      lastTs = ts
      val img = ByteBufferImageBuilder(j.rgb, outW, outH, MPImage.IMAGE_FORMAT_RGB).build()
      val t = SystemClock.elapsedRealtimeNanos()
      val res = try {
        current!!.detectForVideo(img, ts)
      } catch (e: RuntimeException) {
        if (delegate != "gpu") throw e
        // a GPU that builds but fails to run: start over on the CPU, this frame first
        Log.w(TAG, "GPU inference failed, switching to CPU", e)
        delegate = "cpu"
        current?.close()
        spare?.close()
        spare = null
        current = create()
        lastTs = ts
        current!!.detectForVideo(img, ts)
      }
      inferNs += SystemClock.elapsedRealtimeNanos() - t
      inferences++
      pool.put(j.rgb)
      val pose = res.landmarks().firstOrNull()
      val out = pose?.let { p ->
        FloatArray(Lm.COUNT * 3).also { a ->
          for (k in 0 until Lm.COUNT) {
            val l = p[k]
            a[3 * k] = l.x()
            a[3 * k + 1] = l.y()
            a[3 * k + 2] = l.visibility().orElse(0f)
          }
        }
      }
      results.put(Result(j.frame, j.ptsUs, out))
    }

    fun put(job: Job, blocked: (Long) -> Unit) = waitFor(blocked) { jobs.offer(job, 50, TimeUnit.MILLISECONDS).takeIf { it } }
    fun takeBuffer(blocked: (Long) -> Unit): ByteBuffer = waitFor(blocked) { pool.poll(50, TimeUnit.MILLISECONDS) }
    fun awaitResult(blocked: (Long) -> Unit): Result = waitFor(blocked) { results.poll(50, TimeUnit.MILLISECONDS) }
    fun pollResult(): Result? = results.poll()

    private fun <T : Any> waitFor(blocked: (Long) -> Unit, attempt: () -> T?): T {
      val t = SystemClock.elapsedRealtimeNanos()
      try {
        while (true) {
          attempt()?.let { return it }
          failure?.let { throw it }
          if (!isAlive) throw IllegalStateException("pose thread stopped")
        }
      } finally {
        blocked(SystemClock.elapsedRealtimeNanos() - t)
      }
    }

    fun stopAndJoin() {
      if (isAlive) {
        try {
          put(Job.Stop) {}
        } catch (_: Throwable) {
        }
        join(5_000)
      }
    }
  }

  private sealed class Job {
    class Frame(val frame: Int, val ptsUs: Long, val rgb: ByteBuffer, val fresh: Boolean) : Job()
    object Spare : Job()
    object Stop : Job()
  }
}
