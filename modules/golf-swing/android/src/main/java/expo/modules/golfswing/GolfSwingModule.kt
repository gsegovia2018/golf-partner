package expo.modules.golfswing

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Bump on EVERY change to the JS-visible contract (plan §3, S10): src/swing/native.js
 * refuses to call a binary whose apiVersion is older than the one it was written for, so an
 * OTA bundle never calls a method the installed APK lacks.
 */
const val API_VERSION = 1

private const val MIN_HEIGHT_CM = 120.0
private const val MAX_HEIGHT_CM = 230.0

/** Pass-1 strides (sparse165, [SamplingPolicy]): still / motion start → top / impact → finish. */
class SamplingOptions : Record {
  @Field val sparseEvery: Int = 16
  @Field val midEvery: Int = 4
  @Field val followEvery: Int = 2
}

class AnalyzePoseOptions : Record {
  @Field val model: String = "full"
  @Field val sampling: SamplingOptions = SamplingOptions()
  /** Mirrors the ball search and the lead/trail sides (plan D6). null/unknown = right. */
  @Field val handedness: String? = null
  /** Only sizes the expected ball blob (§4.6); the JS keeps the authoritative scale. null = 176. */
  @Field val heightCm: Double? = null
  /**
   * Capture rate of one container frame step (the sampling policy's time base, §4.2): the
   * JS passes the probe's captureFps or its fps model. null = the file's capture-rate tag,
   * else 240 (a 30 fps slow-mo container samples like a 240 fps recording).
   */
  @Field val captureFps: Double? = null
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
  private val executor = Executors.newSingleThreadExecutor { Thread(it, "golf-swing").apply { isDaemon = true } }
  private val busy = AtomicBoolean(false)
  /** One token per running or queued job: cancelAnalysis stops those, never a later call. */
  private val jobs = ConcurrentHashMap.newKeySet<AtomicBoolean>()

  private fun <T> job(promise: Promise, code: String, work: (cancelled: () -> Boolean) -> T, done: () -> Unit = {}) {
    val token = AtomicBoolean(false)
    jobs.add(token)
    try {
      executor.execute {
        try {
          if (token.get()) throw CancelledException()
          promise.resolve(work { token.get() })
        } catch (e: CancelledException) {
          promise.reject("ERR_CANCELLED", "cancelled", e)
        } catch (e: UnsupportedVideoException) {
          promise.reject("ERR_UNSUPPORTED_VIDEO", e.message ?: "unsupported video", e)
        } catch (e: Throwable) {
          promise.reject(code, e.message ?: e.toString(), e)
        } finally {
          jobs.remove(token)
          done()
        }
      }
    } catch (e: RejectedExecutionException) {
      jobs.remove(token)
      done()
      promise.reject(code, "the module is shutting down", e)
    }
  }

  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("GolfSwing")

    Constants("apiVersion" to API_VERSION)

    Events("progress")

    AsyncFunction("probeVideo") { path: String, promise: Promise ->
      val ctx = context
      job(promise, "ERR_PROBE", { Probe.run(ctx, path) })
    }

    AsyncFunction("analyzePose") { path: String, options: AnalyzePoseOptions?, promise: Promise ->
      if (!busy.compareAndSet(false, true)) {
        promise.reject("ERR_BUSY", "an analysis is already running", null)
        return@AsyncFunction
      }
      val o = options ?: AnalyzePoseOptions()
      val ctx = context
      job(promise, "ERR_ANALYZE", { cancelled ->
        val opts = AnalyzeOptions(
          model = o.model,
          sparseEvery = o.sampling.sparseEvery.coerceAtLeast(1),
          midEvery = o.sampling.midEvery.coerceAtLeast(1),
          followEvery = o.sampling.followEvery.coerceAtLeast(1),
          rightHanded = o.handedness != "left",
          heightCm = (o.heightCm?.takeIf { it.isFinite() } ?: Ball.DEFAULT_HEIGHT_CM).coerceIn(MIN_HEIGHT_CM, MAX_HEIGHT_CM),
          captureFps = o.captureFps?.takeIf { it.isFinite() && it > 0 },
        )
        PoseAnalyzer(ctx, opts, cancelled) { stage, done, total ->
          sendEvent("progress", mapOf("stage" to stage, "done" to done, "total" to total))
        }.run(path)
      }, done = { busy.set(false) })
    }

    /** Stops a running analyzePose or still extraction at the next frame (rejects with ERR_CANCELLED). */
    Function("cancelAnalysis") {
      jobs.forEach { it.set(true) }
    }

    // N1 stub of the N2 contract: stills only. shaft stays empty and addressFrame null until
    // N2 adds the clubhead search and the image-based address onset (plan §4.3, §5.1 P1).
    AsyncFunction("extractCheckpoints") { path: String, options: ExtractCheckpointsOptions, promise: Promise ->
      val ctx = context
      job(promise, "ERR_STILLS", { cancelled ->
        val wanted = options.frames.flatMap { c -> (c.i - c.neighbours)..(c.i + c.neighbours) }
        val uris = Stills.extract(ctx, path, wanted, options.outDir, cancelled)
        val stills = options.frames.associate { c ->
          c.key to ((c.i - c.neighbours)..(c.i + c.neighbours)).mapNotNull { f -> uris[f]?.let { f.toString() to it } }.toMap()
        }
        mapOf("stills" to stills, "shaft" to emptyMap<String, Any?>(), "addressFrame" to null)
      })
    }

    /** Edit-marks scrubber: JPEGs of arbitrary frames, `<outDir>/<frame>.jpg` → { [frame]: uri }. */
    AsyncFunction("extractFrames") { path: String, options: ExtractFramesOptions, promise: Promise ->
      val ctx = context
      job(promise, "ERR_STILLS", { cancelled ->
        Stills.extract(ctx, path, options.frames, options.outDir, cancelled).mapKeys { it.key.toString() }
      })
    }

    OnDestroy {
      jobs.forEach { it.set(true) }
      executor.shutdownNow()
    }
  }
}
