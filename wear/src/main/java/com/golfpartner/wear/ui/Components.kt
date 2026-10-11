package com.golfpartner.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.FilledTonalIconButton
import androidx.wear.compose.material3.IconButtonDefaults
import androidx.wear.compose.material3.OutlinedButton
import androidx.wear.compose.material3.Text
import com.golfpartner.wear.ui.theme.Hud

/** Minimum touch target (dp). */
val TouchMin = 48.dp

@Composable
fun HudText(
    text: String,
    size: Int,
    modifier: Modifier = Modifier,
    color: Color = Hud.text,
    weight: FontWeight = FontWeight.Normal,
    letterSpacing: Float = 0f,
) {
    Text(
        text = text,
        modifier = modifier,
        color = color,
        fontSize = size.sp,
        fontWeight = weight,
        textAlign = TextAlign.Center,
        letterSpacing = letterSpacing.sp,
        maxLines = 2,
    )
}

/** Small spaced-out caption, e.g. `HOLE 7 · PAR 4`. */
@Composable
fun Caption(text: String, color: Color = Hud.textMuted, modifier: Modifier = Modifier) =
    HudText(text, 12, modifier, color, FontWeight.SemiBold, letterSpacing = 1f)

/** The main action: accent fill, 48dp tall. */
@Composable
fun PrimaryButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Button(
        onClick = onClick,
        modifier = modifier.height(TouchMin).widthIn(min = 120.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Hud.accent, contentColor = Hud.onAccent),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 0.dp),
    ) {
        Text(label, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

/** The quiet action: outline only (already-scored pill, "More"). */
@Composable
fun GhostButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.height(TouchMin).widthIn(min = 96.dp),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Hud.text),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 0.dp),
    ) {
        Text(label, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/** A two-state chip (tee-shot lie). Tapping the selected one clears it. */
@Composable
fun LieChip(label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Button(
        onClick = onClick,
        modifier = modifier.height(TouchMin),
        colors = if (selected) {
            ButtonDefaults.buttonColors(containerColor = Hud.accent, contentColor = Hud.onAccent)
        } else {
            ButtonDefaults.buttonColors(containerColor = Hud.inset, contentColor = Hud.text)
        },
        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp),
    ) {
        Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/** `−  n  +` with a caption under the value. */
@Composable
fun Stepper(
    label: String,
    value: Int,
    min: Int,
    max: Int,
    onChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        StepButton("−", enabled = value > min) { onChange(value - 1) }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            HudText(value.toString(), 24, weight = FontWeight.Bold)
            HudText(label, 10, color = Hud.textMuted)
        }
        StepButton("+", enabled = value < max) { onChange(value + 1) }
    }
}

@Composable
private fun StepButton(glyph: String, enabled: Boolean, onClick: () -> Unit) {
    FilledTonalIconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(TouchMin),
        colors = IconButtonDefaults.filledTonalIconButtonColors(containerColor = Hud.inset, contentColor = Hud.text),
    ) {
        Text(glyph, fontSize = 22.sp, fontWeight = FontWeight.Bold)
    }
}

/** Full-screen centred message with an optional action. */
@Composable
fun MessageScreen(title: String, body: String? = null, extra: String? = null, titleColor: Color = Hud.text) {
    Box(Modifier.fillMaxSize().padding(horizontal = 28.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            HudText(title, 17, color = titleColor, weight = FontWeight.Bold)
            if (body != null) HudText(body, 13, color = Hud.textSoft)
            if (extra != null) HudText(extra, 13, color = Hud.warn, weight = FontWeight.SemiBold)
        }
    }
}
