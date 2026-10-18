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
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

internal class AnalyzeOptions(
  val model: String,
  val sparseEvery: Int,
  val midEvery: Int,
  val followEvery: Int,
  val rightHanded: Boolean,
  val heightCm: Double,
  /** The sampling policy's time base (§4.2); null = the file's capture-rate tag, else 240. */
  val captureFps: Double? = null,
)

/**
 * analyzePose (plan §3, §4.1–4.3): one sequential decode; pose on the frames the
 * [SamplingPolicy] wants; the ball found once the club has left it; ballGoneFrame.
 *
 * Threads: this one decodes and copies frames into a ring of up to 32 (the back-fill source,
 * §4.2; 48 MB cap), converts wanted frames to RGBA (rows split over [CONVERT_THREADS]) and
 * queues them (bounded, 4) for the pose thread, so decoding overlaps inference.
 *
 * Back-fill (sparse165, see [SamplingPolicy]): two transitions are only seen after the frames
 * they concern — the trigger (motion start, seen on a 16-stride sample: re-run m − 12 … at the
 * 4-stride) and the top (seen ~14 frames late: re-run every frame from m − 20). So while a
 * back-fill can still come (still and backswing zones) every frame is copied into the ring and
 * decoding runs ahead of the last settled sample by at most ring − lookback frames. Samples
 * submitted ahead of a back-fill belong to the old epoch and their results are dropped (the
 * spare re-runs them). From the downswing on, only the wanted frames are copied. A ring
 * shorter than the lookback (1080p: 15 frames) back-fills what it holds.
 *
 * Back-fill vs VIDEO mode: MediaPipe's VIDEO mode needs increasing timestamps and tracks
 * between calls, so earlier frames can't go through the instance that has already seen later
 * ones. Each back-fill switches to a spare instance (built on its own thread while the current
 * one infers) that runs the ring from the back-fill frame on, the transition frame included;
 * the trigger asks for the next spare, for the top.
 */
