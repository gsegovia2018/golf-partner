package expo.modules.golfswing

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/** JPEG stills of a decoded frame (pass 2's checkpoint stills, extractFrames). */
internal object Stills {
  private const val JPEG_QUALITY = 85

  /** Straight from YUV to the Bitmap's colour ints (display orientation, decoded size). */
  internal fun writeJpeg(f: YuvFrame, file: File) {
    val w = f.dispW
    val h = f.dispH
    val px = IntArray(w * h)
    f.toArgb(w, h, px)
    val bmp = Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
    try {
      FileOutputStream(file).use { bmp.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
    } finally {
      bmp.recycle()
    }
  }
}

/** A clip's sample table: presentation times in frame order, sync-sample times, display rotation. */
internal class SampleTable(val pts: LongArray, val syncs: LongArray, val rotation: Int) {
  /** The frame index of each presentation time. */
  val frameOf: Map<Long, Int> = HashMap<Long, Int>(pts.size * 2).also { m -> pts.forEachIndexed { i, t -> m[t] = i } }

  companion object {
    /** One walk of the sample table (no decode); rotation from the track format, else the container metadata. */
    fun read(context: Context, path: String): SampleTable {
      val ex = Media.extractor(context, path)
      try {
        val t = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true }
          ?: throw IllegalArgumentException("no video track")
        ex.selectTrack(t)
        val f = ex.getTrackFormat(t)
        val all = ArrayList<Long>()
        val sync = ArrayList<Long>()
        while (ex.sampleTime >= 0) {
          all.add(ex.sampleTime)
          if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) sync.add(ex.sampleTime)
          if (!ex.advance()) break
        }
        val rotation = if (f.containsKey(MediaFormat.KEY_ROTATION)) f.getInteger(MediaFormat.KEY_ROTATION) else Media.retrieverRotation(context, path)
        return SampleTable(all.sorted().toLongArray(), sync.sorted().toLongArray(), ((rotation % 360) + 360) % 360)
      } finally {
        ex.release()
      }
    }
  }
}

/** A small least-recently-used map (access order): the sample tables of the last few clips. */
internal class Lru<K, V>(private val max: Int) {
  private val map = object : LinkedHashMap<K, V>(16, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, V>?) = size > max
  }

  fun getOrPut(key: K, make: () -> V): V = map[key] ?: make().also { map[key] = it }

  val keys: Set<K> get() = map.keys
}

/** Pure decisions of the warm decoder, unit-tested on the JVM. */
internal object FramePlan {
  /** No output decoded since the last (re)start or seek. */
  const val NONE = Long.MIN_VALUE
  /** The decoder reached the end of the stream: any further target needs a seek. */
  const val AT_END = Long.MAX_VALUE

  /**
   * Where to seek before decoding up to [target] (presentation µs), or null to go on decoding
   * forward from [lastOut] (the last output's time, [NONE] or [AT_END]). Forward is free while no
   * sync sample lies in (lastOut, target]; past one, seeking to it skips the frames in between; a
   * target at or before lastOut needs the sync at or before it.
   */
  fun seekFor(target: Long, lastOut: Long, syncs: LongArray): Long? {
    val sync = lastAtOrBefore(syncs, target) ?: syncs.firstOrNull() ?: return null
    if (lastOut == NONE || lastOut == AT_END || target <= lastOut) return sync
    return if (sync > lastOut) sync else null
  }

