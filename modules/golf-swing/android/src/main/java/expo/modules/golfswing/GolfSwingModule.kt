package expo.modules.golfswing

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Bump on EVERY change to the JS-visible contract (plan §3, S10): src/swing/native.js
 * refuses to call a binary whose apiVersion is older than the one it was written for, so an
 * OTA bundle never calls a method the installed APK lacks.
 */
const val API_VERSION = 1

class SamplingOptions : Record {
  @Field val sparseEvery: Int = 8
  @Field val afterImpactEvery: Int = 2
  @Field val denseEvery: Int = 1
}

class AnalyzePoseOptions : Record {
  @Field val model: String = "full"
  @Field val sampling: SamplingOptions = SamplingOptions()
  /** Mirrors the ball search and the lead/trail sides (plan D6). */
  @Field val handedness: String = "right"
  /** Only sizes the expected ball blob (§4.6); the JS keeps the authoritative scale. */
  @Field val heightCm: Double = Ball.DEFAULT_HEIGHT_CM
}

class CheckpointRequest : Record {
  @Field val key: String = ""
  @Field val i: Int = 0
  @Field val neighbours: Int = 2
}

/** hands, ball and expectedShaftPx are accepted and unused until N2 (shaft/clubhead, address onset). */
class ExtractCheckpointsOptions : Record {
  @Field val frames: List<CheckpointRequest> = emptyList()
  @Field val outDir: String = ""
}

class ExtractFramesOptions : Record {
  @Field val frames: List<Int> = emptyList()
  @Field val outDir: String = ""
}

class GolfSwingModule : Module() {
  // Long-running work gets its own thread: Expo's shared async queue would stall every
  // other module's async calls for the seconds an analysis takes.
  private val executor = Executors.newSingleThreadExecutor { Thread(it, "golf-swing") }
  private val busy = AtomicBoolean(false)
  @Volatile private var cancelRequested = false

  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("GolfSwing")

    Constants("apiVersion" to API_VERSION)

    Events("progress")

    AsyncFunction("probeVideo") { path: String, promise: Promise ->
      val ctx = context
      executor.execute {
        try {
          promise.resolve(Probe.run(ctx, path))
        } catch (e: Throwable) {
          promise.reject("ERR_PROBE", e.message ?: e.toString(), e)
        }
      }
    }

    AsyncFunction("analyzePose") { path: String, options: AnalyzePoseOptions?, promise: Promise ->
      if (!busy.compareAndSet(false, true)) {
        promise.reject("ERR_BUSY", "an analysis is already running", null)
        return@AsyncFunction
      }
      val o = options ?: AnalyzePoseOptions()
      val ctx = context
      cancelRequested = false
      executor.execute {
        try {
          val opts = AnalyzeOptions(
            model = o.model,
            sparseEvery = o.sampling.sparseEvery.coerceAtLeast(1),
            afterImpactEvery = o.sampling.afterImpactEvery.coerceAtLeast(1),
            denseEvery = o.sampling.denseEvery.coerceAtLeast(1),
            rightHanded = o.handedness != "left",
            heightCm = o.heightCm,
          )
          val result = PoseAnalyzer(ctx, opts, { cancelRequested }) { stage, done, total ->
            sendEvent("progress", mapOf("stage" to stage, "done" to done, "total" to total))
          }.run(path)
          promise.resolve(result)
        } catch (e: CancelledException) {
          promise.reject("ERR_CANCELLED", "analysis cancelled", e)
        } catch (e: Throwable) {
          promise.reject("ERR_ANALYZE", e.message ?: e.toString(), e)
        } finally {
          busy.set(false)
        }
      }
    }

    /** Stops a running analyzePose or still extraction at the next frame (rejects with ERR_CANCELLED). */
    Function("cancelAnalysis") {
      cancelRequested = true
    }

    // N1 stub of the N2 contract: stills only. shaft stays empty and addressFrame null until
    // N2 adds the clubhead search and the image-based address onset (plan §4.3, §5.1 P1).
    AsyncFunction("extractCheckpoints") { path: String, options: ExtractCheckpointsOptions, promise: Promise ->
      val ctx = context
      cancelRequested = false
      executor.execute {
        try {
          val wanted = options.frames.flatMap { c -> (c.i - c.neighbours)..(c.i + c.neighbours) }
          val uris = Stills.extract(ctx, path, wanted, options.outDir) { cancelRequested }
          val stills = options.frames.associate { c ->
            c.key to ((c.i - c.neighbours)..(c.i + c.neighbours)).mapNotNull { f -> uris[f]?.let { f.toString() to it } }.toMap()
          }
          promise.resolve(mapOf("stills" to stills, "shaft" to emptyMap<String, Any?>(), "addressFrame" to null))
        } catch (e: CancelledException) {
          promise.reject("ERR_CANCELLED", "cancelled", e)
        } catch (e: Throwable) {
          promise.reject("ERR_STILLS", e.message ?: e.toString(), e)
        }
      }
    }

    /** Edit-marks scrubber: JPEGs of arbitrary frames, `<outDir>/<frame>.jpg` → { [frame]: uri }. */
    AsyncFunction("extractFrames") { path: String, options: ExtractFramesOptions, promise: Promise ->
      val ctx = context
      cancelRequested = false
      executor.execute {
        try {
          val uris = Stills.extract(ctx, path, options.frames, options.outDir) { cancelRequested }
          promise.resolve(uris.mapKeys { it.key.toString() })
        } catch (e: CancelledException) {
          promise.reject("ERR_CANCELLED", "cancelled", e)
        } catch (e: Throwable) {
          promise.reject("ERR_STILLS", e.message ?: e.toString(), e)
        }
      }
    }

    OnDestroy {
      executor.shutdownNow()
    }
  }
}
