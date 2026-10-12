package expo.modules.golfswing.camera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraConstrainedHighSpeedCaptureSession
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.MediaCodec
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Range
import android.view.Surface
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * One back camera feeding a preview surface and a MediaRecorder (plan §3 "Camera").
 *
 * A constrained high-speed session takes exactly two surfaces, fixed when it is created: the
 * preview and the recorder. The recorder input is therefore a persistent surface
 * (`MediaCodec.createPersistentInputSurface`) that outlives every MediaRecorder, so the session
 * is built once per mode and each take only swaps the repeating request (preview only ⇄
 * preview + recorder). The same flow runs an ordinary session when the phone has no
 * high-speed mode (the fallback). No audio source, ever.
 *
 * Every field is confined to [thread]; public methods post to it. Callbacks from a session
 * that has since been closed are recognised by [gen] and dropped, so a late `onOpened` can
 * never leak a camera.
 */
internal class CameraSession(private val context: Context, private val events: Events) {
  interface Events {
    fun onReady(mode: RecordingMode)
    fun onError(code: String, message: String)
    /** A take was running when the camera went away (background, detach, error); its file is deleted. */
    fun onInterrupted(reason: String)
  }

  private class Take(val recorder: MediaRecorder, val file: File, val startedAt: Long)

  private val thread = HandlerThread("golf-swing-camera").apply { start() }
  private val handler = Handler(thread.looper)
  private val manager = context.getSystemService(CameraManager::class.java)

  private var gen = 0
  private var released = false
  private var mode: RecordingMode? = null
  private var orientationHint = 90
  private var device: CameraDevice? = null
  private var session: CameraCaptureSession? = null
  private var previewSurface: Surface? = null
  private var inputSurface: Surface? = null
  private var take: Take? = null

