package expo.modules.golfswing

import android.content.Context
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.atan2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** One checkpoint of the pass-2 request; [hands] normalised (null = unknown). */
internal class CheckpointSpec(val key: String, val frame: Int, val hands: Pt?, val neighbours: Int)

/**
 * The window for the image-based address, container frames (phases.js addressSearch). apiVersion 6
 * tracks the clubhead from [ClubheadTrack.PRE_S] before [run]'s start to the lead arm (the start of
 * [quiet]); [latest] and [minRun] were the onset rule's and are no longer read.
 */
internal class AddressSearchSpec(val run: IntRange, val latest: Int, val quiet: IntRange, val minRun: Int)

/** [ball] = (x, y) normalised; [expectedShaftPx] display px (105 cm × px/cm, scale.js). */
internal class Pass2Request(
  val checkpoints: List<CheckpointSpec>,
  val ball: Pt?,
  val expectedShaftPx: Double?,
  val addressSearch: AddressSearchSpec?,
  val outDir: String,
  /**
   * Scrub proxies (D28): every [proxyEvery]-th frame (multiples of it) inside [proxyRange] into
   * [proxyDir]; 0 or no dir = none. The range is the swing window the JS asks for, so the decode
   * span stays close to the checkpoint span; null = the whole clip.
   */
  val proxyEvery: Int = 0,
  val proxyDir: String? = null,
  val proxyRange: IntRange? = null,
  /** The learned club detector (plan 2026-10-16) on the checkpoint frames; false = today's output, unchanged. */
  val clubModel: Boolean = false,
  /** Capture rate of one container frame step (the address track's time base); null = 240. */
  val captureFps: Double? = null,
)

/**
 * Pass 2 (plan §3 extractCheckpoints, §4.1, D16): one sequential decode of the checkpoint
 * span that writes the stills (checkpoint ± neighbours, JPEG encodes on a small pool so they
 * overlap the decode), keeps grey strips around the ball for the image-based address (P1,
 * [ClubheadTrack]), and runs the radial shaft search at address and impact only, seeded with
 * hands → ball. Every other checkpoint gets a `prior` entry: v1 does no shaft tracking (D16). A
 * second short decode only when the address moved onto frames whose stills the first one didn't
 * write.
 *
 * With [Pass2Request.clubModel] (plan 2026-10-16 §4.2) the learned detector also runs on the
 * final checkpoint frames, after the decode and while the JPEG pool finishes: its head (or
 * shaft-box corner) wins over the edge search and the prior at every checkpoint where it finds
 * one. It also runs on [ClubheadTrack.SAMPLES] frames of the address window, which only say where
 * the clubhead rests (the address track's template); without it the track starts from
 * [ClubheadTrack.fallbackHead].
 */
