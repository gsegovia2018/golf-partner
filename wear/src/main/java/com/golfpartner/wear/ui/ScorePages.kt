package com.golfpartner.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.golfpartner.wear.data.Blocked
import com.golfpartner.wear.data.Entry
import com.golfpartner.wear.data.EntryDraft
import com.golfpartner.wear.data.EntryPlan
import com.golfpartner.wear.data.WatchState
import com.golfpartner.wear.ui.theme.Hud

/** Applies a pure change to the pending draft (see WatchController.edit). */
typealias DraftChange = ((EntryDraft) -> EntryDraft) -> Unit

/** Inputs are live on an unblocked live round; a dispute shows them off with a note. */
private val WatchState.inputsOn: Boolean get() = canEnter

/**
 * Score page: strokes (large, 48dp+ buttons), putts below, footer with points.
 * Unscored shows "–"; the first + lands on PAR. The crown adjusts strokes (handled by the pager's owner).
 * Layout stays within ~±170px of centre on a 450px round: the widest row is 190dp at the middle.
 */
@Composable
fun ScorePage(state: WatchState, draft: EntryDraft, plan: EntryPlan, onChange: DraftChange) {
    val hole = state.hole ?: return
    val me = state.me ?: return
    val on = state.inputsOn
    val strokes = draft.strokes
    val (pts, total) = Entry.pointsAndTotal(hole, me, strokes)
    Column(
        Modifier.fillMaxSize().padding(top = 18.dp, bottom = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Caption(Copy.holeHeader(hole.number, hole.par))
        Spacer(Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            RoundButton("−", 52.dp, { onChange { Entry.stepStrokes(hole, plan, it, me, -1) } }, enabled = on && strokes != null && strokes > 1)
            Box(Modifier.width(72.dp), contentAlignment = Alignment.Center) {
                HudText(strokes?.toString() ?: "–", 56, weight = FontWeight.ExtraBold, color = if (strokes == null) Hud.textMuted else Hud.text)
            }
            RoundButton("+", 52.dp, { onChange { Entry.stepStrokes(hole, plan, it, me, +1) } }, enabled = on && (strokes ?: 0) < Entry.STROKES_MAX)
        }
        if (plan.hasPutts) {
            Spacer(Modifier.height(4.dp))
            val putts = draft.putts
            val puttsOn = on && strokes != null
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                RoundButton("−", 44.dp, { onChange { Entry.stepPutts(plan, it, me, -1) } }, enabled = puttsOn && putts != null && putts > 0)
                Column(Modifier.width(72.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    HudText(putts?.toString() ?: "–", 26, weight = FontWeight.Bold, color = if (putts == null) Hud.textMuted else Hud.text)
                    HudText(Copy.PUTTS, 10, color = Hud.textMuted)
                }
                RoundButton("+", 44.dp, { onChange { Entry.stepPutts(plan, it, me, +1) } }, enabled = puttsOn && (putts == null || putts < Entry.puttsMax(strokes ?: 0)))
            }
        }
        Spacer(Modifier.weight(1f))
        if (state.blocked == Blocked.Dispute) {
            HudText(Copy.RESOLVE_ON_PHONE, 12, color = Hud.warn, weight = FontWeight.SemiBold)
        } else {
            HudText(Copy.footer(pts, total), 12, color = Hud.textSoft, weight = FontWeight.SemiBold)
        }
    }
}

/**
 * Stats page: one row of tee-shot toggles (hidden on a par 3, which gets a note), then Sand and
 * Penalty rows. Rows whose track group is off are not shown. The strokes cap is explained by a
 * one-line hint rather than a silent grey-out.
 */
@Composable
fun StatsPage(state: WatchState, draft: EntryDraft, plan: EntryPlan, onChange: DraftChange) {
    val hole = state.hole ?: return
    val me = state.me ?: return
    val dispute = state.blocked == Blocked.Dispute
    val on = state.inputsOn && draft.strokes != null
    Column(
        Modifier.fillMaxSize().padding(top = 18.dp, bottom = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Caption(if (plan.hasLie) Copy.TEE_SHOT else Copy.holeHeader(hole.number, hole.par))
        Spacer(Modifier.weight(1f))
        if (plan.hasLie) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Entry.LIES.forEach { lie ->
                    RoundButton(
                        Copy.lieLabel(lie), 42.dp, { onChange { Entry.toggleLie(it, lie) } },
                        enabled = on, selected = draft.lie == lie, fontSize = 11,
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
        } else if (plan.par3Note) {
            HudText(Copy.PAR3_NOTE, 11, color = Hud.textMuted)
            Spacer(Modifier.height(8.dp))
        }
        if (plan.hasSand) {
            val max = Entry.sandMax(plan, draft, me)
            StepRow(Copy.SAND, draft.sand, on && draft.sand > 0, on && draft.sand < max,
                { onChange { Entry.stepSand(plan, it, me, -1) } }, { onChange { Entry.stepSand(plan, it, me, +1) } })
        }
        if (plan.hasPenalty) {
            val max = Entry.penaltyMax(plan, draft, me)
            StepRow(Copy.PENALTY, draft.penalty, on && draft.penalty > 0, on && draft.penalty < max,
                { onChange { Entry.stepPenalty(plan, it, me, -1) } }, { onChange { Entry.stepPenalty(plan, it, me, +1) } })
        }
        Spacer(Modifier.weight(1f))
        val hint = when {
            dispute -> Copy.RESOLVE_ON_PHONE to Hud.warn
            draft.strokes == null -> Copy.SET_STROKES_FIRST to Hud.textMuted
            Entry.extrasCapped(plan, draft, me) -> Copy.maxFor(draft.strokes) to Hud.textMuted
            else -> null
        }
        Box(Modifier.height(16.dp), contentAlignment = Alignment.Center) {
            hint?.let { (text, color) -> HudText(text, 11, color = color, weight = FontWeight.SemiBold) }
        }
    }
}

/** `label  −  n  +`, 40dp buttons, about 160dp wide so the bottom row clears the round edge. */
@Composable
private fun StepRow(label: String, value: Int, minusOn: Boolean, plusOn: Boolean, onMinus: () -> Unit, onPlus: () -> Unit) {
    val size: Dp = 40.dp
    Row(
        Modifier.padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box(Modifier.width(48.dp), contentAlignment = Alignment.CenterStart) { HudText(label, 12, color = Hud.textMuted, weight = FontWeight.SemiBold) }
        RoundButton("−", size, onMinus, enabled = minusOn, fontSize = 20)
        Box(Modifier.width(26.dp), contentAlignment = Alignment.Center) { HudText(value.toString(), 20, weight = FontWeight.Bold) }
        RoundButton("+", size, onPlus, enabled = plusOn, fontSize = 20)
    }
}
