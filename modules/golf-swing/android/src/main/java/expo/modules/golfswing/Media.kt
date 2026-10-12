package expo.modules.golfswing

import android.content.Context
import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.min

/** Container facts read without decoding (plan §3 probeVideo, minus the duplicate check). */
internal class TrackInfo(
  val codedW: Int,
  val codedH: Int,
  val rotation: Int,
  val durationUs: Long,
  val frameCount: Int,
  val containerFps: Double,
  val firstPtsUs: Long,
  /** PQ or HLG transfer, or a 10-bit HEVC/VP9/AV1 profile (iPhone/Pixel "HDR video"). */
  val hdr: Boolean = false,
) {
  val dispW get() = if (rotation == 90 || rotation == 270) codedH else codedW
  val dispH get() = if (rotation == 90 || rotation == 270) codedW else codedH
}

internal object Media {
  /** Accepts a plain path, a file:// URI (expo-file-system) or a content:// URI (picker). */
  fun extractor(context: Context, path: String): MediaExtractor {
    val ex = MediaExtractor()
    try {
      if (path.startsWith("content://")) ex.setDataSource(context, Uri.parse(path), null)
      else ex.setDataSource(localPath(path))
    } catch (e: Exception) {
      ex.release()
      throw e
    }
    return ex
  }

  fun localPath(path: String): String = if (path.startsWith("file://")) Uri.parse(path).path ?: path else path

  private fun videoTrack(ex: MediaExtractor): Int =
    (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true }
      ?: throw IllegalArgumentException("no video track")

  private fun intOr(f: MediaFormat, key: String, def: Int) = if (f.containsKey(key)) f.getInteger(key) else def

  /** Walks the sample table (no decode): frame count and the container frame rate from timestamps. */
  fun scan(context: Context, path: String): TrackInfo {
    val ex = extractor(context, path)
    try {
      val track = videoTrack(ex)
      ex.selectTrack(track)
      val f = ex.getTrackFormat(track)
      var w = f.getInteger(MediaFormat.KEY_WIDTH)
      var h = f.getInteger(MediaFormat.KEY_HEIGHT)
      if (f.containsKey("crop-right") && f.containsKey("crop-left")) w = f.getInteger("crop-right") - f.getInteger("crop-left") + 1
      if (f.containsKey("crop-bottom") && f.containsKey("crop-top")) h = f.getInteger("crop-bottom") - f.getInteger("crop-top") + 1
      var rotation = intOr(f, MediaFormat.KEY_ROTATION, -1)
      if (rotation < 0) rotation = retrieverRotation(context, path)
      var n = 0
      var lo = Long.MAX_VALUE
      var hi = Long.MIN_VALUE
      while (true) {
        val t = ex.sampleTime
        if (t < 0) break
        n++
        lo = min(lo, t)
        hi = max(hi, t)
        if (!ex.advance()) break
      }
      val fps = when {
        n > 1 && hi > lo -> (n - 1) * 1_000_000.0 / (hi - lo)
        f.containsKey(MediaFormat.KEY_FRAME_RATE) -> f.getNumber(MediaFormat.KEY_FRAME_RATE)?.toDouble() ?: 30.0
        else -> 30.0
      }
      val dur = if (f.containsKey(MediaFormat.KEY_DURATION)) f.getLong(MediaFormat.KEY_DURATION) else max(0L, hi - lo)
      return TrackInfo(w, h, ((rotation % 360) + 360) % 360, dur, n, fps, if (n > 0) lo else 0L, isHdr(f))
    } finally {
      ex.release()
    }
  }

  private fun isHdr(f: MediaFormat): Boolean {
    val transfer = intOr(f, MediaFormat.KEY_COLOR_TRANSFER, 0)
    if (transfer == MediaFormat.COLOR_TRANSFER_ST2084 || transfer == MediaFormat.COLOR_TRANSFER_HLG) return true
    val profile = intOr(f, MediaFormat.KEY_PROFILE, 0)
    return when (f.getString(MediaFormat.KEY_MIME)) {
      MediaFormat.MIMETYPE_VIDEO_HEVC -> profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10 ||
        profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10 ||
        profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10Plus
      MediaFormat.MIMETYPE_VIDEO_VP9 -> profile >= MediaCodecInfo.CodecProfileLevel.VP9Profile2
      MediaFormat.MIMETYPE_VIDEO_AV1 -> profile == MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10 ||
        profile == MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10HDR10 ||
        profile == MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10HDR10Plus
      else -> false
    }
  }

  private fun retriever(context: Context, path: String) = MediaMetadataRetriever().apply {
    if (path.startsWith("content://")) setDataSource(context, Uri.parse(path)) else setDataSource(localPath(path))
  }

  private fun retrieverRotation(context: Context, path: String): Int {
    val r = retriever(context, path)
    try {
      return r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
    } finally {
      r.release()
    }
  }

