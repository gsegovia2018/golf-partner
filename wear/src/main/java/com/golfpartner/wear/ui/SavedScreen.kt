package com.golfpartner.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.golfpartner.wear.data.SavedSummary
import com.golfpartner.wear.ui.theme.Hud

@Composable
fun SavedScreen(
    summary: SavedSummary,
    pendingHoles: Int,
    onNextHole: () -> Unit,
) {
    val stats = listOfNotNull(
        summary.putts?.let { Copy.putts(it) },
        summary.lie?.let { it.lowercase() },
    ).joinToString(" · ")
    Column(
        modifier = Modifier.fillMaxSize().padding(top = 14.dp, bottom = 10.dp, start = 24.dp, end = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        HudText(Copy.saved(summary.hole), 15, color = Hud.accent, weight = FontWeight.Bold)
        HudText(summary.strokes.toString(), 52, weight = FontWeight.ExtraBold)
        HudText(Copy.scoreAndTotal(summary.points, summary.totalPoints), 15, color = Hud.textSoft, weight = FontWeight.SemiBold)
        if (stats.isNotEmpty()) HudText(stats, 13, color = Hud.textMuted)
        if (pendingHoles > 0) HudText(Copy.waiting(pendingHoles), 12, color = Hud.warn, weight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        if (summary.hasNext) PrimaryButton(Copy.nextHole(summary.hole + 1), onNextHole)
    }
}
