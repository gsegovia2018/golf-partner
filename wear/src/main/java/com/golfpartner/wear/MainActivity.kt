package com.golfpartner.wear

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.golfpartner.wear.data.WatchController
import com.golfpartner.wear.ui.GolfPartnerApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

/**
 * Screen-on policy: nothing special. FLAG_KEEP_SCREEN_ON would hold the panel
 * lit for the whole round; instead the app follows the system (the watch
 * dims, then the user raises the wrist or the "keep app on" setting applies)
 * and the controller only runs while the activity is started.
 */
class MainActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var controller: WatchController
    private var locationDenied by mutableStateOf(false)

    // FINE and COARSE together: Android 12+ lets the user grant only approximate location,
    // which is still usable (the accuracy gate then mostly falls back to the phone's distances).
    private val askLocation = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val granted = result.values.any { it }
        locationDenied = !granted
        if (granted) controller.locationPermissionGranted()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        controller = WatchController(applicationContext, scope)
        if (!controller.hasLocationPermission()) askLocation.launch(
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
        )
        setContent { GolfPartnerApp(controller, locationDenied) }
    }

    override fun onStart() {
        super.onStart()
        controller.start()
    }

    override fun onStop() {
        controller.stop()
        super.onStop()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
