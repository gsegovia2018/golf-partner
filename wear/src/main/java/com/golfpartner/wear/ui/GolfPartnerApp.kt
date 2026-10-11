package com.golfpartner.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.MaterialTheme
import com.golfpartner.wear.data.CommandOutbox
import com.golfpartner.wear.data.Entry
import com.golfpartner.wear.data.PageKind
import com.golfpartner.wear.data.Pages
import com.golfpartner.wear.data.StepAccumulator
import com.golfpartner.wear.data.WatchController
import com.golfpartner.wear.data.WatchState
import com.golfpartner.wear.ui.theme.Hud
import kotlinx.coroutines.delay
import kotlin.math.abs

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
                        fix = fix,
                        nowMs = now,
                        locationDenied = locationDenied,
                        pendingHoles = pendingHoles,
                        phoneConnected = connected,
                    ),
                )
            }
        }
    }
}

/** Crown pixels per hole step / per strokes step. */
private const val CROWN_HOLE_PX = 70f
private const val CROWN_STROKES_PX = 45f

/** How long a hole picked by crown or swipe waits for the phone before snapping back to what the state says. */
private const val HOLE_SETTLE_MS = 4_000L

/**
 * Distances | Score | Tee | Approach | Short game in a pager. Stays on its page when the hole
 * changes. Crown: hole on Distances, strokes on Score. Vertical swipe on Distances: one hole per
 * drag. The hole changes on screen at once ([WatchState.at] from the whole-course state), the
 * `hole` command goes out and the phone catches up. Edits go through [WatchController.edit]
 * (debounced auto-send); a hole move flushes them first.
 */
@Composable
private fun RoundScreens(state: WatchState, controller: WatchController, info: HomeInfo) {
    val haptics = LocalHapticFeedback.current

    // The hole picked on the watch, ahead of the phone's state; cleared on arrival or after a timeout.
    var target by remember { mutableStateOf<Int?>(null) }
    val phoneHole = state.hole!!.number
    LaunchedEffect(phoneHole, target) {
        when {
            target == phoneHole -> target = null
            target != null -> {
                delay(HOLE_SETTLE_MS)
                target = null
            }
        }
    }
    val shown = state.at(target ?: phoneHole)
    val hole = shown.hole!!
    // Without the whole-course state (older phone) the pages cannot show the target hole yet.
    val moving = hole.number != (target ?: hole.number)
    val pages = Pages.of(shown)
    val pagerState = rememberPagerState { pages.size }
    val pageNow = pages.getOrElse(pagerState.currentPage) { PageKind.Distances }

    val stepHole: (Int) -> Unit = { delta ->
        if (state.canEnter) {
            val base = target ?: phoneHole // read now: several events can arrive before a recomposition
            val next = (base + delta).coerceIn(1, hole.count)
            if (next != base) {
                target = next
                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                controller.goToHole(state, next)
            }
        }
    }

    // What the pages show: the pending edit if it belongs to this hole, else the phone's values.
    val pending by controller.edit.collectAsState()
    val plan = Entry.plan(hole, shown.track)
    val draft = pending?.takeIf { Entry.stillOn(it.opened, shown) }?.draft
        ?: shown.me?.let { Entry.initialDraft(it) }
    val onChange: DraftChange = { change -> controller.edit(shown, change) }

    val focus = remember { FocusRequester() }
    LaunchedEffect(pagerState.currentPage) { focus.requestFocus() }
    val holeCrown = remember { StepAccumulator(CROWN_HOLE_PX) }
    val strokesCrown = remember { StepAccumulator(CROWN_STROKES_PX) }
    val me = shown.me

    Box(
        Modifier
            .fillMaxSize()
            .onRotaryScrollEvent { e ->
                when (pageNow) {
                    PageKind.Distances -> {
                        val n = holeCrown.feed(e.verticalScrollPixels)
                        if (n != 0) stepHole(if (n > 0) 1 else -1)
                        true
                    }
                    PageKind.Score -> {
                        if (!shown.canEnter || me == null) return@onRotaryScrollEvent true
                        val n = strokesCrown.feed(e.verticalScrollPixels)
                        if (n != 0) {
                            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            repeat(abs(n)) { onChange { d -> Entry.stepStrokes(hole, d, if (n > 0) 1 else -1) } }
                        }
                        true
                    }
                    else -> false
                }
            }
            .focusRequester(focus)
            .focusable(),
    ) {
        HorizontalPager(state = pagerState, modifier = Modifier.fillMaxSize()) { index ->
            when (pages.getOrElse(index) { PageKind.Distances }) {
                PageKind.Distances -> DistancesPage(shown, info, moving, target ?: phoneHole, stepHole)
                PageKind.Score -> draft?.let { ScorePage(shown, it, plan, onChange) }
                PageKind.Tee -> draft?.let { TeePage(shown, it, plan, onChange) }
                PageKind.Approach -> draft?.let { ApproachPage(shown, it, plan, onChange) }
                PageKind.ShortGame -> draft?.let { ShortGamePage(shown, it, plan, onChange) }
            }
        }
        if (pages.size > 1) PageDots(pages.size, pagerState.currentPage, Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp))
    }
}

@Composable
private fun PageDots(count: Int, current: Int, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        repeat(count) { i ->
            Box(Modifier.size(5.dp).clip(CircleShape).background(if (i == current) Hud.accent else Hud.textMuted.copy(alpha = 0.4f)))
        }
    }
}
