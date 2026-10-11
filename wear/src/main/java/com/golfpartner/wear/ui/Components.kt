package com.golfpartner.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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

/** A round tap target: `−`/`+` or a tee-shot toggle. Selected = accent fill; disabled = dimmed, no click. */
@Composable
fun RoundButton(
    label: String,
    size: Dp,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    selected: Boolean = false,
    fontSize: Int = 22,
) {
    Box(
        modifier = modifier
            .size(size)
            .alpha(if (enabled) 1f else 0.35f)
            .clip(CircleShape)
            .background(if (selected) Hud.accent else Hud.inset)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (selected) Hud.onAccent else Hud.text,
            fontSize = fontSize.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
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
