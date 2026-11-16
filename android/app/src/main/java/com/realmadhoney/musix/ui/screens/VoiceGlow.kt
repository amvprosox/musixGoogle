package com.realmadhoney.musix.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.realmadhoney.musix.voice.VoiceState
import kotlin.math.abs

private val GlowColors =
    listOf(
        Color(0xFFFF4FA3),
        Color(0xFFA855F7),
        Color(0xFF3B82F6),
        Color(0xFF22D3EE),
        Color(0xFF34D399),
        Color(0xFFFBBF24),
        Color(0xFFFF4FA3),
    )

@Composable
fun VoiceGlowOverlay(
    state: VoiceState,
    heard: String,
    levels: List<Float>,
    modifier: Modifier = Modifier,
) {
    val active = state == VoiceState.Awake || state == VoiceState.Thinking
    val thinking = state == VoiceState.Thinking
    AnimatedVisibility(
        visible = active,
        enter = fadeIn(),
        exit = fadeOut(),
        modifier = modifier.fillMaxSize().clearAndSetSemantics {},
    ) {
        val transition = rememberInfiniteTransition(label = "voice-glow")
        val angle by transition.animateFloat(
            initialValue = 0f,
            targetValue = 360f,
            animationSpec = infiniteRepeatable(tween(if (thinking) 1200 else 3200, easing = LinearEasing)),
            label = "voice-angle",
        )
        val level = levels.lastOrNull() ?: 0f
        Box(Modifier.fillMaxSize()) {
            Canvas(Modifier.fillMaxSize()) {
                val cx = size.width / 2
                val cy = size.height / 2
                val shader =
                    android.graphics.SweepGradient(cx, cy, GlowColors.map { it.toArgb() }.toIntArray(), null).apply {
                        setLocalMatrix(android.graphics.Matrix().apply { setRotate(angle, cx, cy) })
                    }
                val brush = ShaderBrush(shader)
                val radius = CornerRadius(36.dp.toPx())
                for (layer in 6 downTo 1) {
                    val width = (layer * (5f + level * 9f)).dp.toPx()
                    drawRoundRect(
                        brush = brush,
                        topLeft = Offset(width / 2, width / 2),
                        size = size.copy(width = size.width - width, height = size.height - width),
                        cornerRadius = radius,
                        style = Stroke(width = width),
                        alpha = if (layer == 1) 0.95f else 0.16f,
                    )
                }
            }
            Column(
                modifier =
                    Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 140.dp)
                        .widthIn(max = 300.dp)
                        .background(Color(0xC7000000), RoundedCornerShape(50))
                        .border(1.dp, Color(0x1FFFFFFF), RoundedCornerShape(50))
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    modifier = Modifier.height(30.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val middle = (levels.size - 1) / 2f
                    levels.forEachIndexed { index, value ->
                        val shape = 1f - abs(index - middle) / (middle + 2f)
                        val height = (30f * (0.12f + value * 1.6f) * (0.45f + shape * 0.55f)).coerceIn(3f, 30f)
                        Box(
                            Modifier
                                .width(4.dp)
                                .height(height.dp)
                                .background(
                                    Brush.verticalGradient(listOf(Color(0xFFFF4FA3), Color(0xFF22D3EE))),
                                    RoundedCornerShape(2.dp),
                                ),
                        )
                    }
                }
                Text(
                    if (thinking) heard.ifEmpty { "Thinking" } else "Listening",
                    style = MaterialTheme.typography.labelLarge,
                    color = Color.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