  /** The greatest element of the sorted [a] that is ≤ [t], or null. */
  fun lastAtOrBefore(a: LongArray, t: Long): Long? {
    var lo = 0
    var hi = a.size - 1
    var best: Long? = null
    while (lo <= hi) {
      val mid = (lo + hi) ushr 1
      if (a[mid] <= t) {
        best = a[mid]
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return best
  }
}

/**
 * One clip's decoder kept between extractFrames calls (the Edit-marks scrubber asks for a frame, then
 * its neighbours, then the next one the finger stops on). A request at or after the last decoded
 * frame goes on forward without a flush or a seek; it seeks (flush + previous sync) only when a
 * keyframe lies between, or the target is behind. Not thread-safe: every call runs on the module's
 * worker thread. A failed decode leaves the session unusable ([broken]); a cancel doesn't (no
 * buffer is held across loop turns, so the next call picks up where this one stopped).
 */
internal class FrameSession(context: Context, path: String, private val table: SampleTable) : AutoCloseable {
  companion object {
    private const val STALL_NS = 10_000_000_000L
    private const val JPEG_THREADS = 2
    private const val JPEG_IN_FLIGHT = 6
  }

  private val ex = Media.extractor(context, path)
  private val codec: MediaCodec
  private val format: MediaFormat
  private var lastOut = FramePlan.NONE
  private var inputDone = false
  /** Inputs queued since the last (re)start without an output yet: a flush now would drop the codec-specific data. */
  private var fedWithoutOutput = false
  /** The output's colour range, read once the codec reports its output format (null = not yet). */
  private var full: Boolean? = null
  var broken = false
    private set

  init {
    try {
      val t = (0 until ex.trackCount).first { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)!!.startsWith("video/") }
      ex.selectTrack(t)
      format = ex.getTrackFormat(t).apply { setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible) }
      codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
    } catch (e: Throwable) {
      ex.release()
      throw e
    }
    try {
      codec.configure(format, null, null, 0)
      codec.start()
    } catch (e: Throwable) {
      codec.release()
      ex.release()
      throw e
    }
  }

  /** Writes `<dir>/<frame>.jpg` for every frame of [frames] in the clip; frame → file:// URI. */
  fun extract(frames: Collection<Int>, dir: File, cancelled: () -> Boolean): Map<Int, String> {
    val wanted = frames.filter { it in table.pts.indices }.distinct().sorted()
    val out = ConcurrentHashMap<Int, String>()
    if (wanted.isEmpty()) return out
    val byPts = wanted.associateBy { table.pts[it] }
    val pool = Executors.newFixedThreadPool(JPEG_THREADS) { Thread(it, "golf-swing-stills").apply { isDaemon = true } }
    val slots = Semaphore(JPEG_IN_FLIGHT)
    val jobs = ArrayList<Future<*>>()
    val done = HashSet<Int>()
    try {
      decode(wanted, byPts, done, cancelled) { frame, y ->
        slots.acquire()
        jobs += pool.submit {
          try {
            if (!cancelled()) {
              val file = File(dir, "$frame.jpg")
              Stills.writeJpeg(y, file)
              out[frame] = "file://${file.absolutePath}"
            }
          } finally {
            slots.release()
          }
        }
      }
      for (j in jobs) {
        try {
          j.get()
        } catch (e: ExecutionException) {
          throw e.cause ?: e
        }
      }
    } finally {
      pool.shutdownNow()
      // a cancel (the swing being deleted) must not leave a write landing after the call returned
      pool.awaitTermination(2, TimeUnit.SECONDS)
    }
    if (cancelled()) throw CancelledException()
    return HashMap(out)
  }

