package expo.modules.golfswing.camera

import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** The `mode` prop: one entry of listRecordingModes(). */
class ModeProp : Record {
  @Field val cameraId: String = ""
  @Field val width: Int = 0
  @Field val height: Int = 0
  @Field val fps: Int = 0
  @Field val highSpeed: Boolean = false
}

class StartRecordingOptions : Record {
  /** file:// URI or path of the .mp4 to write (its directory is created). */
  @Field val outPath: String = ""
}

/**
 * High-speed capture (plan §3, N3), a module of its own so the pose module (GolfSwingModule)
 * stays untouched: `listRecordingModes()` and the `GolfSwingCameraView` native view with
 * `startRecording` / `stopRecording`. Present from GolfSwing.apiVersion 2; src/swing/native.js
 * checks both before showing the camera.
 */
class GolfSwingCameraModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("GolfSwingCamera")

    /** [{ cameraId, width, height, fps, highSpeed }], best first (ModeRanking.rank). */
    AsyncFunction("listRecordingModes") {
      CameraModes.query(context).map { it.toMap() }
    }

    View(GolfSwingCameraView::class) {
      Events("onCameraReady", "onCameraError", "onRecordingInterrupted")

      Prop("mode") { view: GolfSwingCameraView, mode: ModeProp? ->
        view.setMode(mode)
      }

      /** Resolves once frames are flowing into the file. */
      AsyncFunction("startRecording") { view: GolfSwingCameraView, options: StartRecordingOptions, promise: Promise ->
        view.startRecording(options.outPath, promise)
      }

      /** → { path: 'file://…', fps, width, height, highSpeed, durationMs } */
      AsyncFunction("stopRecording") { view: GolfSwingCameraView, promise: Promise ->
        view.stopRecording(promise)
      }

      OnViewDestroys { view -> view.destroy() }
    }

    // The camera is never held in the background (plan §3 "Lifecycle", R6).
    OnActivityEntersBackground {
      main.post { GolfSwingCameraView.live.toList().forEach { it.pause() } }
    }

    OnActivityEntersForeground {
      main.post { GolfSwingCameraView.live.toList().forEach { it.resume() } }
    }
  }
}
