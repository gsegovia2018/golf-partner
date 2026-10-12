package expo.modules.golfswing.camera

import android.content.Context
import android.graphics.Matrix
import android.graphics.RectF
import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.Collections
import java.util.WeakHashMap

/**
 * `GolfSwingCameraView` (plan §3): the live preview of the [RecordingMode] passed as the `mode`
 * prop, letterboxed (fit, never cropped) so what you see is exactly what is recorded.
 *
 * The camera is open only while all of these hold: the view is attached, its surface exists,
 * a mode is set and the app is in the foreground. Losing any one closes it at once (detach and
 * surface loss wait for the close, so the camera never writes into a dead surface); a take
 * running at that moment is discarded and reported through `onRecordingInterrupted`.
 */
class GolfSwingCameraView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), TextureView.SurfaceTextureListener, CameraSession.Events {

  companion object {
    /** Live views, for the module's background/foreground hooks. Main thread only. */
    internal val live: MutableSet<GolfSwingCameraView> = Collections.newSetFromMap(WeakHashMap())
  }

  private val onCameraReady by EventDispatcher()
  private val onCameraError by EventDispatcher()
  private val onRecordingInterrupted by EventDispatcher()

  private val texture = TextureView(context)

  @Volatile private var session: CameraSession? = null
  private var surface: SurfaceTexture? = null
  private var mode: RecordingMode? = null
  private var opened: RecordingMode? = null
  private var paused = false
  private var destroyed = false

  init {
    texture.surfaceTextureListener = this
    addView(texture, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    live.add(this)
  }

  // --- Props / functions (module definition) -----------------------------------------------

  fun setMode(prop: ModeProp?) {
    val next = prop?.let { p ->
      CameraModes.query(context).firstOrNull { it.matches(p.cameraId, p.width, p.height, p.fps, p.highSpeed) }
    }
    if (prop != null && next == null) {
      emitError("ERR_MODE", "this phone can't record ${prop.width}x${prop.height} at ${prop.fps} fps")
    }
    mode = next
    applyTransform()
    sync()
  }

  fun startRecording(outPath: String, promise: Promise) {
    val s = session
    if (s == null) promise.reject("ERR_NOT_READY", "the camera is not ready", null) else s.startRecording(outPath, promise)
  }

  fun stopRecording(promise: Promise) {
    val s = session
    if (s == null) promise.reject("ERR_NOT_RECORDING", "not recording", null) else s.stopRecording(promise)
  }

  fun pause() { paused = true; sync(wait = true) }

  fun resume() { paused = false; sync() }

  /** OnViewDestroys: the view will not come back. */
  fun destroy() {
    destroyed = true
    live.remove(this)
    opened = null
    session?.release()
    session = null
  }

  // --- Camera open/close --------------------------------------------------------------------

  private fun sync(wait: Boolean = false) {
    val st = surface
    val m = mode
    val want = !destroyed && !paused && isAttachedToWindow && st != null && m != null
    if (want && opened != m) {
      val s = session ?: CameraSession(context.applicationContext, this).also { session = it }
      s.open(st!!, m!!, displayRotationDeg())
      opened = m
    } else if (!want && opened != null) {
      opened = null
      session?.close(wait)
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    sync()
  }

  override fun onDetachedFromWindow() {
    // react-native-screens may detach a screen that is still mounted: close, keep the thread.
    opened = null
    session?.close(wait = true)
    super.onDetachedFromWindow()
  }

  override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
    surface = st
    applyTransform()
    sync()
  }

  override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) = applyTransform()

  override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
    surface = null
    sync(wait = true)
    return true
  }

  override fun onSurfaceTextureUpdated(st: SurfaceTexture) = Unit

  // --- Layout -------------------------------------------------------------------------------

  // React Native sizes this view but never lays out native children: do it here.
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    val w = r - l
    val h = b - t
    texture.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
    texture.layout(0, 0, w, h)
    applyTransform()
  }

  private fun displayRotationDeg(): Int = when (display?.rotation ?: Surface.ROTATION_0) {
    Surface.ROTATION_90 -> 90
    Surface.ROTATION_180 -> 180
    Surface.ROTATION_270 -> 270
    else -> 0
  }

  /**
   * The camera buffer (landscape, w×h) is stretched over the view after the producer's own
   * rotation. In portrait the picture is h×w: scale it back to its aspect and centre it.
   * Landscape displays also need the classic 90° correction (Camera2Basic `configureTransform`).
   */
  private fun applyTransform() {
    val m = mode ?: return
    val vw = texture.width.toFloat()
    val vh = texture.height.toFloat()
    if (vw <= 0f || vh <= 0f) return
    val rot = displayRotationDeg()
    val matrix = Matrix()
    if (rot == 90 || rot == 270) {
      val cx = vw / 2f
      val cy = vh / 2f
      val buffer = RectF(0f, 0f, m.height.toFloat(), m.width.toFloat())
      buffer.offset(cx - buffer.centerX(), cy - buffer.centerY())
      matrix.setRectToRect(RectF(0f, 0f, vw, vh), buffer, Matrix.ScaleToFit.FILL)
      val scale = minOf(vh / m.height, vw / m.width)
      matrix.postScale(scale, scale, cx, cy)
      matrix.postRotate(90f * (rot / 90 - 2), cx, cy)
    } else {
      val cw = m.height.toFloat()
      val ch = m.width.toFloat()
      val scale = minOf(vw / cw, vh / ch)
      matrix.setScale(cw * scale / vw, ch * scale / vh, vw / 2f, vh / 2f)
    }
    texture.setTransform(matrix)
  }

  // --- Events (camera thread → main) --------------------------------------------------------

  private fun emitError(code: String, message: String) =
    post { if (!destroyed) onCameraError(mapOf("code" to code, "message" to message)) }

  override fun onReady(mode: RecordingMode) {
    post { if (!destroyed) onCameraReady(mode.toMap()) }
  }

  override fun onError(code: String, message: String) {
    post { opened = null }
    emitError(code, message)
  }

  override fun onInterrupted(reason: String) {
    post { if (!destroyed) onRecordingInterrupted(mapOf("reason" to reason)) }
  }
}