internal class PoseAnalyzer(
  private val context: Context,
  private val opts: AnalyzeOptions,
  private val cancelled: () -> Boolean,
  private val progress: (stage: String, done: Int, total: Int) -> Unit,
) {
  companion object {
    const val TAG = "GolfSwing"
    /** Memory budget of the back-fill ring (decoded YUV frames). */
    private const val RING_BYTES = 48 shl 20
    private const val RING_MAX = 32
    /** Long side fed to the pose model (its crops are 256 px; the lab clip goes in at 850). */
    private const val MAX_SIDE = 960
    /** Threads converting a model input frame (the decode thread is one of them). */
    private const val CONVERT_THREADS = 3
    private const val QUEUE = 4
    /** Strip margin around the ball ROI: ballGoneFrame reads ±(3.1 diameters + 2 px) ≈ 13.3 cm around the ball. */
    private const val SEARCH_MARGIN_CM = 14.0
    /** Hint-session target per inference: below what it takes, so the clocks stay up (see [PerfHint]). */
    private const val HINT_TARGET_NS = 12_000_000L
  }

  private class Result(val frame: Int, val ptsUs: Long, val norm: FloatArray?, val epoch: Int, val error: Throwable? = null)

  private lateinit var track: TrackInfo
  private lateinit var policy: SamplingPolicy
  /** Capture rate of one container frame step (the policy's time base): ballGoneFrame's "for 0.1 s". */
  private var fps = 240.0
  private lateinit var worker: PoseWorker
  private lateinit var bands: BandRunner
  private lateinit var hint: PerfHint
  /** Threads of the process before the analysis: everything newer is ours or MediaPipe's. */
  private var baseTids: Set<Int> = emptySet()
  private var hintThreads = 0
  private var ringSize = 8
  private lateinit var ring: Array<YuvFrame?>
  private var cur = -1
  private var lastSubmitted = -1
  val prof = Prof()
  /** Bumped at each trigger: results still in flight from before it are stale. */
  private var epoch = 0
  private val inFlightFrames = ArrayDeque<Int>()
  private var prevQuarter: FloatArray? = null
  private var quarterBuf: FloatArray? = null
  private var diffs = FloatArray(0)
  private var nDiffs = 0
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
  private var stripStep = 1
  private var ws = 1.0
  private var addressHands: Pt? = null
  private var addressRoi: Rect? = null
  private var expDWork = 0.0

  fun run(path: String): Map<String, Any?> {
    val t0 = SystemClock.elapsedRealtimeNanos()
    track = Media.scan(context, path)
    val captureFps = opts.captureFps ?: Media.captureFps(context, path)
    fps = captureFps ?: 240.0
    policy = SamplingPolicy(fps, opts.sparseEvery, opts.midEvery, opts.followEvery)
    val scale = min(1.0, MAX_SIDE.toDouble() / max(track.dispW, track.dispH))
    outW = (track.dispW * scale).roundToInt()
    outH = (track.dispH * scale).roundToInt()
    val decim = Media.decimation(track.dispW, track.dispH)
    // work scale (§4.3): half resolution from 720p up, and never finer than the kept frame
    ws = min(if (min(track.dispW, track.dispH) >= 720) 0.5 else 1.0, 1.0 / decim)
    stripStep = (1.0 / (ws * decim)).roundToInt()
    val frameBytes = track.dispW / decim * (track.dispH / decim) * 3 / 2
    ringSize = max(opts.sparseEvery, min(RING_MAX, RING_BYTES / max(1, frameBytes)))
    ring = arrayOfNulls(ringSize)
    diffs = FloatArray(track.frameCount + 16)

    val total = track.frameCount
    val step = max(1, total / 50)
    val oldPriority = android.os.Process.getThreadPriority(android.os.Process.myTid())
    hint = PerfHint(context, HINT_TARGET_NS)
    try {
      PerfHint.raiseThisThread()
      baseTids = PerfHint.processTids()
      hint.add(listOf(android.os.Process.myTid()))
      worker = PoseWorker(loadModel(), 4 * outW * outH)
      worker.start()
      bands = BandRunner(CONVERT_THREADS) { tid -> hint.add(listOf(tid)) }
      Media.decode(context, path, 0, cancelled, prof) { n, ptsUs, img, full ->
        if (img == null) return@decode true
        cur = n
        prof.time("dup") { duplicateDiff(img, full) }
        // Frames that may be back-filled, or need a ball strip, are copied; from the downswing
        // on only the wanted ones are (nothing is back-filled there).
        val copied = if (lookback() >= 0 || stripRect != null || policy.wants(n)) {
          val (fw, fh) = Media.frameSize(img)
          val slot = n % ringSize
          val f = ring[slot]?.takeIf { it.codedW == fw && it.codedH == fh && it.fullRange == full }
            ?: YuvFrame(fw, fh, track.rotation, full)
          ring[slot] = f
          prof.time("copy") { Media.copy(img, f) }
          f.frame = n
          f.ptsUs = ptsUs
          stripRect?.let { r -> prof.time("strips") { strips[n] = f.grayStrip(r, stripStep) } }
          f
        } else {
          null
        }
        settle(block = false)
        // (a trigger handled just above has already re-submitted everything up to n)
        if (copied != null && policy.wants(n) && n > lastSubmitted) submit(copied, fresh = false)
        // a back-fill found at sample m re-runs m − lookback … from the ring, so no frame that
        // could still be needed may be overwritten: settle the samples that old first
        while (true) {
          val back = lookback()
          if (back < 0 || inFlightFrames.isEmpty() || inFlightFrames.first() > n + 1 - ringSize + back) break
          settleOne()
        }
        if (n % step == 0) {
          progress("decode", n + 1, total)
          progress("pose", (samples.lastEntry()?.key ?: -1) + 1, total)
        }
        true
      }
      settle(block = true)
    } finally {
      if (::worker.isInitialized) worker.stopAndJoin()
      if (::bands.isInitialized) bands.shutdown()
      hintThreads = if (hint.active()) hint.threads() else 0
      hint.close()
      try {
        android.os.Process.setThreadPriority(oldPriority)
      } catch (_: Throwable) {
      }
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
      "createMs" to (worker.createNs / 1e6).roundToInt(),
      "stagesMs" to prof.ms() + worker.prof.ms(),
      "ring" to ringSize,
      "inputSize" to "${outW}x$outH",
      "hintThreads" to hintThreads,
    )
    Log.i(
      TAG,
      "analyzePose frames=$total inferences=${worker.inferences} withPose=${samples.size} trigger=${policy.triggerFrame} " +
        "topSeen=${policy.topSeenFrame} " +
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
      "duplicateFrameRatio" to Probe.duplicateRatio(diffs.copyOf(nDiffs)),
      "timings" to timings,
    )
  }

  /** Frames a back-fill found now could reach behind its sample (−1: none can come). */
  private fun lookback(): Int = when (policy.zone) {
    SamplingPolicy.Zone.STILL -> policy.sparseEvery - policy.midEvery
    SamplingPolicy.Zone.BACKSWING -> policy.topBack
    else -> -1
  }.let { if (it < 0) it else min(it, ringSize - policy.midEvery) }

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

  /** Consecutive-frame difference of the quarter-size grey (detect.py duplicate_frame_ratio input). */
  private fun duplicateDiff(img: android.media.Image, full: Boolean) {
    val q = Media.quarterGray(img, full, quarterBuf)
    val p = prevQuarter
    if (p != null && p.size == q.size && nDiffs < diffs.size) diffs[nDiffs++] = Probe.meanAbsDiff(q, p)
    quarterBuf = p
    prevQuarter = q
  }

  private fun submit(f: YuvFrame, fresh: Boolean) {
    val buf = worker.takeBuffer { blockedNs += it }
    prof.time("convert") {
      f.toRgba(outW, outH, buf, bands)
    }
    worker.put(Job.Frame(f.frame, f.ptsUs, buf, fresh, epoch)) { blockedNs += it }
    lastSubmitted = f.frame
    inFlight++
    inFlightFrames.addLast(f.frame)
  }

  /** Waits for and consumes the oldest result in flight, then acts on the transitions. */
  private fun settleOne() {
    if (inFlight == 0) return
    take(worker.awaitResult { blockedNs += it })
    handleEvents()
  }

  private fun take(r: Result) {
    inFlight--
    inFlightFrames.removeFirstOrNull()
    consume(r)
  }

  /** Consumes pose results (all in flight when [block]) and acts on the policy's transitions. */
  private fun settle(block: Boolean) {
    while (true) {
      val r = if (block && inFlight > 0) worker.awaitResult { blockedNs += it } else worker.pollResult() ?: break
      take(r)
      if (handleEvents()) {
        // a Reset re-creates the spare: drain so the switch happens between known frames
        while (inFlight > 0) take(worker.awaitResult { blockedNs += it }).also { handleEvents() }
      }
      if (inFlight == 0 && block) break
    }
  }

  /** Runs queued transitions; true when the caller must drain what is in flight. */
  private fun handleEvents(): Boolean {
    var mustDrain = false
    while (true) {
      val e = events.removeFirstOrNull() ?: return mustDrain
      when (e) {
        is SamplingPolicy.Event.Trigger -> {
          Log.i(TAG, "sampling trigger at ${e.frame} (decoded up to $cur)")
          startStrips(e.frame)
          backfill(e.frame, e.from, policy.midEvery)
          // the next back-fill (the top) gets its own fresh instance
          worker.put(Job.Spare) { blockedNs += it }
        }
        is SamplingPolicy.Event.Top -> {
          Log.i(TAG, "top seen at ${e.frame} (decoded up to $cur), dense from ${e.from}")
          backfill(e.frame, e.from, 1)
        }
        is SamplingPolicy.Event.Reset -> {
          Log.i(TAG, "sampling reset at ${e.frame} (no swing after the trigger)")
          strips.clear()
          stripRect = null
          stillFrom = e.frame
          worker.put(Job.Spare) { blockedNs += it }
          mustDrain = true
        }
        is SamplingPolicy.Event.Impact -> Log.i(TAG, "dense zone ends, impact ~${e.frame}")
        is SamplingPolicy.Event.DenseCapped -> Log.i(TAG, "dense zone capped at ${e.frame}, no impact seen")
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
    // sparse samples decoded ahead of a trigger: the fresh instance re-runs them in order
    if (r.epoch != epoch) return
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

  /**
   * Re-runs the ring from [want] (clamped to what it holds) to the decoder's position on a
   * fresh instance: the frames on [m]'s [stride] grid. Ball strips are filled for every frame.
   */
  private fun backfill(m: Int, want: Int, stride: Int) {
    epoch++
    val from = max(want, cur - (ringSize - 1)).coerceAtLeast(0)
    if (from > want) Log.i(TAG, "back-fill wanted $want, the ring holds from $from")
    var first = true
    for (f in from..cur) {
      val yuv = ring[f % ringSize] ?: continue
      if (yuv.frame != f) continue
      stripRect?.let { if (f !in strips) strips[f] = yuv.grayStrip(it, stripStep) }
      if (Math.floorMod(f - m, stride) != 0) continue
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
    val gone = Ball.goneFrame(strips, b.x * ws, b.y * ws, expDWork, win.leadArm..win.handsTop, win.handsTop, fps)
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
    val prof = Prof()
    @Volatile var inferNs = 0L
    @Volatile var inferences = 0
    @Volatile var createNs = 0L
    private var current: PoseLandmarker? = null
    /** The back-fill instance, built on its own thread while this one already infers. */
    private var spare: Future<PoseLandmarker>? = null
    private val spareThread = Executors.newSingleThreadExecutor { Thread(it, "golf-swing-spare").apply { isDaemon = true } }
    private var lastTs = Long.MIN_VALUE

    private fun startSpare() {
      if (spare == null) spare = spareThread.submit<PoseLandmarker> { create() }
    }

    /** The spare (waiting for it if still building), or a new instance. */
    private fun takeSpare(): PoseLandmarker {
      val t = SystemClock.elapsedRealtimeNanos()
      val f = spare
      spare = null
      val lm = try {
        f?.get()
      } catch (e: ExecutionException) {
        throw e.cause ?: e
      } ?: create()
      createNs += SystemClock.elapsedRealtimeNanos() - t
      return lm
    }

    private fun closeSpare() {
      val f = spare ?: return
      spare = null
      try {
        f.get()?.close()
      } catch (_: Throwable) {
      }
    }

    private fun create(): PoseLandmarker {
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
      return lm
    }

    override fun run() {
      try {
        PerfHint.raiseThisThread()
        val t = SystemClock.elapsedRealtimeNanos()
        current = create()
        createNs += SystemClock.elapsedRealtimeNanos() - t
        startSpare()
        while (true) {
          when (val j = jobs.take()) {
            is Job.Frame -> runFrame(j)
            Job.Spare -> startSpare()
            Job.Stop -> break
          }
        }
      } catch (_: InterruptedException) {
        // shutdown (stopAndJoin / module destroyed)
      } catch (e: Throwable) {
        failure = e
        results.put(Result(-1, 0, null, -1, e))
      } finally {
        current?.close()
        closeSpare()
        spareThread.shutdownNow()
      }
    }

    private fun runFrame(j: Job.Frame) {
      if (j.fresh) {
        current?.close()
        current = null
        current = takeSpare()
        lastTs = Long.MIN_VALUE
      }
      val ts = max(Math.round(j.ptsUs / 1000.0), lastTs + 1)
      lastTs = ts
      val img = prof.time("mpImage") {
        ByteBufferImageBuilder(j.rgba, outW, outH, MPImage.IMAGE_FORMAT_RGBA).build()
      }
      val t = SystemClock.elapsedRealtimeNanos()
      val res = try {
        current!!.detectForVideo(img, ts)
      } catch (e: RuntimeException) {
        if (delegate != "gpu") throw e
        // a GPU that builds but fails to run: start over on the CPU, this frame first
        Log.w(TAG, "GPU inference failed, switching to CPU", e)
        delegate = "cpu"
        current?.close()
        current = null
        closeSpare()
        current = create()
        lastTs = ts
        current!!.detectForVideo(img, ts)
      }
      val dt = SystemClock.elapsedRealtimeNanos() - t
      inferNs += dt
      // MediaPipe's graph and GL threads exist once an instance has run: add them to the session
      if (inferences == 0 || j.fresh) hint.add(PerfHint.processTids() - baseTids)
      hint.report(dt)
      inferences++
      pool.put(j.rgba)
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
      results.put(Result(j.frame, j.ptsUs, out, j.epoch))
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

    init {
      // never keeps the process alive; interrupted if it does not stop in time
      isDaemon = true
    }

    fun stopAndJoin() {
      if (!isAlive) return
      jobs.clear()
      if (!jobs.offer(Job.Stop)) interrupt()
      join(5_000)
      if (isAlive) {
        interrupt()
        join(1_000)
      }
    }
  }

  private sealed class Job {
    class Frame(val frame: Int, val ptsUs: Long, val rgba: ByteBuffer, val fresh: Boolean, val epoch: Int) : Job()
    object Spare : Job()
    object Stop : Job()
  }
}
