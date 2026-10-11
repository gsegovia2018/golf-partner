package com.golfpartner.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import kotlin.math.cos
import kotlin.math.sin
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
    maxLines: Int = 2,
) {
    Text(
        text = text,
        modifier = modifier,
        color = color,
        fontSize = size.sp,
        fontWeight = weight,
        textAlign = TextAlign.Center,
        letterSpacing = letterSpacing.sp,
        maxLines = maxLines,
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

/** Icon-like glyphs for the direction toggles; arrows point [degrees] clockwise from "up". */
sealed interface Glyph {
    data class Arrow(val degrees: Float) : Glyph
    data object Dot : Glyph
    data object Star : Glyph
}

/** Glyph for a drive direction (the phone's DRIVE_META icons). */
fun driveGlyph(key: String): Glyph = when (key) {
    "left" -> Glyph.Arrow(-45f)
    "right" -> Glyph.Arrow(45f)
    "short" -> Glyph.Arrow(180f)
    "super" -> Glyph.Star
    else -> Glyph.Dot
}

/** Glyph for where an approach finished (arrows only; green and bunker are labelled chips). */
fun finishGlyph(key: String): Glyph = when (key) {
    "left" -> Glyph.Arrow(-90f)
    "right" -> Glyph.Arrow(90f)
    "short" -> Glyph.Arrow(180f)
    else -> Glyph.Arrow(0f)
}

/** A round toggle with a drawn glyph. [description] is the accessibility label. */
@Composable
fun GlyphButton(
    glyph: Glyph,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 46.dp,
    enabled: Boolean = true,
    selected: Boolean = false,
) {
    val tint = if (selected) Hud.onAccent else Hud.text
    Box(
        modifier = modifier
            .size(size)
            .alpha(if (enabled) 1f else 0.35f)
            .clip(CircleShape)
            .background(if (selected) Hud.accent else Hud.inset)
            .semantics { contentDescription = description; this.selected = selected }
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(20.dp)) {
            val c = center
            val r = this.size.minDimension / 2
            val stroke = Stroke(width = 2.2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
            when (glyph) {
                Glyph.Dot -> drawCircle(tint, radius = r * 0.55f, style = stroke)
                Glyph.Star -> {
                    val p = Path()
                    for (i in 0 until 10) {
                        val rad = if (i % 2 == 0) r else r * 0.45f
                        val a = Math.toRadians((i * 36 - 90).toDouble())
                        val pt = Offset(c.x + (rad * cos(a)).toFloat(), c.y + (rad * sin(a)).toFloat())
                        if (i == 0) p.moveTo(pt.x, pt.y) else p.lineTo(pt.x, pt.y)
                    }
                    p.close()
                    drawPath(p, tint)
                }
                is Glyph.Arrow -> rotate(glyph.degrees, pivot = c) {
                    val tip = Offset(c.x, c.y - r)
                    val tail = Offset(c.x, c.y + r)
                    drawLine(tint, tail, tip, strokeWidth = stroke.width, cap = StrokeCap.Round)
                    drawLine(tint, tip, Offset(c.x - r * 0.6f, c.y - r * 0.4f), strokeWidth = stroke.width, cap = StrokeCap.Round)
                    drawLine(tint, tip, Offset(c.x + r * 0.6f, c.y - r * 0.4f), strokeWidth = stroke.width, cap = StrokeCap.Round)
                }
            }
        }
    }
}

/** A 44dp-high pill toggle with a text label. */
@Composable
fun ChipButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    selected: Boolean = false,
    width: Dp = 92.dp,
) {
    Box(
        modifier = modifier
            .size(width = width, height = 44.dp)
            .alpha(if (enabled) 1f else 0.35f)
            .clip(CircleShape)
            .background(if (selected) Hud.accent else Hud.inset)
            .semantics { this.selected = selected }
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (selected) Hud.onAccent else Hud.text, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

/** Tiny muted caption above a control. */
@Composable
fun FieldLabel(text: String) = HudText(text, 10, color = Hud.textMuted, weight = FontWeight.SemiBold)

/** Compact single-select pill: inset when idle, accent when selected. At least 40dp high. */
@Composable
fun OptionChip(label: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .defaultMinSize(minWidth = 44.dp, minHeight = 40.dp)
            .alpha(if (enabled) 1f else 0.35f)
            .clip(CircleShape)
            .background(if (selected) Hud.accent else Hud.inset)
            .semantics { this.selected = selected }
            .clickable(enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (selected) Hud.onAccent else Hud.textSoft,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            softWrap = false,
        )
    }
}

/**
 * Single-select chips ([options] = key to label) in centred rows: 3 + 2 for five, 2 + 2 for four,
 * otherwise as even as possible. Tapping a chip calls [onPick] with its key (the caller decides
 * what a second tap on the selected one means).
 */
@Composable
fun ChipGroup(options: List<Pair<String, String>>, selected: String?, enabled: Boolean, onPick: (String) -> Unit) {
    val firstRow = (options.size + 1) / 2
    val rows = listOf(options.take(firstRow), options.drop(firstRow)).filter { it.isNotEmpty() }
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                row.forEach { (key, label) -> OptionChip(label, key == selected, enabled) { onPick(key) } }
            }
        }
    }
}

/** `label  −  n  +`, 44dp buttons, about 190dp wide. */
@Composable
fun StepRow(label: String, value: Int, minusOn: Boolean, plusOn: Boolean, onMinus: () -> Unit, onPlus: () -> Unit) {
    Row(
        Modifier.padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Box(Modifier.width(58.dp), contentAlignment = Alignment.CenterStart) { HudText(label, 12, color = Hud.textMuted, weight = FontWeight.SemiBold, maxLines = 1) }
        RoundButton("−", 44.dp, onMinus, enabled = minusOn, fontSize = 20)
        Box(Modifier.width(24.dp), contentAlignment = Alignment.Center) { HudText(value.toString(), 20, weight = FontWeight.Bold) }
        RoundButton("+", 44.dp, onPlus, enabled = plusOn, fontSize = 20)
    }
}
