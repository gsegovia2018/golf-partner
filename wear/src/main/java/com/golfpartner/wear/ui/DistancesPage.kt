package com.golfpartner.wear.ui

import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.golfpartner.wear.data.Blocked
import com.golfpartner.wear.data.DistanceReading
import com.golfpartner.wear.data.StepAccumulator
import com.golfpartner.wear.data.Units
import com.golfpartner.wear.data.WatchState
import com.golfpartner.wear.ui.theme.Hud

/** Vertical drag pixels per hole step. */
private const val VERTICAL_STEP_PX = 80f

data class HomeInfo(
    val reading: DistanceReading,
    val locationDenied: Boolean,
    val pendingHoles: Int,
    val phoneConnected: Boolean,
)

/**
 * The Distances page: HOLE n · PAR p, back / centre (large) / front, SI and shots.
 * Changing hole (crown, vertical swipe) is handled by the pager's owner; this page
 * shows [shownHole], which runs ahead of the phone while a move is in flight, with the
 * distances dimmed until the phone confirms (they are still the old hole's).
 */
@Composable
fun DistancesPage(
    state: WatchState,
    info: HomeInfo,
    shownHole: Int,
    onHoleSteps: (Int) -> Unit,
) {
    val hole = state.hole ?: return
    val moving = shownHole != hole.number
    val steps by rememberUpdatedState(onHoleSteps)
    val drag = remember { StepAccumulator(VERTICAL_STEP_PX) }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectVerticalDragGestures(
                    onDragStart = { drag.reset() },
                    onVerticalDrag = { change, dy ->
                        change.consume()
                        // Finger up (negative dy) = next hole.
                        val n = drag.feed(-dy)
                        if (n != 0) steps(n)
                    },
                )
            }
            .padding(top = 18.dp, bottom = 26.dp, start = 24.dp, end = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Caption(if (moving) Copy.movingTo(shownHole) else Copy.holeHeader(hole.number, hole.par))
        Spacer(Modifier.weight(1f))
        Column(Modifier.alpha(if (moving) 0.4f else 1f), horizontalAlignment = Alignment.CenterHorizontally) {
            Distances(info, state.units)
        }
        Spacer(Modifier.weight(1f))
        Footer(state, info)
    }
}

@Composable
private fun Distances(info: HomeInfo, units: Units) {
    val r = info.reading
    val suffix = if (units == Units.YD) "yd" else "m"
    if (!r.hasAny) {
        HudText("—", 52, weight = FontWeight.ExtraBold)
        HudText(suffix, 13, color = Hud.textMuted)
        HudText(if (info.locationDenied) Copy.LOCATION_OFF else Copy.GETTING_FIX, 12, color = Hud.textSoft)
        return
    }
    SmallDistance("B", r.back)
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.Center) {
        HudText(r.center?.toString() ?: "—", 56, weight = FontWeight.ExtraBold)
        HudText(suffix, 14, color = Hud.textMuted, modifier = Modifier.padding(start = 3.dp, bottom = 10.dp))
    }
    SmallDistance("F", r.front)
}

@Composable
private fun SmallDistance(label: String, value: Int?) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        HudText(label, 11, color = Hud.textMuted, weight = FontWeight.Bold)
        HudText(value?.toString() ?: "—", 22, color = Hud.textSoft, weight = FontWeight.SemiBold)
    }
}

/** One line under the distances: what is waiting, else why we are offline, else SI and shots. */
@Composable
private fun Footer(state: WatchState, info: HomeInfo) {
    val hole = state.hole ?: return
    when {
        state.blocked == Blocked.Dispute -> HudText(Copy.RESOLVE_ON_PHONE, 12, color = Hud.warn, weight = FontWeight.SemiBold)
        info.pendingHoles > 0 -> HudText(Copy.waiting(info.pendingHoles), 12, color = Hud.warn, weight = FontWeight.SemiBold)
        !info.phoneConnected -> HudText(Copy.PHONE_NOT_CONNECTED, 12, color = Hud.warn, weight = FontWeight.SemiBold)
        else -> Copy.strokeIndex(hole.si, hole.extraShots)?.let { HudText(it, 12, color = Hud.textMuted) }
    }
}
