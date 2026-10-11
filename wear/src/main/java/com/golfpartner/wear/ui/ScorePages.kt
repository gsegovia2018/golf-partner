package com.golfpartner.wear.ui

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import com.golfpartner.wear.data.Extra
import com.golfpartner.wear.data.HoleMove
import com.golfpartner.wear.data.EntryPlan
import com.golfpartner.wear.data.WatchState
import com.golfpartner.wear.ui.theme.Hud

/** Applies a pure change to the pending draft (see WatchController.edit). */
typealias DraftChange = ((EntryDraft) -> EntryDraft) -> Unit

/**
 * Inputs are live on an unblocked live round, on the phone's own hole: [movingTo] is the hole
 * shown ahead of the phone (see HoleMove), look-only until the phone arrives. A dispute shows
 * them off with a note.
 */
private fun WatchState.inputsOn(movingTo: Int?): Boolean = HoleMove.inputsOn(this, movingTo)

/**
 * Score page: strokes (large, 48dp+ buttons), putts below, footer with points.
 * Unscored shows "–"; the first + lands on PAR. The crown adjusts strokes (handled by the pager's owner).
 * Layout stays within ~±170px of centre on a 450px round: the widest row is 190dp at the middle.
 */
@Composable
fun ScorePage(state: WatchState, draft: EntryDraft, plan: EntryPlan, onChange: DraftChange, movingTo: Int? = null) {
    val hole = state.hole ?: return
    val me = state.me ?: return
    val on = state.inputsOn(movingTo)
    val strokes = draft.strokes
    val (pts, total) = Entry.pointsAndTotal(hole, me, strokes)
    Column(
        Modifier.fillMaxSize().padding(top = 18.dp, bottom = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Caption(Copy.holeHeader(hole.number, hole.par))
        Spacer(Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            RoundButton("−", 52.dp, { onChange { Entry.stepStrokes(hole, it, -1) } }, enabled = on && strokes != null && strokes > 1)
            Column(Modifier.width(72.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                // Unscored: a short dash, not a bar the width of the digit.
                if (strokes == null) HudText("–", 34, color = Hud.textMuted)
                else HudText(strokes.toString(), 56, weight = FontWeight.ExtraBold)
                HudText(Copy.STROKES_LABEL, 10, color = Hud.textMuted)
            }
            RoundButton("+", 52.dp, { onChange { Entry.stepStrokes(hole, it, +1) } }, enabled = on && (strokes ?: 0) < Entry.STROKES_MAX)
        }
        if (plan.putts) {
            Spacer(Modifier.height(4.dp))
            val putts = draft.shot.putts
            val puttsOn = on && strokes != null
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                RoundButton("−", 44.dp, { onChange { Entry.stepPutts(it, -1) } }, enabled = puttsOn && putts != null && putts > 0)
                Column(Modifier.width(72.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    HudText(putts?.toString() ?: "–", 26, weight = FontWeight.Bold, color = if (putts == null) Hud.textMuted else Hud.text)
                    HudText(Copy.PUTTS, 10, color = Hud.textMuted)
                }
                RoundButton("+", 44.dp, { onChange { Entry.stepPutts(it, +1) } }, enabled = puttsOn && (putts == null || putts < Entry.puttsMax(strokes ?: 0)))
            }
        }
        Spacer(Modifier.weight(1f))
        if (state.blocked == Blocked.Dispute) {
            HudText(Copy.RESOLVE_ON_PHONE, 12, color = Hud.warn, weight = FontWeight.SemiBold)
        } else if (movingTo != null) {
            HudText(Copy.movingToHole(movingTo), 12, color = Hud.textMuted, weight = FontWeight.SemiBold)
        } else {
            HudText(Copy.footer(pts, total), 12, color = Hud.textSoft, weight = FontWeight.SemiBold)
        }
    }
}

private val PAGE_MODIFIER = Modifier.fillMaxSize()

/** The one-line hint under a stats page: dispute, strokes unset, or the strokes cap. */
@Composable
private fun Hint(state: WatchState, draft: EntryDraft, capped: Boolean, extra: Pair<String, androidx.compose.ui.graphics.Color>? = null, movingTo: Int? = null) {
    val hint = when {
        state.blocked == Blocked.Dispute -> Copy.RESOLVE_ON_PHONE to Hud.warn
        movingTo != null -> Copy.movingToHole(movingTo) to Hud.textMuted
        draft.strokes == null -> Copy.SET_STROKES_FIRST to Hud.textMuted
        extra != null -> extra
        capped -> Copy.maxFor(draft.strokes) to Hud.textMuted
        else -> null
    }
    Box(Modifier.height(18.dp), contentAlignment = Alignment.Center) {
        hint?.let { (text, color) -> HudText(text, 11, color = color, weight = FontWeight.SemiBold) }
    }
}

/** Scrolls when the rows do not fit the round screen; top/bottom padding keeps rows off the bezel at rest. */
@Composable
private fun StatsColumn(caption: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        PAGE_MODIFIER.verticalScroll(rememberScrollState()).padding(top = 22.dp, bottom = 30.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Caption(caption)
        content()
    }
}

/** Tee page: direction (Left / Fairway / Right / Short / Super), club, drive distance, tee penalties. */
@Composable
fun TeePage(state: WatchState, draft: EntryDraft, plan: EntryPlan, onChange: DraftChange, movingTo: Int? = null) {
    val on = state.inputsOn(movingTo) && draft.strokes != null
    val s = draft.shot
    StatsColumn(Copy.TEE_SHOT) {
        if (plan.drive) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("left", "fairway", "right").forEach { DriveButton(it, s.drive, on, onChange) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("short", "super").forEach { DriveButton(it, s.drive, on, onChange) }
            }
            HudText(s.drive?.let { Copy.driveLabel(it) } ?: Copy.DIRECTION, 12, color = if (s.drive == null) Hud.textMuted else Hud.accent, weight = FontWeight.SemiBold)
            FieldLabel(Copy.CLUB)
            val club = s.teeClub ?: "driver"
            OptionStepper(Copy.clubLabel(club), true, on, { onChange { Entry.cycleClub(it, -1) } }, { onChange { Entry.cycleClub(it, +1) } })
            FieldLabel("Drive distance · ${Copy.unitWord(state.units)}")
            OptionStepper(
                s.driveDistBucket?.let { Copy.driveDistLabel(it, state.units) } ?: Copy.NOT_SET, s.driveDistBucket != null, on,
                { onChange { Entry.cycleDriveDist(it, -1) } }, { onChange { Entry.cycleDriveDist(it, +1) } },
            )
        } else if (plan.par3Note) {
            HudText(Copy.PAR3_NOTE, 11, color = Hud.textMuted)
        }
        if (plan.teePenalties) {
            val max = Entry.extraMax(draft, Extra.Tee)
            StepRow(Copy.TEE_PENALTIES, s.teePenalties, on && s.teePenalties > 0, on && s.teePenalties < max,
                { onChange { Entry.stepExtra(it, Extra.Tee, -1) } }, { onChange { Entry.stepExtra(it, Extra.Tee, +1) } })
        }
        Hint(state, draft, plan.teePenalties && Entry.extrasCapped(draft, setOf(Extra.Tee)), movingTo = movingTo)
    }
}

@Composable
private fun DriveButton(key: String, selected: String?, on: Boolean, onChange: DraftChange) {
    GlyphButton(driveGlyph(key), Copy.driveLabel(key), { onChange { Entry.toggleDrive(it, key) } }, enabled = on, selected = selected == key)
}

/** Approach page: distance bucket, then (not on a par 3) where it finished, once a distance is set. */
@Composable
fun ApproachPage(state: WatchState, draft: EntryDraft, plan: EntryPlan, onChange: DraftChange, movingTo: Int? = null) {
    val on = state.inputsOn(movingTo) && draft.strokes != null
    val s = draft.shot
    val finishOn = on && s.approachBucket != null
    StatsColumn(if (plan.par3) Copy.HOLE_DISTANCE else Copy.APPROACH) {
        FieldLabel(Copy.unitWord(state.units))
        OptionStepper(
            s.approachBucket?.let { Copy.approachLabel(it, state.units) } ?: Copy.NOT_SET, s.approachBucket != null, on,
            { onChange { Entry.cycleApproach(it, -1) } }, { onChange { Entry.cycleApproach(it, +1) } },
        )
        if (plan.approachFinish) {
            FieldLabel(Copy.FINISH)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("left", "long", "short", "right").forEach { key ->
                    GlyphButton(
                        finishGlyph(key), Copy.finishLabel(key), { onChange { Entry.toggleFinish(it, key) } },
                        size = 44.dp, enabled = finishOn, selected = Entry.finishActive(s, key),
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                ChipButton(Copy.ON_GREEN, { onChange { Entry.toggleFinish(it, "green") } }, enabled = finishOn, selected = Entry.finishActive(s, "green"), width = 94.dp)
                ChipButton(Copy.BUNKER, { onChange { Entry.toggleFinish(it, "bunker") } }, enabled = finishOn, selected = Entry.finishActive(s, "bunker"), width = 90.dp)
            }
        }
        val extra = if (plan.approachFinish && on && s.approachBucket == null) Copy.SET_DISTANCE_FIRST to Hud.textMuted else null
        Hint(state, draft, capped = false, extra = extra, movingTo = movingTo)
    }
}

/** First putt distance, sand shots, recovery outcome and other penalties. */
@Composable
fun ShortGamePage(state: WatchState, draft: EntryDraft, plan: EntryPlan, onChange: DraftChange, movingTo: Int? = null) {
    val hole = state.hole ?: return
    val on = state.inputsOn(movingTo) && draft.strokes != null
    val s = draft.shot
    val hasPutts = (s.putts ?: 0) >= 1
    StatsColumn(Copy.SHORT_GAME) {
        if (plan.firstPutt && hasPutts) {
            FieldLabel("${Copy.FIRST_PUTT} · ${Copy.unitWord(state.units)}")
            OptionStepper(
                s.firstPuttBucket?.let { Copy.firstPuttLabel(it, state.units) } ?: Copy.NOT_SET, s.firstPuttBucket != null, on,
                { onChange { Entry.cycleFirstPutt(it, -1) } }, { onChange { Entry.cycleFirstPutt(it, +1) } },
            )
        }
        if (plan.sand) {
            val max = Entry.extraMax(draft, Extra.Sand)
            StepRow(Copy.SAND, s.sandShots, on && s.sandShots > 0, on && s.sandShots < max,
                { onChange { Entry.stepExtra(it, Extra.Sand, -1) } }, { onChange { Entry.stepExtra(it, Extra.Sand, +1) } })
        }
        if (plan.recovery && Entry.missedGir(hole, draft)) {
            val eff = Entry.effectiveRecovery(hole, draft)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("up-and-down", "sand-save").forEach { key ->
                    ChipButton(Copy.recoveryLabel(key), { onChange { Entry.toggleRecovery(hole, it, key) } }, enabled = on, selected = eff == key, width = 94.dp)
                }
            }
        }
        if (plan.otherPenalties) {
            val max = Entry.extraMax(draft, Extra.Other)
            StepRow(Copy.OTHER_PENALTIES, s.otherPenalties, on && s.otherPenalties > 0, on && s.otherPenalties < max,
                { onChange { Entry.stepExtra(it, Extra.Other, -1) } }, { onChange { Entry.stepExtra(it, Extra.Other, +1) } })
        }
        val extra = if (plan.firstPutt && !plan.sand && !plan.otherPenalties && !hasPutts && on) Copy.SET_PUTTS_FIRST to Hud.textMuted else null
        val capped = (plan.sand || plan.otherPenalties) && Entry.extrasCapped(draft, buildSet {
            if (plan.sand) add(Extra.Sand)
            if (plan.otherPenalties) add(Extra.Other)
        })
        Hint(state, draft, capped, extra, movingTo = movingTo)
    }
}
