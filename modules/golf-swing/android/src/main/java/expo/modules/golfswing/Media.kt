package expo.modules.golfswing

import android.content.Context
import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
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
      return TrackInfo(w, h, ((rotation % 360) + 360) % 360, dur, n, fps, if (n > 0) lo else 0L)
    } finally {
      ex.release()
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

  /**
   * Sequential hardware decode to flexible YUV, frames handed over in presentation order with
   * a running index (= the frame number the lab's OpenCV read gives). [onFrame] returns false
   * to stop. The Image is only valid during the call. [seekUs] > 0 starts at the sync frame
   * before it (indices then count from there).
   */
  fun decode(context: Context, path: String, seekUs: Long, onFrame: (index: Int, ptsUs: Long, img: Image, fullRange: Boolean) -> Boolean) {
    val ex = extractor(context, path)
    try {
      val track = videoTrack(ex)
      ex.selectTrack(track)
      if (seekUs > 0) ex.seekTo(seekUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      val fmt = ex.getTrackFormat(track)
      fmt.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
      val codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
      try {
        codec.configure(fmt, null, null, 0)
        codec.start()
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var n = 0
        while (true) {
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
            }
          }
          val o = codec.dequeueOutputBuffer(info, 2_000)
          if (o < 0) continue
          val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          var more = true
          if (info.size > 0) {
            val img = codec.getOutputImage(o)
            if (img != null) {
              try {
                val of = codec.outputFormat
                val full = of.containsKey(MediaFormat.KEY_COLOR_RANGE) && of.getInteger(MediaFormat.KEY_COLOR_RANGE) == MediaFormat.COLOR_RANGE_FULL
                more = onFrame(n++, info.presentationTimeUs, img, full)
              } finally {
                img.close()
              }
            }
          }
          codec.releaseOutputBuffer(o, false)
          if (eos || !more) break
        }
      } finally {
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

  /** Copies the Image (crop applied) into [f], which must match the crop size. */
  fun copy(img: Image, f: YuvFrame) {
    val c = img.cropRect
    val p = img.planes
    plane(p[0], c.left, c.top, f.codedW, f.codedH, f.y)
    plane(p[1], c.left / 2, c.top / 2, f.cw, f.ch, f.u)
    plane(p[2], c.left / 2, c.top / 2, f.cw, f.ch, f.v)
  }

  private fun plane(p: Image.Plane, x0: Int, y0: Int, w: Int, h: Int, dst: ByteArray) {
    val buf = p.buffer
    val rs = p.rowStride
    val ps = p.pixelStride
    if (ps == 1) {
      for (row in 0 until h) {
        buf.position((y0 + row) * rs + x0)
        buf.get(dst, row * w, w)
      }
      return
    }
    val tmp = ByteArray((w - 1) * ps + 1)
    for (row in 0 until h) {
      val pos = (y0 + row) * rs + x0 * ps
      buf.position(pos)
      buf.get(tmp, 0, min(tmp.size, buf.limit() - pos))
      for (c in 0 until w) dst[row * w + c] = tmp[c * ps]
    }
  }

  /** The crop size of a decoder Image (what [YuvFrame] stores). */
  fun cropSize(img: Image) = Pair(img.cropRect.width(), img.cropRect.height())
}
