package com.golfpartner.wear.data

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * High-accuracy fused location, only while the app is in the foreground.
 * Wear OS fuses the paired phone's GPS when connected and its own otherwise.
 */
class WatchLocation(private val context: Context) {
    private val client = LocationServices.getFusedLocationProviderClient(context.applicationContext)
    private val _fix = MutableStateFlow<Fix?>(null)
    private var callback: LocationCallback? = null

    val fix: StateFlow<Fix?> = _fix.asStateFlow()

    /** FINE or COARSE: an approximate-only grant still runs (its fixes rarely pass the accuracy gate). */
    fun hasPermission(): Boolean =
        listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION).any {
            ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }

    @SuppressLint("MissingPermission") // guarded by hasPermission()
    fun start() {
        if (callback != null || !hasPermission()) return
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 2_000L)
            .setMinUpdateIntervalMillis(1_000L)
            .build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val l = result.lastLocation ?: return
                _fix.value = Fix(
                    lat = l.latitude,
                    lng = l.longitude,
                    accuracyM = if (l.hasAccuracy()) l.accuracy else null,
                    // wall clock, so Distances can age it against System.currentTimeMillis()
                    timeMs = System.currentTimeMillis(),
                )
            }
        }
        callback = cb
        try {
            client.requestLocationUpdates(request, cb, Looper.getMainLooper())
        } catch (e: SecurityException) {
            callback = null
        }
    }

    fun stop() {
        callback?.let { client.removeLocationUpdates(it) }
        callback = null
    }
}
