package com.golfpartner.wear.ui

import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.mutableFloatStateOf
import kotlinx.coroutines.delay
import com.golfpartner.wear.data.Blocked
import com.golfpartner.wear.data.DistanceReading
import com.golfpartner.wear.data.DistanceSource
import com.golfpartner.wear.data.Units
import com.golfpartner.wear.data.WatchState
import com.golfpartner.wear.ui.theme.Hud
import kotlin.math.abs

/** Crown pixels per hole step. */
private const val CROWN_STEP_PX = 70f

/** How long a crown-selected hole waits for the phone before snapping back to what the state says. */
private const val CROWN_SETTLE_MS = 2_500L

data class HomeInfo(
    val reading: DistanceReading,
    val locationDenied: Boolean,
    val pendingHoles: Int,
    val phoneConnected: Boolean,
)

/**
 * One screen per hole: distances (centre largest), SI/shots, and the pill.
 * Crown = previous/next hole. Blocked states keep the distances and drop the
 * pill (dispute says why; view-only and official just have none).
 */
@Composable
fun HomeScreen(
    state: WatchState,
    info: HomeInfo,
    onScore: () -> Unit,
    onGoToHole: (Int) -> Unit,
) {
    val hole = state.hole ?: return
    val me = state.me
    val haptics = LocalHapticFeedback.current
    val focus = remember { FocusRequester() }
    var target by remember(hole.number) { mutableIntStateOf(hole.number) }
    var carry by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) { focus.requestFocus() }
    LaunchedEffect(target) {
        if (target != hole.number) {
            delay(CROWN_SETTLE_MS)
            target = hole.number
        }
    }

    val canNavigate = state.canEnter
    Column(
        modifier = Modifier
            .fillMaxSize()
            .onRotaryScrollEvent { e ->
                if (!canNavigate) return@onRotaryScrollEvent false
                carry += e.verticalScrollPixels
                if (abs(carry) >= CROWN_STEP_PX) {
                    val next = (target + if (carry > 0) 1 else -1).coerceIn(1, hole.count)
                    carry = 0f
                    if (next != target) {
                        target = next
                        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        onGoToHole(next)
                    }
                }
                true
            }
            .focusRequester(focus)
            .focusable()
            .padding(top = 14.dp, bottom = 10.dp, start = 24.dp, end = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Caption(Copy.holeHeader(hole.number, hole.par))
        Spacer(Modifier.weight(1f))
        Distances(info, state.units)
        Spacer(Modifier.weight(1f))
        Footer(state, info)
        Spacer(Modifier.height(4.dp))
        val strokes = me?.strokes
        when {
            state.blocked == Blocked.Dispute -> HudText(Copy.RESOLVE_ON_PHONE, 15, color = Hud.warn, weight = FontWeight.Bold,
                modifier = Modifier.height(TouchMin))
            !state.canEnter -> Spacer(Modifier.height(TouchMin))
            strokes == null -> PrimaryButton(Copy.SCORE_HOLE, onScore)
            else -> GhostButton(Copy.ghostPill(strokes, me.points ?: 0), onScore)
        }
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
        info.pendingHoles > 0 -> HudText(Copy.waiting(info.pendingHoles), 12, color = Hud.warn, weight = FontWeight.SemiBold)
        !info.phoneConnected -> HudText(Copy.PHONE_NOT_CONNECTED, 12, color = Hud.warn, weight = FontWeight.SemiBold)
        else -> Copy.strokeIndex(hole.si, hole.extraShots)?.let { HudText(it, 12, color = Hud.textMuted) }
    }
}
