package com.golfpartner.wear.ui.theme

import androidx.compose.ui.graphics.Color

/** HUD palette — mirrors `hud` in src/theme/tokens.js. Keep the two in step. */
object Hud {
    val bg = Color(0xFF0A0D10)
    val card = Color(0xFF12171C)
    val inset = Color(0xFF131C17)
    val accent = Color(0xFF4FAE8A)
    val accentPressed = Color(0xFF3D9A75)
    val onAccent = Color(0xFF0A0D10)
    val text = Color(0xFFFFFFFF)
    val textSoft = Color(0xFFCFE3D5)
    val textMuted = Color(0xFF9FB0A4)

    /** `semantic.conflict.base` — queued / needs-the-phone notices. */
    val warn = Color(0xFFC77A0A)
}
