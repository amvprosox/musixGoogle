package com.realmadhoney.musix.service

import android.os.Bundle
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.SessionCommand
import com.realmadhoney.musix.core.bridge.BridgeState
import com.realmadhoney.musix.core.bridge.LikeStatus
import com.realmadhoney.musix.core.bridge.RepeatMode

@UnstableApi
object MusixCommands {
    const val ACTION_LIKE = "com.realmadhoney.musix.command.LIKE"
    const val ACTION_SHUFFLE = "com.realmadhoney.musix.command.SHUFFLE"
    const val ACTION_REPEAT = "com.realmadhoney.musix.command.REPEAT"

    val like = SessionCommand(ACTION_LIKE, Bundle.EMPTY)
    val shuffle = SessionCommand(ACTION_SHUFFLE, Bundle.EMPTY)
    val repeat = SessionCommand(ACTION_REPEAT, Bundle.EMPTY)

    val all: List<SessionCommand> = listOf(like, shuffle, repeat)

    fun buttons(
        state: BridgeState,
        signedIn: Boolean,
    ): List<CommandButton> {
        val liked = state.likeStatus == LikeStatus.LIKE
        val likeButton =
            CommandButton
                .Builder(if (liked) CommandButton.ICON_HEART_FILLED else CommandButton.ICON_HEART_UNFILLED)
                .setDisplayName(if (liked) "Remove from liked songs" else "Like")
                .setSessionCommand(like)
                .setEnabled(state.hasTrack && !state.isAd && signedIn)
                .setSlots(CommandButton.SLOT_FORWARD_SECONDARY, CommandButton.SLOT_OVERFLOW)
                .build()
        val shuffleButton =
            CommandButton
                .Builder(if (state.shuffle) CommandButton.ICON_SHUFFLE_ON else CommandButton.ICON_SHUFFLE_OFF)
                .setDisplayName(if (state.shuffle) "Shuffle on" else "Shuffle off")
                .setSessionCommand(shuffle)
                .setEnabled(state.hasTrack && !state.isAd)
                .setSlots(CommandButton.SLOT_BACK_SECONDARY, CommandButton.SLOT_OVERFLOW)
                .build()
        val repeatButton =
            CommandButton
                .Builder(
                    when (state.repeatMode) {
                        RepeatMode.NONE -> CommandButton.ICON_REPEAT_OFF
                        RepeatMode.ALL -> CommandButton.ICON_REPEAT_ALL
                        RepeatMode.ONE -> CommandButton.ICON_REPEAT_ONE
                    },
                ).setDisplayName(
                    when (state.repeatMode) {
                        RepeatMode.NONE -> "Repeat off"
                        RepeatMode.ALL -> "Repeat all"
                        RepeatMode.ONE -> "Repeat one"
                    },
                ).setSessionCommand(repeat)
                .setEnabled(state.hasTrack && !state.isAd)
                .setSlots(CommandButton.SLOT_OVERFLOW)
                .build()
        return listOf(likeButton, shuffleButton, repeatButton)
    }
}
