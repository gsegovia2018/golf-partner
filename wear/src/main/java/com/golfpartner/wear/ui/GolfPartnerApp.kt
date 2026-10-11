package com.golfpartner.wear.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.wear.compose.foundation.BasicSwipeToDismissBox
import androidx.wear.compose.foundation.rememberSwipeToDismissBoxState
import androidx.wear.compose.material3.MaterialTheme
import com.golfpartner.wear.data.CommandOutbox
import com.golfpartner.wear.data.Distances
import com.golfpartner.wear.data.Entry
import com.golfpartner.wear.data.SavedSummary
import com.golfpartner.wear.data.WatchController
import com.golfpartner.wear.data.WatchState
import com.golfpartner.wear.ui.theme.Hud
import kotlinx.coroutines.delay

private sealed interface Screen {
    data object Home : Screen
    /** [opened]: the state the entry was opened on; the save is for its round and hole. */
    data class Entry(val opened: WatchState) : Screen
    data class Saved(val summary: SavedSummary, val opened: WatchState) : Screen
}

@Composable
fun GolfPartnerApp(controller: WatchController, locationDenied: Boolean) {
    MaterialTheme {
        Box(Modifier.fillMaxSize().background(Hud.bg)) {
            val state by controller.state.collectAsState(initial = null)
            val unsupported by controller.unsupported.collectAsState()
            val connected by controller.connected.collectAsState()
            val pending by controller.pending.collectAsState()
            val fix by controller.fix.collectAsState()
            // Fix age is judged against this clock, ticked so a stalled fix goes stale on screen.
            var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
            LaunchedEffect(Unit) {
                while (true) {
                    delay(2_000)
                    now = System.currentTimeMillis()
                }
            }
            val s = state
            val pendingHoles = CommandOutbox.pendingHoles(pending, s?.roundId.takeIf { s?.active == true })

            when {
                unsupported && (s == null || !s.active) -> MessageScreen(Copy.UPDATE_WATCH)
                s == null || !s.active || s.hole == null ->
                    if (!connected && pendingHoles > 0) {
                        MessageScreen(Copy.PHONE_NOT_CONNECTED, Copy.KEPT_ON_WATCH, Copy.waiting(pendingHoles))
                    } else {
                        MessageScreen(Copy.INACTIVE)
                    }
                else -> RoundScreens(
                    state = s,
                    controller = controller,
                    info = HomeInfo(
                        reading = Distances.resolve(s.hole, s.units, fix, now),
                        locationDenied = locationDenied,
                        pendingHoles = pendingHoles,
                        phoneConnected = connected,
                    ),
                )
            }
        }
    }
}

@Composable
private fun RoundScreens(state: WatchState, controller: WatchController, info: HomeInfo) {
    val hole = state.hole!!
    var screen by remember { mutableStateOf<Screen>(Screen.Home) }
    // Entry only exists on an unblocked hole; if the phone blocks (or the round goes away) mid-entry, go home.
    // Entry and Saved belong to the hole they were opened on: if the phone moved on, go home, write nothing.
    when (val sc = screen) {
        is Screen.Entry -> if (!state.canEnter || !Entry.stillOn(sc.opened, state)) screen = Screen.Home
        is Screen.Saved -> if (!Entry.stillOn(sc.opened, state)) screen = Screen.Home
        Screen.Home -> Unit
    }

    val atHome = screen == Screen.Home
    BackHandler(enabled = !atHome) { screen = Screen.Home }
    BasicSwipeToDismissBox(
        onDismissed = { screen = Screen.Home },
        state = rememberSwipeToDismissBoxState(),
        userSwipeEnabled = !atHome,
    ) { isBackground ->
        // Behind a swipe is always home; in front is whatever we are on.
        val shown = if (isBackground) Screen.Home else screen
        Box(Modifier.fillMaxSize().background(Hud.bg)) {
            when (shown) {
                Screen.Home -> HomeScreen(
                    state = state,
                    info = info,
                    onScore = { screen = Screen.Entry(state) },
                    onGoToHole = { controller.goToHole(state, it) },
                )
                is Screen.Entry -> {
                    val opened = shown.opened
                    val plan = Entry.plan(opened.hole!!, opened.track)
                    EntryFlow(opened.hole, opened.me!!, plan) { draft ->
                        val summary = SavedSummary.of(opened, plan, draft)
                        controller.save(opened, plan, draft)
                        screen = summary?.let { Screen.Saved(it, opened) } ?: Screen.Home
                    }
                }
                is Screen.Saved -> SavedScreen(
                    summary = shown.summary,
                    pendingHoles = info.pendingHoles,
                    onNextHole = {
                        controller.goToHole(state, shown.summary.hole + 1)
                        screen = Screen.Home
                    },
                )
            }
        }
    }
}