  /** Stock-camera slow motion writes the capture rate (com.android.capture.fps); copies strip it. */
  fun captureFps(context: Context, path: String): Double? {
    val r = retriever(context, path)
    try {
      return r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE)?.toDoubleOrNull()?.takeIf { it > 0 }
    } finally {
      r.release()
    }
  }

  /** No output for this long while frames are still owed = a stuck decoder (some OEM codecs never send EOS). */
  private const val STALL_NS = 10_000_000_000L

  /**
   * Sequential hardware decode to flexible YUV, frames handed over in presentation order with
   * a running index (= the frame number the lab's OpenCV read gives). [onFrame] returns false
   * to stop. The Image is only valid during the call; it is null for an output buffer the
   * codec can't expose as an Image (the index still advances, so later frames keep their
   * numbers). [seekUs] > 0 starts at the sync frame before it (indices then count from there).
   * [cancelled] is polled on every loop turn, not only per frame.
   */
  fun decode(
    context: Context,
    path: String,
    seekUs: Long,
    cancelled: () -> Boolean = { false },
    prof: Prof? = null,
    onFrame: (index: Int, ptsUs: Long, img: Image?, fullRange: Boolean) -> Boolean,
  ) {
    val ex = extractor(context, path)
    try {
      val track = videoTrack(ex)
      ex.selectTrack(track)
      if (seekUs > 0) ex.seekTo(seekUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      val fmt = ex.getTrackFormat(track)
      fmt.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
      val codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
      var feeder: Feeder? = null
      try {
        // as fast as it can, not paced for playback (hardware decoders clock for the stated rate)
        val fast = MediaFormat(fmt).apply {
          setInteger(MediaFormat.KEY_PRIORITY, 1)
          setInteger(MediaFormat.KEY_OPERATING_RATE, Short.MAX_VALUE.toInt())
        }
        try {
          codec.configure(fast, null, null, 0)
        } catch (e: Exception) {
          codec.reset()
          codec.configure(fmt, null, null, 0)
        }
        android.util.Log.i(PoseAnalyzer.TAG, "decoder ${codec.name} hw=${if (android.os.Build.VERSION.SDK_INT >= 29) codec.codecInfo.isHardwareAccelerated else null}")
        codec.start()
        feeder = Feeder(ex, codec).also { it.start() }
        val info = MediaCodec.BufferInfo()
        var n = 0
        var full: Boolean? = null
        var nullImages = 0
        var lastProgress = System.nanoTime()
        while (true) {
          if (cancelled()) throw CancelledException()
          feeder!!.error?.let { throw it }
          val t = System.nanoTime()
          val o = codec.dequeueOutputBuffer(info, 2_000)
          prof?.add("codecWait", System.nanoTime() - t)
          if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            val of = codec.outputFormat
            full = of.containsKey(MediaFormat.KEY_COLOR_RANGE) && of.getInteger(MediaFormat.KEY_COLOR_RANGE) == MediaFormat.COLOR_RANGE_FULL
          }
          if (o < 0) {
            if (System.nanoTime() - max(lastProgress, feeder!!.lastInputNs) > STALL_NS) throw IllegalStateException("decoder stalled after $n frames")
            continue
          }
          lastProgress = System.nanoTime()
          val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          var more = true
          if (info.size > 0) {
            val img = codec.getOutputImage(o)
            if (img == null && ++nullImages >= 5 && nullImages == n + 1) {
              throw UnsupportedVideoException("the decoder gives no readable frames for this video")
            }
            val range = full ?: codec.outputFormat.let { of ->
              (of.containsKey(MediaFormat.KEY_COLOR_RANGE) && of.getInteger(MediaFormat.KEY_COLOR_RANGE) == MediaFormat.COLOR_RANGE_FULL)
                .also { full = it }
            }
            try {
              more = onFrame(n++, info.presentationTimeUs, img, range)
            } finally {
              img?.close()
            }
          }
          codec.releaseOutputBuffer(o, false)
          if (eos || !more) break
        }
      } finally {
        feeder?.finish()
        try {
          codec.stop()
        } catch (_: IllegalStateException) {
        }
        codec.release()
      }
    } finally {
      ex.release()
    }
  }

  /**
   * Feeds the decoder on its own thread, so reading samples from the file overlaps the
   * frame work on the decode thread and the codec always has input queued (sync-mode
   * MediaCodec takes input and output calls from different threads). The extractor is only
   * touched here once started. [finish] must be called before the codec is stopped.
   */
  private class Feeder(private val ex: MediaExtractor, private val codec: MediaCodec) : Thread("golf-swing-feed") {
    @Volatile var error: Throwable? = null
    @Volatile var lastInputNs = System.nanoTime()
    @Volatile private var stopping = false

    init {
      isDaemon = true
    }

    override fun run() {
      PerfHint.raiseThisThread()
      try {
        while (!stopping) {
          val i = codec.dequeueInputBuffer(5_000)
          if (i < 0) continue
          val size = ex.readSampleData(codec.getInputBuffer(i)!!, 0)
          if (size < 0) {
            codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            return
          }
          codec.queueInputBuffer(i, 0, size, ex.sampleTime, 0)
          ex.advance()
          lastInputNs = System.nanoTime()
        }
      } catch (e: Throwable) {
        if (!stopping) error = e
      }
    }

    fun finish() {
      stopping = true
      join(1_000)
    }
  }

  /** Long side above which frames are kept at half size (4K → 1080p class): memory and time. */
  const val DECIMATE_ABOVE = 1920

  /** 1, or 2 for frames whose long side is over [DECIMATE_ABOVE]. */
  fun decimation(w: Int, h: Int) = if (max(w, h) > DECIMATE_ABOVE) 2 else 1

  /** YUV420 with 16-bit samples (P010: 10 bits in the high bits, little-endian). */
  private const val YCBCR_P010 = 0x36

  /**
   * Copies the Image (crop applied; every 2nd pixel and row above [DECIMATE_ABOVE]) into
   * [f], which must be [frameSize]. 10-bit frames (P010) keep the high byte of each sample, i.e. the top 8 bits.
   */
  fun copy(img: Image, f: YuvFrame) {
    val c = img.cropRect
    val step = decimation(c.width(), c.height())
    val p = img.planes
    val hi = if (img.format == YCBCR_P010 || p[0].pixelStride == 2) 1 else 0
    plane(p[0].buffer, p[0].rowStride, p[0].pixelStride, hi, c.left, c.top, f.codedW, f.codedH, step, f.y)
    plane(p[1].buffer, p[1].rowStride, p[1].pixelStride, hi, c.left / 2, c.top / 2, f.cw, f.ch, step, f.u)
    plane(p[2].buffer, p[2].rowStride, p[2].pixelStride, hi, c.left / 2, c.top / 2, f.cw, f.ch, step, f.v)
  }

  /**
   * One plane into a packed [w] × [h] array: sample (x, y) of the output is the byte at
   * ((y0 + y·step)·rowStride + (x0 + x·step)·pixelStride + [hiByte]). Pure JVM for tests.
   * The last row of a plane may be shorter than rowStride (Image buffers end at the last
   * pixel), so reads never go past what that row holds.
   */
  internal fun plane(buf: ByteBuffer, rowStride: Int, pixelStride: Int, hiByte: Int, x0: Int, y0: Int, w: Int, h: Int, step: Int, dst: ByteArray) {
    val ps = pixelStride * step
    if (ps == 1) {
      for (row in 0 until h) {
        buf.position((y0 + row * step) * rowStride + x0)
        buf.get(dst, row * w, w)
      }
      return
    }
    val span = (w - 1) * ps + 1 + hiByte
    val tmp = ByteArray(span)
    for (row in 0 until h) {
      val pos = (y0 + row * step) * rowStride + x0 * pixelStride
      buf.position(pos)
      buf.get(tmp, 0, min(span, buf.limit() - pos))
      var k = hiByte
      val o = row * w
      for (c in 0 until w) {
        dst[o + c] = tmp[k]
        k += ps
      }
    }
  }

  /**
   * Quarter-size grey for the duplicate-frame check, read straight from the Image: per 4 × 4
   * block, the mean of the 4 pixels of its second row (a quarter of the luma reads of a full
   * block mean; a repeated frame still differs by ~0, which is all the check needs).
   */
  fun quarterGray(img: Image, fullRange: Boolean, out: FloatArray?): FloatArray {
    val c = img.cropRect
    val p = img.planes[0]
    val hi = if (img.format == YCBCR_P010 || p.pixelStride == 2) 1 else 0
    val w = c.width() / 4
    val h = c.height() / 4
    val dst = out?.takeIf { it.size == w * h } ?: FloatArray(w * h)
    val row = ByteArray(4 * w)
    val scale = if (fullRange) 1f / 4 else 255f / 219 / 4
    for (by in 0 until h) {
      plane(p.buffer, p.rowStride, p.pixelStride, hi, c.left, c.top + 4 * by + 1, 4 * w, 1, 1, row)
      var k = 0
      for (bx in 0 until w) {
        val s = (row[k].toInt() and 0xFF) + (row[k + 1].toInt() and 0xFF) + (row[k + 2].toInt() and 0xFF) + (row[k + 3].toInt() and 0xFF)
        dst[by * w + bx] = s * scale
        k += 4
      }
    }
    return dst
  }

  /** The size [copy] writes for this Image: the crop, halved when decimated. */
  fun frameSize(img: Image): Pair<Int, Int> {
    val w = img.cropRect.width()
    val h = img.cropRect.height()
    val d = decimation(w, h)
    return Pair(w / d, h / d)
  }
}

/** The clip can't be analysed on this phone (e.g. no readable frames from its decoder). */
internal class UnsupportedVideoException(msg: String) : RuntimeException(msg)
