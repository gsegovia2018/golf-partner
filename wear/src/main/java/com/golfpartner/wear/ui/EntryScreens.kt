package com.golfpartner.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Picker
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.rememberPickerState
import com.golfpartner.wear.data.Entry
import com.golfpartner.wear.data.EntryDraft
import com.golfpartner.wear.data.EntryPlan
import com.golfpartner.wear.data.HoleInfo
import com.golfpartner.wear.data.Me
import com.golfpartner.wear.data.Step
import com.golfpartner.wear.ui.theme.Hud

/**
 * The entry flow: Strokes -> Putts -> Tee shot (-> More: Sand and Penalty) ->
 * Save. Steps whose stats group is off are not in [plan]. Swipe-back (handled
 * by the caller) leaves without saving; nothing is sent until [onSave].
 */
@Composable
fun EntryFlow(hole: HoleInfo, me: Me, plan: EntryPlan, onSave: (EntryDraft) -> Unit) {
    var step by remember { mutableStateOf(Step.Strokes) }
    var draft by remember { mutableStateOf(Entry.initialDraft(hole, me)) }
    val next = plan.after(step)
    // The label of the primary button: Next while another step follows, else Save.
    val primary = if (next == null) Copy.SAVE else Copy.NEXT
    // What is saved is trimmed exactly as the phone will trim it, so the overlay matches the ack.
    val save = { onSave(Entry.reconcile(plan, draft, me)) }
    val advance = {
        if (next == null) save() else step = next
    }

    when (step) {
        Step.Strokes -> StrokesStep(
            hole = hole,
            value = draft.strokes,
            primary = primary,
            onChange = { draft = draft.copy(strokes = it) },
            onPrimary = {
                // Putts can never exceed strokes; re-seed from the saved value at the new ceiling.
                draft = draft.copy(putts = Entry.initialPutts(me, draft.strokes).coerceAtMost(Entry.puttsMax(draft.strokes)))
                // Seeded values that no longer fit the strokes are trimmed the phone's way.
                draft = Entry.reconcile(plan, draft, me)
                advance()
            },
        )
        Step.Putts -> PuttsStep(
            hole = hole,
            strokes = draft.strokes,
            value = draft.putts,
            primary = primary,
            onChange = { draft = draft.copy(putts = it) },
            onPrimary = {
                draft = Entry.fitExtras(plan, draft, me)
                advance()
            },
        )
        Step.Tee -> TeeStep(
            lie = draft.lie,
            hasMore = plan.teeHasMore,
            primary = primary,
            onLie = { draft = draft.copy(lie = it) },
            onMore = { step = Step.Extras },
            onPrimary = advance,
        )
        Step.Extras -> ExtrasStep(
            plan = plan,
            draft = draft,
            sandMax = Entry.sandMax(plan, draft, me),
            penaltyMax = Entry.penaltyMax(plan, draft, me),
            onChange = { draft = it },
            onSave = save,
        )
    }
}

@Composable
private fun StepFrame(
    title: String,
    primary: String,
    onPrimary: () -> Unit,
    secondary: (@Composable () -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(top = 14.dp, bottom = 10.dp, start = 22.dp, end = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Caption(title)
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { content() }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            secondary?.invoke()
            PrimaryButton(primary, onPrimary)
        }
    }
}

/** A crown/touch picker over the whole numbers [from]..[to]. */
@Composable
private fun NumberPicker(from: Int, to: Int, initial: Int, label: String, onChange: (Int) -> Unit) {
    val state = rememberPickerState(to - from + 1, (initial - from).coerceIn(0, to - from), false)
    LaunchedEffect(state) {
        snapshotFlow { state.selectedOptionIndex }.collect { onChange(from + it) }
    }
    Picker(
        state = state,
        contentDescription = { label },
        gradientColor = Hud.bg,
    ) { index ->
        val selected = index == selectedOptionIndex
        Text(
            text = (from + index).toString(),
            fontSize = if (selected) 44.sp else 26.sp,
            fontWeight = if (selected) FontWeight.ExtraBold else FontWeight.Normal,
            color = if (selected) Hud.text else Hud.textMuted,
        )
    }
}

@Composable
private fun StrokesStep(
    hole: HoleInfo,
    value: Int,
    primary: String,
    onChange: (Int) -> Unit,
    onPrimary: () -> Unit,
) {
    StepFrame(title = "STROKES", primary = primary, onPrimary = onPrimary) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.weight(1f)) {
                NumberPicker(1, Entry.STROKES_MAX, value, "Strokes", onChange)
            }
            val pts = Copy.points(Entry.points(hole, value))
            HudText(
                text = if (Entry.isNetPar(hole, value)) "net par · $pts" else pts,
                size = 14,
                color = Hud.accent,
                weight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun PuttsStep(
    hole: HoleInfo,
    strokes: Int,
    value: Int,
    primary: String,
    onChange: (Int) -> Unit,
    onPrimary: () -> Unit,
) {
    StepFrame(title = "PUTTS", primary = primary, onPrimary = onPrimary) {
        // Re-created if strokes changes (it cannot while here, but the ceiling is the key).
        androidx.compose.runtime.key(strokes) {
            NumberPicker(0, Entry.puttsMax(strokes), value, "Putts", onChange)
        }
    }
}

@Composable
private fun TeeStep(
    lie: String?,
    hasMore: Boolean,
    primary: String,
    onLie: (String?) -> Unit,
    onMore: () -> Unit,
    onPrimary: () -> Unit,
) {
    StepFrame(
        title = "TEE SHOT",
        primary = primary,
        onPrimary = onPrimary,
        secondary = if (hasMore) ({ GhostButton(Copy.MORE, onMore, Modifier.padding(0.dp)) }) else null,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Entry.LIES.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    row.forEach { option ->
                        LieChip(
                            label = Copy.lieLabel(option),
                            selected = lie == option,
                            onClick = { onLie(if (lie == option) null else option) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ExtrasStep(
    plan: EntryPlan,
    draft: EntryDraft,
    sandMax: Int,
    penaltyMax: Int,
    onChange: (EntryDraft) -> Unit,
    onSave: () -> Unit,
) {
    val title = when {
        plan.hasSand && plan.hasPenalty -> "SAND & PENALTY"
        plan.hasSand -> "SAND"
        else -> "PENALTY"
    }
    StepFrame(title = title, primary = Copy.SAVE, onPrimary = onSave) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (plan.hasSand) {
                Stepper("Sand shots", draft.sand, 0, sandMax, { onChange(draft.copy(sand = it)) })
            }
            if (plan.hasPenalty) {
                Stepper("Penalty", draft.penalty, 0, penaltyMax, { onChange(draft.copy(penalty = it)) })
            }
        }
    }
}