  private fun decode(wanted: List<Int>, byPts: Map<Long, Int>, done: MutableSet<Int>, cancelled: () -> Boolean, onFrame: (Int, YuvFrame) -> Unit) {
    val info = MediaCodec.BufferInfo()
    var next = 0
    fun seekIfNeeded() {
      val sync = FramePlan.seekFor(table.pts[wanted[next]], lastOut, table.syncs) ?: return
      if (fedWithoutOutput) {
        // flushing before the first output would drop the codec-specific data (MediaCodec docs)
        codec.stop()
        codec.configure(format, null, null, 0)
        codec.start()
      } else if (lastOut != FramePlan.NONE || inputDone) {
        codec.flush()
      }
      ex.seekTo(sync, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      inputDone = false
      fedWithoutOutput = false
      lastOut = FramePlan.NONE
    }
    try {
      seekIfNeeded()
      var lastProgress = System.nanoTime()
      while (next < wanted.size) {
        if (cancelled()) throw CancelledException()
        if (!inputDone) {
          val i = codec.dequeueInputBuffer(2_000)
          if (i >= 0) {
            val size = ex.readSampleData(codec.getInputBuffer(i)!!, 0)
            if (size < 0) {
              codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              codec.queueInputBuffer(i, 0, size, ex.sampleTime, 0)
              ex.advance()
            }
            if (lastOut == FramePlan.NONE) fedWithoutOutput = true
          }
        }
        val o = codec.dequeueOutputBuffer(info, 2_000)
        if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) full = null
        if (o < 0) {
          if (System.nanoTime() - lastProgress > STALL_NS) throw IllegalStateException("decoder stalled")
          continue
        }
        lastProgress = System.nanoTime()
        val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
        try {
          if (info.size > 0) {
            lastOut = info.presentationTimeUs
            fedWithoutOutput = false
            val frame = byPts[info.presentationTimeUs]
            if (frame != null && done.add(frame)) {
              codec.getOutputImage(o)?.use { img ->
                val (w, h) = Media.frameSize(img)
                val range = full ?: codec.outputFormat.let { of ->
                  (of.containsKey(MediaFormat.KEY_COLOR_RANGE) && of.getInteger(MediaFormat.KEY_COLOR_RANGE) == MediaFormat.COLOR_RANGE_FULL).also { full = it }
                }
                val f = YuvFrame(w, h, table.rotation, range)
                Media.copy(img, f)
                onFrame(frame, f)
              }
            }
          }
        } finally {
          codec.releaseOutputBuffer(o, false)
        }
        if (eos) {
          // the rest of the targets never came out (frames the decoder doesn't show); the next call seeks
          lastOut = FramePlan.AT_END
          fedWithoutOutput = false
          break
        }
        var moved = false
        while (next < wanted.size && wanted[next] in done) {
          next++
          moved = true
        }
        if (moved && next < wanted.size) seekIfNeeded()
      }
    } catch (e: CancelledException) {
      throw e
    } catch (e: Throwable) {
      broken = true
      throw e
    }
  }

  override fun close() {
    try {
      codec.stop()
    } catch (_: IllegalStateException) {
    }
    codec.release()
    ex.release()
  }
}

/**
 * extractFrames' decoders (apiVersion 6): the sample tables of the last [TABLES] clips, and one
 * [FrameSession] kept warm for [idleMs] after the last call, closed at once by [release]
 * (releaseFrames, the canvas unmounting), by a call for another clip, by a heavier job on the
 * same thread (analyzePose / extractCheckpoints need the codecs) and on module destroy.
 * Every call, the idle close included, runs on the module's worker thread.
 */
internal class FrameSessions(
  private val context: () -> Context,
  private val scheduler: IdleScheduler,
  private val idleMs: Long = IDLE_MS,
) {
  companion object {
    const val IDLE_MS = 4_000L
    const val TABLES = 4
  }

  private val tables = Lru<String, SampleTable>(TABLES)
  private var warm: ClubWarm<FrameSession>? = null
  private var warmPath: String? = null

  /** Writes `<outDir>/<frame>.jpg` for every requested frame; returns frame → file:// URI. */
  fun extract(path: String, frames: Collection<Int>, outDir: String, cancelled: () -> Boolean): Map<Int, String> {
    val dir = File(Media.localPath(outDir)).apply { mkdirs() }
    val ctx = context()
    val table = tables.getOrPut(path) { SampleTable.read(ctx, path) }
    if (warmPath != path) {
      release()
      warm = ClubWarm({ FrameSession(ctx, path, table) }, scheduler, idleMs)
      warmPath = path
    }
    val w = warm!!
    try {
      return w.use { s, _ -> s.extract(frames, dir, cancelled) }
    } finally {
      // a decode that failed leaves the codec in an unknown state: the next call starts afresh
      if (w.current?.broken == true) w.release()
    }
  }

  /** Closes the warm decoder now (a no-op when none is open); the sample tables stay. */
  fun release() {
    warm?.release()
    warm = null
    warmPath = null
  }
}

internal class CancelledException : RuntimeException("cancelled")
