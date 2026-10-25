package com.golfpartner.shotsense

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Listens for shots during a live round: the microphone for strikes, the
 * gyroscope and accelerometer for the golfer's own swing. A foreground
 * service of type microphone (Android 11+ silences a mic in the background
 * without one), with its own quiet notification and a partial wake lock so
 * the screen can be off.
 *
 * Writes to [SessionStore]: `start` / `alive` (every 30 s) / `stop` markers,
 * which tell JS when it was listening; a `strike` per onset with its features,
 * the motion around it and a 1 s clip; a `swing` per gyroscope burst.
 *
 * Started with startService while the app is visible (ShotSenseModule checks),
 * so a refused startForeground just stops the service instead of crashing.
 */
class ShotSenseService : Service(), SensorEventListener {
  private var store: SessionStore? = null
  @Volatile private var stopping = false
  private var audioThread: Thread? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private val motionLock = Any()
  private val gyro = MotionWindow()
  private val accel = MotionWindow()
  private val swings = SwingDetector()

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      finish()
      return START_NOT_STICKY
    }
    val session = intent?.getStringExtra(EXTRA_SESSION) ?: return START_NOT_STICKY.also { stopSelf() }
    val title = intent.getStringExtra(EXTRA_TITLE) ?: "Listening for shots"
    if (running == session) return START_NOT_STICKY
    if (running != null) halt()
    try {
      startForegroundCompat(title)
    } catch (e: Exception) {
      Log.w(TAG, "startForeground refused", e)
      stopSelf()
      return START_NOT_STICKY
    }
    begin(session)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    halt()
    super.onDestroy()
  }

  private fun finish() {
    halt()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
    stopSelf()
  }

  private fun begin(session: String) {
    val root = SessionStore.root(this)
    SessionStore.prune(root, session)
    val s = SessionStore(root, session)
    store = s
    running = session
    stopping = false
    wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "golfpartner:shotsense")
      .apply { setReferenceCounted(false); acquire(WAKE_LOCK_MAX_MS) }
    val sm = getSystemService(Context.SENSOR_SERVICE) as SensorManager
    sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let { sm.registerListener(this, it, SENSOR_PERIOD_US) }
    sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { sm.registerListener(this, it, SENSOR_PERIOD_US) }
    audioThread = Thread({ audioLoop(s) }, "shot-sense-audio").apply { start() }
  }

  private fun halt() {
    if (running == null) return
    stopping = true
    audioThread?.join(1000)
    audioThread = null
    (getSystemService(Context.SENSOR_SERVICE) as SensorManager).unregisterListener(this)
    store?.append(JSONObject().put("type", "stop").put("t", System.currentTimeMillis()).toString())
    store = null
    running = null
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }

  // ── audio ────────────────────────────────────────────────────────────────

  private fun audioSource(): Pair<Int, String> {
    val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val unprocessed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
      am.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true"
    // Unprocessed, else voice recognition: both skip the AGC and noise
    // suppression that would flatten a strike.
    return if (unprocessed) MediaRecorder.AudioSource.UNPROCESSED to "unprocessed"
    else MediaRecorder.AudioSource.VOICE_RECOGNITION to "voice_recognition"
  }

  private fun audioLoop(s: SessionStore) {
    val sr = OnsetDetector.SAMPLE_RATE
    val (source, sourceName) = audioSource()
    val minBuf = AudioRecord.getMinBufferSize(sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val rec = try {
      AudioRecord(source, sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, max(minBuf, sr))
    } catch (e: Exception) {
      s.append(JSONObject().put("type", "error").put("t", System.currentTimeMillis()).put("error", e.toString()).toString())
      return
    }
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      s.append(JSONObject().put("type", "error").put("t", System.currentTimeMillis()).put("error", "AudioRecord not initialized").toString())
      rec.release()
      return
    }
    rec.startRecording()
    s.append(JSONObject().put("type", "start").put("t", System.currentTimeMillis()).put("source", sourceName).put("v", API_VERSION).toString())
    val detector = OnsetDetector(sr)
    val ring = AudioRing(sr * 2)
    val block = ShortArray(2048)
    val pending = ArrayDeque<OnsetDetector.Onset>()
    var nextAlive = SystemClock.elapsedRealtime() + ALIVE_MS
    try {
      while (!stopping) {
        val n = rec.read(block, 0, block.size)
        if (n < 0) break
        if (n == 0) continue
        // The block just read ends about now: that anchors sample time to the clock.
        val nowNs = SystemClock.elapsedRealtimeNanos()
        ring.write(block, n)
        pending.addAll(detector.feed(block, n))
        val total = ring.written
        while (pending.isNotEmpty() && total - pending.first().sample >= sr / 2) {
          val o = pending.removeFirst()
          strike(s, ring, o, nowNs - (total - o.sample) * 1_000_000_000L / sr)
        }
        if (SystemClock.elapsedRealtime() >= nextAlive) {
          nextAlive += ALIVE_MS
          s.append(JSONObject().put("type", "alive").put("t", System.currentTimeMillis()).toString())
        }
      }
    } finally {
      try { rec.stop() } catch (_: Exception) {}
      rec.release()
    }
  }

  private fun strike(s: SessionStore, ring: AudioRing, o: OnsetDetector.Onset, tNs: Long) {
    val sr = OnsetDetector.SAMPLE_RATE
    val t = wallMs(tNs)
    val clipStart = o.sample - sr / 2
    val clip = ring.read(clipStart, sr)
    val (g, a) = synchronized(motionLock) {
      gyro.peak(tNs - SWING_BEFORE_NS, tNs + SWING_AFTER_NS) to accel.peak(tNs - SWING_BEFORE_NS, tNs + SWING_AFTER_NS)
    }
    val json = JSONObject().put("type", "strike").put("t", t)
      .put("frameDb", round1(o.frameDb)).put("bgDb", round1(o.bgDb))
      .put("gyroPeak", round1(g.toDouble())).put("accPeak", round1(a.toDouble()))
    if (clip != null) {
      val f = StrikeFeatures.compute(clip, (o.sample - clipStart).toInt(), sr)
      json.put("peakDb", round1(f.peakDb)).put("riseMs", round1(f.riseMs)).put("decayMs", round1(f.decayMs))
        .put("centroidHz", f.centroidHz.toInt())
      val name = "$t.wav"
      s.writeClip(name, StrikeFeatures.wav(StrikeFeatures.decimate2(clip), sr / 2))
      json.put("clip", name)
    }
    s.append(json.toString())
  }

  // ── motion ───────────────────────────────────────────────────────────────

  override fun onSensorChanged(event: SensorEvent) {
    val v = event.values
    val mag = sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    when (event.sensor.type) {
      Sensor.TYPE_GYROSCOPE -> {
        val swing = synchronized(motionLock) {
          gyro.add(event.timestamp, mag)
          swings.feed(event.timestamp, mag)
        } ?: return
        val accPeak = synchronized(motionLock) { accel.peak(swing.tNs - SWING_BEFORE_NS, swing.tNs + SWING_AFTER_NS) }
        store?.append(
          JSONObject().put("type", "swing").put("t", wallMs(swing.tNs))
            .put("gyroPeak", round1(swing.peak.toDouble())).put("accPeak", round1(accPeak.toDouble())).toString(),
        )
      }
      Sensor.TYPE_ACCELEROMETER -> synchronized(motionLock) { accel.add(event.timestamp, abs(mag - SensorManager.GRAVITY_EARTH)) }
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  // ── notification ─────────────────────────────────────────────────────────

  private fun startForegroundCompat(title: String) {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, title, NotificationManager.IMPORTANCE_MIN))
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val tap = launch?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL)
    else @Suppress("DEPRECATION") Notification.Builder(this)
    val notification = builder
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(title)
      .setOngoing(true)
      .setContentIntent(tap)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  companion object {
    const val TAG = "ShotSense"
    const val ACTION_START = "com.golfpartner.shotsense.START"
    const val ACTION_STOP = "com.golfpartner.shotsense.STOP"
    const val EXTRA_SESSION = "session"
    const val EXTRA_TITLE = "title"
    const val CHANNEL = "shot-sense"
    const val NOTIFICATION_ID = 7341
    const val SENSOR_PERIOD_US = 10_000 // 100 Hz
    const val ALIVE_MS = 30_000L
    const val WAKE_LOCK_MAX_MS = 6 * 60 * 60 * 1000L
    // The downswing comes before the strike; the phone in a pocket peaks with the hips.
    const val SWING_BEFORE_NS = 1_000_000_000L
    const val SWING_AFTER_NS = 300_000_000L

    /** The session being listened to, or null. */
    @Volatile var running: String? = null
      private set

    fun wallMs(elapsedNs: Long) = System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - elapsedNs) / 1_000_000

    private fun round1(x: Double) = Math.round(x * 10) / 10.0
  }
}
