package expo.modules.golfswing

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer

/**
 * Frame stills as JPEG (plan §3 extractCheckpoints' stills, D4; extractFrames for the
 * Edit-marks scrubber). One decoder session over the sorted targets: it decodes forward
 * through nearby targets and seeks (flush + previous sync frame) only when a keyframe lies
 * between what it has decoded and the next target, so no target costs more than one GOP.
 */
internal object Stills {
  private const val JPEG_QUALITY = 85

  /** Writes `<outDir>/<frame>.jpg` for every requested frame; returns frame → file:// URI. */
  fun extract(context: Context, path: String, frames: Collection<Int>, outDir: String, cancelled: () -> Boolean): Map<Int, String> {
    val dir = File(Media.localPath(outDir)).apply { mkdirs() }
    val track = Media.scan(context, path)
    val (pts, syncs) = sampleTimes(context, path)
    val wanted = frames.filter { it in pts.indices }.distinct().sorted()
    val byPts = wanted.associateBy { pts[it] }
    val out = HashMap<Int, String>()
    if (wanted.isEmpty()) return out

    val ex = Media.extractor(context, path)
    try {
      val trackIdx = (0 until ex.trackCount).first { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)!!.startsWith("video/") }
      ex.selectTrack(trackIdx)
      val fmt = ex.getTrackFormat(trackIdx)
      fmt.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
      val codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
      try {
        codec.configure(fmt, null, null, 0)
        codec.start()
        val info = MediaCodec.BufferInfo()
        var next = 0
        var lastOut = Long.MIN_VALUE
        var inputDone = false
        fun seekIfWorth() {
          val target = pts[wanted[next]]
          val sync = syncs.lastOrNull { it <= target } ?: return
          if (sync > lastOut) {
            // flushing before the first output would drop the codec-specific data (MediaCodec
            // docs); the first seek happens before any input, where no flush is needed
            if (lastOut != Long.MIN_VALUE) codec.flush()
            ex.seekTo(sync, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            inputDone = false
            lastOut = sync - 1
          }
        }
        seekIfWorth()
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
            }
          }
          val o = codec.dequeueOutputBuffer(info, 2_000)
          if (o < 0) continue
          val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          val frame = byPts[info.presentationTimeUs]
          if (info.size > 0) lastOut = info.presentationTimeUs
          if (frame != null && info.size > 0 && frame !in out) {
            codec.getOutputImage(o)?.use { img ->
              val (w, h) = Media.cropSize(img)
              val of = codec.outputFormat
              val full = of.containsKey(MediaFormat.KEY_COLOR_RANGE) && of.getInteger(MediaFormat.KEY_COLOR_RANGE) == MediaFormat.COLOR_RANGE_FULL
              val f = YuvFrame(w, h, track.rotation, full)
              Media.copy(img, f)
              val file = File(dir, "$frame.jpg")
              writeJpeg(f, file)
              out[frame] = "file://${file.absolutePath}"
            }
          }
          codec.releaseOutputBuffer(o, false)
          if (eos) break
          var moved = false
          while (next < wanted.size && wanted[next] in out) {
            next++
            moved = true
          }
          if (moved && next < wanted.size) seekIfWorth()
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
    return out
  }

  /** Presentation times in frame order and the sync-sample times, from the sample table. */
  private fun sampleTimes(context: Context, path: String): Pair<LongArray, LongArray> {
    val ex = Media.extractor(context, path)
    try {
      val t = (0 until ex.trackCount).first { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)!!.startsWith("video/") }
      ex.selectTrack(t)
      val all = ArrayList<Long>()
      val sync = ArrayList<Long>()
      while (ex.sampleTime >= 0) {
        all.add(ex.sampleTime)
        if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) sync.add(ex.sampleTime)
        if (!ex.advance()) break
      }
      return Pair(all.sorted().toLongArray(), sync.sorted().toLongArray())
    } finally {
      ex.release()
    }
  }

  private fun writeJpeg(f: YuvFrame, file: File) {
    val w = f.dispW
    val h = f.dispH
    val stride = rgbRowBytes(w)
    val rgb = ByteBuffer.allocateDirect(stride * h)
    f.toRgb(w, h, rgb)
    val px = IntArray(w * h)
    for (y in 0 until h) for (x in 0 until w) {
      val k = y * stride + 3 * x
      px[y * w + x] = (0xFF shl 24) or ((rgb.get(k).toInt() and 0xFF) shl 16) or
        ((rgb.get(k + 1).toInt() and 0xFF) shl 8) or (rgb.get(k + 2).toInt() and 0xFF)
    }
    val bmp = Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
    try {
      FileOutputStream(file).use { bmp.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
    } finally {
      bmp.recycle()
    }
  }
}

internal class CancelledException : RuntimeException("cancelled")
