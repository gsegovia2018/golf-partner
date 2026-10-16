package expo.modules.golfswing

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.SystemClock
import java.io.File

/** One frame of a detectClub call: its still JPEG (file:// URI or path) and the grip there, normalised. */
internal class ClubFrameSpec(val frame: Int, val still: String, val grip: Pt?)

/**
 * A detectClub call (plan 2026-10-16 on demand §3.1): [width] × [height] = the video's display
 * size, the px space of the answer (like pass 2); [pxPerCm] in that space (150 cm rule);
 * [scenery] = `pass2.club.scenery` in that space, empty for swings analysed before apiVersion 5.
 */
internal class ClubDemand(
  val frames: List<ClubFrameSpec>,
  val width: Double,
  val height: Double,
  val pxPerCm: Double?,
  val scenery: List<ClubBox>,
)

/** A still as the model's input: SIZE × SIZE × 3 bytes R, G, B, and the JPEG's own size. */
internal class ClubStill(val rgb: ByteArray, val width: Int, val height: Int)

/**
 * detectClub (plan 2026-10-16 on demand §3.1): the learned detector on the still JPEGs of frames
 * the golfer chose, through the warm instance of [ClubWarm]. Per frame: JPEG → 640 × 640 RGB
 * (bilinear) → boxes → display px → [ClubRules.dropScenery] → [ClubRules.frameEntry] (the
 * 150 cm rule from the grip, head or shaft corner). A frame that fails (no still, a bad JPEG, an
 * interpreter error) gets an entry with `error` and no head; only a detector that cannot open
 * (no runtime, no model) throws, which the module turns into ERR_CLUB.
 */
internal object ClubOnDemand {
  /**
   * `{ frames: { [frame]: entry }, timings: { openMs, inferMs, decodeMs, delegate, warm } }`;
   * [decode] and [clock] are parameters so the JVM tests run it with a fake detector (no
   * android.util here: the module logs the result).
   */
  fun run(
    req: ClubDemand,
    warm: ClubWarm<out ClubModel>,
    decode: (String) -> ClubStill = ::still,
    clock: () -> Long = SystemClock::elapsedRealtime,
  ): Map<String, Any?> {
    val t0 = clock()
    return warm.use { d, wasWarm ->
      val openMs = clock() - t0
      var inferMs = 0L
      var decodeMs = 0L
      val frames = LinkedHashMap<String, Map<String, Any?>>()
      for (f in req.frames) {
        frames[f.frame.toString()] = try {
          var t = clock()
          val s = decode(f.still)
          decodeMs += clock() - t
          t = clock()
          val boxes = d.detect(s.rgb)
          inferMs += clock() - t
          // the boxes cover the whole still, which covers the whole frame: 640 units → display px
          val w = if (req.width > 0) req.width else s.width.toDouble()
          val h = if (req.height > 0) req.height else s.height.toDouble()
          val grip = f.grip?.let { Pt((it.x * w).toFloat(), (it.y * h).toFloat()) }
          entry(boxes, w / ClubDecode.SIZE, h / ClubDecode.SIZE, grip, req.pxPerCm, req.scenery)
        } catch (e: Throwable) {
          failed(e.message ?: e.toString())
        }
      }
      val timings = mapOf("openMs" to openMs.toInt(), "inferMs" to inferMs.toInt(), "decodeMs" to decodeMs.toInt(), "delegate" to d.delegate, "warm" to wasWarm)
      mapOf("frames" to frames, "timings" to timings)
    }
  }

  /** One frame's entry from its 640-unit boxes: scaled by ([sx], [sy]) to display px, scenery dropped, then pass 2's rules. */
  fun entry(boxes640: List<ClubBox>, sx: Double, sy: Double, grip: Pt?, pxPerCm: Double?, scenery: List<ClubBox>): Map<String, Any?> =
    ClubRules.frameEntry(ClubRules.dropScenery(boxes640.map { it.scaled(sx, sy) }, scenery), grip, pxPerCm)

  /** A frame that could not be read or inferred: no head, no boxes, the reason. */
  fun failed(message: String): Map<String, Any?> =
    mapOf("head" to null, "hidden" to false, "conf" to null, "source" to null, "boxes" to emptyList<Any>(), "error" to message)

  /** `{ cls, box: [x1, y1, x2, y2] }` from the JS (pass2.club.scenery) as a box; null when malformed. */
  fun sceneryBox(cls: String, box: List<Double>, score: Double?): ClubBox? {
    val c = ClubDecode.NAMES.indexOf(cls)
    if (c < 0 || box.size < 4 || box.take(4).any { !it.isFinite() }) return null
    return ClubBox(c, score?.takeIf { it.isFinite() } ?: 0.0, box[0], box[1], box[2], box[3])
  }

  /** The still JPEG (display orientation, decode size) stretched to SIZE × SIZE, bilinear. */
  fun still(uri: String): ClubStill {
    val path = Media.localPath(uri)
    if (!File(path).isFile) throw IllegalArgumentException("no still at $uri")
    val bmp = BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 })
      ?: throw IllegalArgumentException("cannot decode $uri")
    val w = bmp.width
    val h = bmp.height
    val s = ClubDecode.SIZE
    // may hand back bmp itself when it is already SIZE × SIZE
    val scaled = try {
      Bitmap.createScaledBitmap(bmp, s, s, true)
    } catch (e: Throwable) {
      bmp.recycle()
      throw e
    }
    val px = IntArray(s * s)
    try {
      scaled.getPixels(px, 0, s, 0, 0, s, s)
    } finally {
      if (scaled !== bmp) scaled.recycle()
      bmp.recycle()
    }
    val rgb = ByteArray(s * s * 3)
    for (i in px.indices) {
      val c = px[i]
      rgb[3 * i] = (c shr 16).toByte()
      rgb[3 * i + 1] = (c shr 8).toByte()
      rgb[3 * i + 2] = c.toByte()
    }
    return ClubStill(rgb, w, h)
  }
}