  /** Opens [mode] on [texture]; closes whatever was open first. [displayRotationDeg] sets the file's orientation hint. */
  fun open(texture: SurfaceTexture, mode: RecordingMode, displayRotationDeg: Int) {
    handler.post {
      closeInternal("reconfigured")
      if (released) return@post
      val my = gen
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
        events.onError("ERR_PERMISSION", "camera permission not granted")
        return@post
      }
      this.mode = mode
      // Back camera: rotate the sensor image by its orientation, minus the display's rotation.
      orientationHint = (CameraModes.sensorOrientation(context, mode.cameraId) - displayRotationDeg + 360) % 360
      texture.setDefaultBufferSize(mode.width, mode.height)
      previewSurface = Surface(texture)
      try {
        manager.openCamera(mode.cameraId, object : CameraDevice.StateCallback() {
          override fun onOpened(d: CameraDevice) {
            if (my != gen) { d.close(); return }
            device = d
            configure(my)
          }

          override fun onDisconnected(d: CameraDevice) {
            d.close()
            if (my != gen) return
            closeInternal("disconnected")
            events.onError("ERR_CAMERA_DISCONNECTED", "another app took the camera")
          }

          override fun onError(d: CameraDevice, error: Int) {
            d.close()
            if (my != gen) return
            closeInternal("error")
            events.onError("ERR_CAMERA", "camera error $error")
          }
        }, handler)
      } catch (e: Exception) {
        closeInternal(null)
        events.onError("ERR_CAMERA", e.message ?: e.toString())
      }
    }
  }

  private fun configure(my: Int) {
    val d = device ?: return
    val m = mode ?: return
    val preview = previewSurface ?: return
    try {
      val input = MediaCodec.createPersistentInputSurface()
      inputSurface = input
      // A throwaway recorder gives the persistent surface its size and format before the
      // session is built on it (the camera rejects a surface it can't size).
      val probe = File(context.cacheDir, "golf-swing-camera-probe.mp4")
      try {
        recorder(input, m, probe).apply { prepare(); release() }
      } finally {
        probe.delete()
      }
      val callback = object : CameraCaptureSession.StateCallback() {
        override fun onConfigured(s: CameraCaptureSession) {
          if (my != gen) { s.close(); return }
          session = s
          try {
            repeat(withRecorder = false)
            events.onReady(m)
          } catch (e: Exception) {
            closeInternal(null)
            events.onError("ERR_SESSION", e.message ?: e.toString())
          }
        }

        override fun onConfigureFailed(s: CameraCaptureSession) {
          s.close()
          if (my != gen) return
          closeInternal(null)
          events.onError("ERR_SESSION", "the camera refused ${m.width}x${m.height} at ${m.fps} fps")
        }
      }
      @Suppress("DEPRECATION")
      if (m.highSpeed) {
        d.createConstrainedHighSpeedCaptureSession(listOf(preview, input), callback, handler)
      } else {
        d.createCaptureSession(listOf(preview, input), callback, handler)
      }
    } catch (e: Exception) {
      closeInternal(null)
      events.onError("ERR_SESSION", e.message ?: e.toString())
    }
  }

  private fun repeat(withRecorder: Boolean) {
    val s = session ?: return
    val d = device ?: return
    val m = mode ?: return
    val builder = d.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
      addTarget(previewSurface!!)
      if (withRecorder) addTarget(inputSurface!!)
      // High speed: fixed [fps, fps] while recording, the variable preview range otherwise.
      val lower = if (m.highSpeed && !withRecorder) m.previewMin else m.recordMin
      set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(lower, m.fps))
    }
    if (s is CameraConstrainedHighSpeedCaptureSession) {
      s.setRepeatingBurst(s.createHighSpeedRequestList(builder.build()), null, handler)
    } else {
      s.setRepeatingRequest(builder.build(), null, handler)
    }
  }

  private fun recorder(surface: Surface, m: RecordingMode, file: File): MediaRecorder {
    val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
    r.setVideoSource(MediaRecorder.VideoSource.SURFACE)
    r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
    r.setOutputFile(file.absolutePath)
    r.setVideoEncodingBitRate(bitRate(m))
    r.setVideoFrameRate(m.fps)
    // Real-time file with the capture-rate tag (probeVideo's captureFps): no retiming (plan §3).
    if (m.highSpeed) r.setCaptureRate(m.fps.toDouble())
    r.setVideoSize(m.width, m.height)
    r.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
    r.setInputSurface(surface)
    r.setOrientationHint(orientationHint)
    return r
  }

  /** ~20 Mbps at 720p240 (plan §3); a little more per pixel at ordinary rates. */
  private fun bitRate(m: RecordingMode): Int {
    val bpp = if (m.highSpeed) 0.09 else 0.15
    return (m.width.toDouble() * m.height * m.fps * bpp).toInt().coerceIn(4_000_000, 60_000_000)
  }

  fun startRecording(path: String, promise: Promise) {
    handler.post {
      val m = mode
      val input = inputSurface
      if (session == null || m == null || input == null) {
        promise.reject("ERR_NOT_READY", "the camera is not ready", null)
        return@post
      }
      if (take != null) {
        promise.reject("ERR_RECORDING", "already recording", null)
        return@post
      }
      val file = File(Uri.parse(path).path ?: path)
      file.parentFile?.mkdirs()
      val r = recorder(input, m, file)
      try {
        r.prepare()
        repeat(withRecorder = true)
        r.start()
        take = Take(r, file, SystemClock.elapsedRealtime())
        promise.resolve(null)
      } catch (e: Exception) {
        r.release()
        file.delete()
        try { repeat(withRecorder = false) } catch (_: Exception) { /* the session is gone; onError follows */ }
        promise.reject("ERR_RECORD_START", e.message ?: e.toString(), e)
      }
    }
  }

  fun stopRecording(promise: Promise) {
    handler.post {
      val t = take
      val m = mode
      if (t == null || m == null) {
        promise.reject("ERR_NOT_RECORDING", "not recording", null)
        return@post
      }
      take = null
      val durationMs = SystemClock.elapsedRealtime() - t.startedAt
      // Stop feeding the encoder before stopping it.
      try { repeat(withRecorder = false) } catch (_: Exception) { /* closing anyway */ }
      try {
        t.recorder.stop()
      } catch (e: RuntimeException) {
        // MediaRecorder.stop throws when no frame reached the file.
        t.recorder.release()
        t.file.delete()
        promise.reject("ERR_NO_FRAMES", "the take was too short to save", e)
        return@post
      }
      t.recorder.release()
      promise.resolve(
        mapOf(
          "path" to Uri.fromFile(t.file).toString(),
          "fps" to m.fps,
          "width" to m.width,
          "height" to m.height,
          "highSpeed" to m.highSpeed,
          "durationMs" to durationMs,
        )
      )
    }
  }

  /** Closes the camera; with [wait] the caller blocks (≤ 1.5 s) until it is really closed. */
  fun close(wait: Boolean = false) {
    val done = CountDownLatch(1)
    val posted = handler.post {
      closeInternal("closed")
      done.countDown()
    }
    if (wait && posted) done.await(1500, TimeUnit.MILLISECONDS)
  }

  /** Closes the camera and ends the thread. The instance is dead afterwards. */
  fun release() {
    val done = CountDownLatch(1)
    val posted = handler.post {
      closeInternal("closed")
      released = true
      done.countDown()
      thread.quitSafely()
    }
    if (posted) done.await(1500, TimeUnit.MILLISECONDS)
  }

  private fun closeInternal(reason: String?) {
    gen++
    take?.let { t ->
      take = null
      try { t.recorder.stop() } catch (_: RuntimeException) { /* nothing recorded */ }
      t.recorder.release()
      t.file.delete()
      if (reason != null) events.onInterrupted(reason)
    }
    try { session?.close() } catch (_: Exception) { /* already closed */ }
    session = null
    device?.close()
    device = null
    inputSurface?.release()
    inputSurface = null
    previewSurface?.release()
    previewSurface = null
    mode = null
  }
}