internal class Checkpoints(
  private val context: Context,
  private val req: Pass2Request,
  private val cancelled: () -> Boolean,
) {
  companion object {
    private const val SHAFT_CM = 105.0
    private const val JPEG_THREADS = 3
    private const val JPEG_IN_FLIGHT = 8
    private const val PRIOR_CONF = 0.1
    /** A split must save at least this many decoded frames to be worth a second decoder. */
    private const val MIN_SPLIT_GAIN = 30
  }

  private lateinit var track: TrackInfo
  private lateinit var pts: LongArray
  private lateinit var syncs: LongArray
  private val frameOf = HashMap<Long, Int>()
  private var ws = 1.0
  private var step = 1
  private var workW = 0
  private var workH = 0
  private val decoded = AtomicInteger()

  private val written = ConcurrentHashMap<Int, String>()
  private val jobs = ArrayList<Future<*>>()

  fun run(path: String): Map<String, Any?> {
    val t0 = SystemClock.elapsedRealtime()
    val dir = File(Media.localPath(req.outDir)).apply { mkdirs() }
    scan(path)
    val scanMs = SystemClock.elapsedRealtime() - t0
    pts.forEachIndexed { i, t -> frameOf[t] = i }
    val n = pts.size
    val decim = Media.decimation(track.dispW, track.dispH)
    // the working image of pass 1 (§4.3): half resolution from 720p up, never finer than the kept frame
    ws = min(if (min(track.dispW, track.dispH) >= 720) 0.5 else 1.0, 1.0 / decim)
    step = (1.0 / (ws * decim)).roundToInt()
    workW = (track.dispW * ws).roundToInt()
    workH = (track.dispH * ws).roundToInt()
    val frameW = track.dispW / decim
    val frameH = track.dispH / decim

    fun disp(p: Pt) = Pt(p.x * track.dispW, p.y * track.dispH)
    val cps = req.checkpoints.map { CheckpointSpec(it.key, it.frame, it.hands?.let(::disp), it.neighbours) }
    val ball = req.ball?.let(::disp)
    val expPx = req.expectedShaftPx?.takeIf { it.isFinite() && it > 0 }
    val pxPerCm = expPx?.let { it / SHAFT_CM }
    val exp = (expPx ?: 0.0) * ws
    val ballD = (pxPerCm ?: 0.0) * Ball.BALL_CM * ws
    val addr = cps.firstOrNull { it.key == "address" }?.takeIf { it.hands != null && ball != null && expPx != null }
    val imp = cps.firstOrNull { it.key == "impact" }?.takeIf { it.hands != null && ball != null && expPx != null }

    fun span(c: CheckpointSpec) = (c.frame - c.neighbours..c.frame + c.neighbours).filter { it in 0 until n }
    val stills = cps.flatMap { span(it) }.toSortedSet()
    val search = if (addr != null) req.addressSearch else null
    val fps = req.captureFps?.takeIf { it.isFinite() && it > 0 } ?: 240.0
    // apiVersion 6 address (ClubheadTrack): frame-px strips around the ball from PRE_S before the
    // hands' still run to the lead arm, and the detector on SAMPLES frames of that window
    val ballF = ball?.let { Pt(it.x / decim, it.y / decim) }
    val pxCmF = (pxPerCm ?: 0.0) / decim
    val addrRange = search?.let { ClubheadTrack.start(it.run.first, fps)..it.quiet.first.coerceAtMost(n - 1) }?.takeIf { it.first < it.last }
    val strip = addrRange?.let { ClubheadTrack.stripRect(ballF!!.x.toDouble(), ballF.y.toDouble(), pxCmF, frameW, frameH) }
    val samples = if (addrRange != null && req.clubModel) ClubheadTrack.samples(addrRange.first, addrRange.last).toSet() else emptySet()
    // Memory: only ONE address grey is ever kept (the requested frame, the fallback); the moved
    // address's grey comes from the short follow-up decode below. What the main pass retains: the
    // address strips (±6 ball diameters sampled to ~8 px per diameter: ≤ 100 × 100 px, ≤ 10 KB a
    // frame, ≤ 6 MB for the ~2.5 s window at 240 fps), two shaft greys (≤ (2 × 1.1 × expected
    // shaft)² work px, ~250 KB at 1080p), the detector inputs (1.2 MB each: checkpoints + SAMPLES)
    // and at most JPEG_IN_FLIGHT + 2 full frames (~3 MB each at 1080p) waiting for the encoders.
    val addrRoi = addr?.let { roi(it.hands!!, exp, ballD) }
    val impRoi = imp?.let { roi(it.hands!!, exp, ballD) }

    // filled from both decoder threads (decodeSplit)
    val strips = ConcurrentHashMap<Int, Gray>()
    val addrGrays = ConcurrentHashMap<Int, Gray>()
    val impactShaft = AtomicReference<ShaftFound?>()
    val shaftNs = AtomicLong()
    val pool = Executors.newFixedThreadPool(JPEG_THREADS) { Thread(it, "golf-swing-jpeg").apply { isDaemon = true } }
    val slots = Semaphore(JPEG_IN_FLIGHT)
    // D28: the scrub proxies ride on this decode. Downscaled on the decoder thread (a small
    // nearest-neighbour copy, so the frame can be a reused scratch one), encoded on the pool.
    val proxyDir = req.proxyDir?.takeIf { req.proxyEvery > 0 && it.isNotEmpty() }?.let { File(Media.localPath(it)).apply { mkdirs() } }
    val proxyFrames = if (proxyDir != null) Proxies.frames(n, req.proxyEvery, req.proxyRange).toSet() else emptySet()
    val proxiesWritten = AtomicInteger()
    val proxyFailures = AtomicInteger()
    val proxyNs = AtomicLong()
    // The club detector's inputs: each checkpoint frame stretched to 640 × 640 RGB on the decoder
    // thread (1.2 MB each, so the frame can be a reused scratch one), inferred after the decode.
    val clubFrames = if (req.clubModel) (cps.map { it.frame } + samples).filter { it in 0 until n }.toSet() else emptySet()
    val clubInputs = ConcurrentHashMap<Int, ByteArray>()
    val clubFailures = AtomicInteger()
    fun clubInput(f: Int, y: YuvFrame) {
      try {
        val px = ByteArray(ClubDecode.SIZE * ClubDecode.SIZE * 3)
        y.toRgb(ClubDecode.SIZE, ClubDecode.SIZE, ByteBuffer.wrap(px))
        clubInputs[f] = px
      } catch (e: Exception) {
        clubFailures.incrementAndGet()
      }
    }
    // A proxy is a convenience: one that fails is counted and skipped, never fails pass 2. After a
    // cancel (the swing is being deleted) nothing more is written into its folder.
    fun proxy(f: Int, y: YuvFrame) {
      if (cancelled()) return
      val px: Triple<IntArray, Int, Int>
      val s = System.nanoTime()
      try {
        px = Proxies.pixels(y)
      } catch (e: Exception) {
        proxyFailures.incrementAndGet()
        return
      } finally {
        proxyNs.addAndGet(System.nanoTime() - s)
      }
      slots.acquire()
      val job = pool.submit {
        try {
          if (!cancelled()) {
            Proxies.write(px.first, px.second, px.third, File(proxyDir, "$f.jpg"))
            proxiesWritten.incrementAndGet()
          }
        } catch (e: Exception) {
          proxyFailures.incrementAndGet()
        } finally {
          slots.release()
        }
      }
      synchronized(jobs) { jobs += job }
    }
    fun encode(f: Int, y: YuvFrame) {
      slots.acquire()
      val job = pool.submit {
        try {
          val file = File(dir, "$f.jpg")
          Stills.writeJpeg(y, file)
          written[f] = "file://${file.absolutePath}"
        } finally {
          slots.release()
        }
      }
      synchronized(jobs) { jobs += job }
    }

    var mainMs = 0L
    var addrMs = 0L
    var onsetMs = 0L
    var waitMs = 0L
    var onset: Int? = null
    var headSource: String? = null
    var addressShaft: ShaftFound? = null
    var clubMs = 0L
    var clubDets: Map<Int, List<ClubBox>>? = null
    var clubScenery: List<ClubBox> = emptyList()
    var clubDelegate = "cpu"
    var detector: ClubDetector? = null
    try {
      val wanted = stills + (addrRange?.toSet() ?: emptySet()) + listOfNotNull(addr?.frame, imp?.frame) + proxyFrames + clubFrames
      var t = SystemClock.elapsedRealtime()
      decodeSplit(path, wanted, keep = { it in stills }) { f, y ->
        if (addrRange != null && f in addrRange) strips[f] = y.graySampled(strip!!.first, strip.second)
        if (addr != null && f == addr.frame) addrGrays[f] = y.grayStrip(addrRoi!!, step)
        if (imp != null && f == imp.frame) {
          val s = System.nanoTime()
          impactShaft.set(seeded(y.grayStrip(impRoi!!, step), imp.hands!!, ball!!, exp, ballD))
          shaftNs.addAndGet(System.nanoTime() - s)
        }
        if (f in proxyFrames) proxy(f, y)
        if (f in clubFrames) clubInput(f, y)
        if (f in stills) encode(f, y)
      }
      mainMs = SystemClock.elapsedRealtime() - t

      // The detector, opened once for the address samples, the checkpoints and the moved address. A
      // failure to open (no model, no runtime) leaves today's proposals and the fallback head.
      val dets = HashMap<Int, List<ClubBox>>()
      fun infer(frames: Collection<Int>) {
        val d = detector ?: return
        val t1 = SystemClock.elapsedRealtime()
        val sx = track.dispW / ClubDecode.SIZE.toDouble()
        val sy = track.dispH / ClubDecode.SIZE.toDouble()
        for (f in frames.sorted()) {
          if (cancelled()) throw CancelledException()
          val px = clubInputs.remove(f) ?: continue
          try {
            dets[f] = d.detect(px).map { it.scaled(sx, sy) }
          } catch (e: Exception) {
            clubFailures.incrementAndGet()
            Log.w(PoseAnalyzer.TAG, "club detector failed at frame $f", e)
          }
        }
        clubMs += SystemClock.elapsedRealtime() - t1
      }
      if (req.clubModel) {
        t = SystemClock.elapsedRealtime()
        try {
          detector = ClubDetector.open(context).also { clubDelegate = it.delegate }
        } catch (e: Throwable) {
          // also LinkageError: a binary without the runtime's native library
          clubFailures.incrementAndGet()
          Log.w(PoseAnalyzer.TAG, "club detector unavailable, keeping today's proposals", e)
        }
        clubMs += SystemClock.elapsedRealtime() - t
        // the checkpoints the address cannot move, and the address window's samples
        infer(cps.filter { it.key != "address" }.map { it.frame } + samples)
      }

      t = SystemClock.elapsedRealtime()
      if (addrRange != null) {
        // the resting head: the earliest sample with a head at the ball, the scenery the checkpoints
        // already voted out removed; else the fallback position at the window's first frame
        val places = cps.filter { it.key != "address" && it.frame in dets }.associate { it.frame to ClubRules.place(it.key) }
        val scenery = ClubRules.scenery(ClubRules.splitStatic(dets.filterKeys { it in places }, places).second.values.flatten())
        val heads = samples.associateWith { f ->
          dets[f]?.let { ClubRules.dropScenery(it, scenery) }?.filter { it.cls == ClubDecode.HEAD }?.maxByOrNull { it.score }
            ?.let { Triple(it.cx / decim, it.cy / decim, it.score) }
        }
        val bx = ballF!!.x.toDouble()
        val by = ballF.y.toDouble()
        val rest = ClubheadTrack.restingHead(heads, bx, by, pxCmF)
        val (ref, hx, hy) = rest ?: ClubheadTrack.fallbackHead(bx, by, addr!!.hands!!.x.toDouble() / decim, pxCmF)
          .let { Triple(addrRange.first, it.first, it.second) }
        headSource = if (rest != null) "model" else "fallback"
        val (rect, stepS) = strip!!
        val headTrack = ClubheadTrack.track(strips, Pair(rect.x0, rect.y0), stepS, ref, hx, hy, bx, by, pxCmF)
        onset = ClubheadTrack.address(headTrack, ref, addrRange.last, fps, clipStart = addrRange.first == 0)?.takeIf { it in 0 until n }
        strips.clear()
      }
      onsetMs = SystemClock.elapsedRealtime() - t
      if (addr != null) {
        val at = onset ?: addr.frame
        if (at != addr.frame) {
          // the address moved: one short decode for its grey and the stills the main pass didn't write
          val missing = span(CheckpointSpec("address", at, null, addr.neighbours)).filter { it !in stills }.toSet()
          t = SystemClock.elapsedRealtime()
          decodeSpan(path, missing + at, keep = { it in missing }, handle = { f2, y ->
            if (f2 == at) addrGrays[f2] = y.grayStrip(addrRoi!!, step)
            if (f2 == at && req.clubModel && !clubInputs.containsKey(f2) && !dets.containsKey(f2)) clubInput(f2, y)
            if (f2 in missing) encode(f2, y)
          })
          addrMs = SystemClock.elapsedRealtime() - t
        }
        addrGrays[at]?.let { g ->
          val s = System.nanoTime()
          addressShaft = seeded(g, addr.hands!!, ball!!, exp, ballD)
          shaftNs.addAndGet(System.nanoTime() - s)
        }
      }
      if (detector != null) {
        // the final address (moved or not), then the static vote over the final checkpoint places
        val finalAddress = cps.firstOrNull { it.key == "address" }?.let { if (onset != null) onset!! else it.frame }
        infer(listOfNotNull(finalAddress))
        val places = LinkedHashMap<Int, String>()
        for (c in cps) places.putIfAbsent(if (c.key == "address" && onset != null) onset!! else c.frame, ClubRules.place(c.key))
        val (kept, dropped) = ClubRules.splitStatic(dets.filterKeys { it in places }, places)
        clubDets = kept
        clubScenery = ClubRules.scenery(dropped.values.flatten())
      }
      clubInputs.clear()
      t = SystemClock.elapsedRealtime()
      for (j in synchronized(jobs) { jobs.toList() }) {
        try {
          j.get()
        } catch (e: ExecutionException) {
          throw e.cause ?: e
        }
      }
      waitMs = SystemClock.elapsedRealtime() - t
    } finally {
      detector?.close()
      pool.shutdownNow()
      // a cancel (the swing being deleted) must not leave a write landing after the folder is gone
      pool.awaitTermination(2, TimeUnit.SECONDS)
    }

    val addressFrame = onset
    val finalFrames = cps.associate { c ->
      c.key to (if (c.key == "address" && addressFrame != null) addressFrame else c.frame)
    }
    val stillsOut = cps.associate { c ->
      val at = finalFrames.getValue(c.key)
      c.key to (at - c.neighbours..at + c.neighbours).mapNotNull { f -> written[f]?.let { f.toString() to it } }.toMap()
    }
    // D16: no search outside address and impact; the UI shows those as "place the clubhead"
    val base = LinkedHashMap<String, Map<String, Any?>>()
    for (c in cps) base[finalFrames.getValue(c.key).toString()] = prior()
    if (addr != null) base[finalFrames.getValue("address").toString()] = addressShaft?.let { entry(it) } ?: prior()
    if (imp != null) base[imp.frame.toString()] = impactShaft.get()?.let { entry(it) } ?: prior()
    // the learned detector, where it ran, wins over both (plan 2026-10-16 §4.2.4)
    val grips = HashMap<Int, Pt?>()
    for (c in cps) grips.putIfAbsent(finalFrames.getValue(c.key), c.hands)
    val shaft = ClubRules.merge(base, clubDets, grips, pxPerCm)

    val timings = mapOf(
      "totalMs" to (SystemClock.elapsedRealtime() - t0).toInt(),
      "scanMs" to scanMs.toInt(),
      "decodeMs" to mainMs.toInt(),
      "addressDecodeMs" to addrMs.toInt(),
      "jpegWaitMs" to waitMs.toInt(),
      "onsetMs" to onsetMs.toInt(),
      "shaftMs" to (shaftNs.get() / 1_000_000).toInt(),
      "decoded" to decoded.get(),
      "stills" to written.size,
      "proxies" to proxiesWritten.get(),
      "proxyMs" to (proxyNs.get() / 1_000_000).toInt(),
      "proxyFailures" to proxyFailures.get(),
    ) + if (!req.clubModel) emptyMap() else mapOf(
      "clubMs" to clubMs.toInt(),
      "clubFrames" to (clubDets?.size ?: 0),
      "clubFailures" to clubFailures.get(),
      "clubDelegate" to clubDelegate,
    )
    Log.i(
      PoseAnalyzer.TAG,
      "pass2 address=${addr?.frame}->${addressFrame} head=$headSource addrShaft=$addressShaft impact=${imp?.frame} impShaft=${impactShaft.get()} timings=$timings",
    )
    val proxies = proxyDir?.let {
      mapOf(
        "every" to req.proxyEvery,
        "from" to (proxyFrames.minOrNull() ?: 0),
        "to" to (proxyFrames.maxOrNull() ?: -1),
        "count" to proxiesWritten.get(),
        "failed" to proxyFailures.get(),
      )
    }
    if (req.clubModel) {
      Log.i(PoseAnalyzer.TAG, "pass2 club frames=${clubDets?.size ?: 0} ms=$clubMs failures=${clubFailures.get()} sources=${shaft.values.groupingBy { it["source"] }.eachCount()}")
    }
    val out = mapOf("stills" to stillsOut, "shaft" to shaft, "addressFrame" to addressFrame, "proxies" to proxies, "timings" to timings)
    // what ran (stored as pose.pass2.club); null when the detector could not run at all. scenery
    // (apiVersion 5): what the static vote removed, clustered, for detectClub on frames that cannot vote
    return if (!req.clubModel) out else out + ("club" to clubDets?.let {
      mapOf(
        "model" to ClubDetector.MODEL, "input" to ClubDecode.SIZE, "conf" to ClubDecode.CONF, "nms" to ClubDecode.NMS_IOU,
        "scenery" to ClubRules.boxJson(clubScenery),
      )
    })
  }

  /**
   * One walk of the sample table: presentation times in frame order, sync-sample times and
   * the frame geometry (Media.scan + Stills.sampleTimes would walk it twice, ~0.3 s each on
   * the emulator). Rotation from the track format, else the container metadata.
   */
  private fun scan(path: String) {
    val ex = Media.extractor(context, path)
    try {
      val t = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true }
        ?: throw IllegalArgumentException("no video track")
      ex.selectTrack(t)
      val f = ex.getTrackFormat(t)
      var w = f.getInteger(MediaFormat.KEY_WIDTH)
      var h = f.getInteger(MediaFormat.KEY_HEIGHT)
      if (f.containsKey("crop-right") && f.containsKey("crop-left")) w = f.getInteger("crop-right") - f.getInteger("crop-left") + 1
      if (f.containsKey("crop-bottom") && f.containsKey("crop-top")) h = f.getInteger("crop-bottom") - f.getInteger("crop-top") + 1
      val all = ArrayList<Long>()
      val sync = ArrayList<Long>()
      while (ex.sampleTime >= 0) {
        all.add(ex.sampleTime)
        if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) sync.add(ex.sampleTime)
        if (!ex.advance()) break
      }
      pts = all.sorted().toLongArray()
      syncs = sync.sorted().toLongArray()
      val rotation = if (f.containsKey(MediaFormat.KEY_ROTATION)) ((f.getInteger(MediaFormat.KEY_ROTATION) % 360) + 360) % 360
        else retrieverRotation(path)
      track = TrackInfo(w, h, rotation, 0L, pts.size, 0.0, pts.firstOrNull() ?: 0L)
    } finally {
      ex.release()
    }
  }

  /** Container rotation from the metadata (what Media.scan falls back to), without a second walk. */
  private fun retrieverRotation(path: String): Int {
    val r = MediaMetadataRetriever()
    try {
      if (path.startsWith("content://")) r.setDataSource(context, Uri.parse(path)) else r.setDataSource(Media.localPath(path))
      val deg = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      return ((deg % 360) + 360) % 360
    } finally {
      r.release()
    }
  }

  /** The shaft search seeded with the hands → ball direction (D16); [hands] and [ball] in display px. */
  private fun seeded(g: Gray, hands: Pt, ball: Pt, exp: Double, ballD: Double): ShaftFound {
    val seed = (Math.toDegrees(atan2((ball.y - hands.y).toDouble(), (ball.x - hands.x).toDouble())) + 360.0) % 360.0
    return ShaftSearch.search(g, workW, workH, hands.x * ws, hands.y * ws, exp, ballD, seed)
  }

  /** Working-image patch around the hands that one shaft search reads. */
  private fun roi(hands: Pt, exp: Double, ballD: Double): Rect {
    val h = ShaftSearch.patchHalf(exp, ballD)
    val hx = Math.rint(hands.x * ws).toInt()
    val hy = Math.rint(hands.y * ws).toInt()
    return Rect(max(0, hx - h), max(0, hy - h), min(workW, hx + h + 1), min(workH, hy + h + 1))
  }

  private fun entry(s: ShaftFound): Map<String, Any?> = mapOf(
    "head" to if (s.hidden) null else listOf(s.headX / ws, s.headY / ws),
    "hidden" to s.hidden,
    "conf" to Math.round(s.conf * 1000) / 1000.0,
    "source" to "edge",
    "angleDeg" to s.angleDeg,
    "lengthPx" to s.lengthPx / ws,
  )

  private fun prior(): Map<String, Any?> = mapOf("head" to null, "hidden" to false, "conf" to PRIOR_CONF, "source" to "prior")

  /**
   * [decodeSpan] in two halves split at a sync frame, on two decoder instances in parallel,
   * when that shortens the longest run of frames either has to decode (e.g. the address
   * window reaching back into the previous GOP). Frames are still decoded sequentially from a
   * sync frame, never seeked per checkpoint; [handle] must be thread-safe.
   *
   * The second decoder is an optimisation, never a requirement: if it can't be created or
   * fails (CodecException, no codec resources), the frames it didn't deliver are decoded by
   * the calling thread afterwards. Both halves poll a shared abort flag, so a failure or a
   * cancel in the calling thread stops the second decoder (and frees its codec) before this
   * returns or throws.
   */
  private fun decodeSplit(path: String, frames: Set<Int>, keep: (Int) -> Boolean, handle: (Int, YuvFrame) -> Unit) {
    if (frames.isEmpty()) return
    val first = frames.min()
    val last = frames.max()
    val start = syncFrame(first)
    var best: Int? = null
    var bestCost = last - start
    for (t in syncs) {
      val s = frameOf[t] ?: continue
      if (s <= start || s > last) continue
      val a = frames.filter { it < s }.maxOrNull() ?: continue
      val cost = max(a - start, last - s)
      if (cost < bestCost - MIN_SPLIT_GAIN) {
        bestCost = cost
        best = s
      }
    }
    val split = best ?: return decodeSpan(path, frames, keep, handle)
    val abort = AtomicBoolean(false)
    val stop = { abort.get() || cancelled() }
    val done = ConcurrentHashMap.newKeySet<Int>()
    val laterFrames = frames.filter { it >= split }.toSet()
    val second = Executors.newSingleThreadExecutor { Thread(it, "golf-swing-decode").apply { isDaemon = true } }
    var secondFailed: Throwable? = null
    try {
      val later = second.submit { decodeSpan(path, laterFrames, keep, handle, stop, done) }
      try {
        decodeSpan(path, frames.filter { it < split }.toSet(), keep, handle, stop, done)
      } catch (e: Throwable) {
        abort.set(true)
        try {
          later.get()
        } catch (_: Exception) {
        }
        throw e
      }
      try {
        later.get()
      } catch (e: ExecutionException) {
        secondFailed = e.cause ?: e
      }
    } finally {
      second.shutdownNow()
    }
    secondFailed?.let { e ->
      if (e is CancelledException || cancelled()) throw CancelledException()
      Log.w(PoseAnalyzer.TAG, "second decoder failed, finishing on one: $e")
      decodeSpan(path, laterFrames - done, keep, handle, cancelled, done)
    }
  }

  /** The frame index of the sync sample at or before [frame]. */
  private fun syncFrame(frame: Int): Int = frameOf[syncs.lastOrNull { it <= pts[frame] } ?: pts[0]] ?: 0

  /**
   * Decodes from the sync frame before the first of [frames] to the last, handing each of
   * [frames] over once as a display-oriented copy: a fresh one when [keep] says the handler
   * holds on to it (a still on its way to the JPEG pool), else a reused scratch frame.
   */
  private fun decodeSpan(
    path: String,
    frames: Set<Int>,
    keep: (Int) -> Boolean,
    handle: (Int, YuvFrame) -> Unit,
    stop: () -> Boolean = cancelled,
    done: MutableSet<Int>? = null,
  ) {
    if (frames.isEmpty()) return
    val first = frames.min()
    val last = frames.max()
    val seek = syncs.lastOrNull { it <= pts[first] } ?: pts[0]
    var scratch: YuvFrame? = null
    val seen = HashSet<Int>()
    Media.decode(context, path, seek, stop) { _, ptsUs, img, full ->
      decoded.incrementAndGet()
      val f = frameOf[ptsUs] ?: return@decode true
      if (img != null && f in frames && seen.add(f)) {
        val (w, h) = Media.frameSize(img)
        val y = if (keep(f)) YuvFrame(w, h, track.rotation, full) else
          scratch?.takeIf { it.codedW == w && it.codedH == h && it.fullRange == full } ?: YuvFrame(w, h, track.rotation, full).also { scratch = it }
        Media.copy(img, y)
        y.frame = f
        y.ptsUs = ptsUs
        handle(f, y)
        done?.add(f)
      }
      f < last
    }
  }
}
