package com.realmadhoney.musix.service

import com.realmadhoney.musix.audio.AudioFocusController
import com.realmadhoney.musix.audio.PlaybackCommands
import com.realmadhoney.musix.core.bridge.BridgeCommand
import com.realmadhoney.musix.core.bridge.BridgeState
import com.realmadhoney.musix.core.bridge.CommandResult
import com.realmadhoney.musix.core.bridge.QueueEntry
import com.realmadhoney.musix.core.resume.ResumeSnapshot
import com.realmadhoney.musix.engine.EngineStatus
import com.realmadhoney.musix.engine.WebEngine
import com.realmadhoney.musix.player.PlaybackBackend
import kotlinx.coroutines.flow.StateFlow

class EngineCommands(
    private val engine: WebEngine,
) : PlaybackCommands {
    override suspend fun play(): CommandResult = engine.queue.player { BridgeCommand.Play(it) }

    override suspend fun pause(): CommandResult = engine.queue.player { BridgeCommand.Pause(it) }

    override suspend fun duck(level: Double): CommandResult = engine.queue.player { BridgeCommand.Duck(it, level.coerceIn(0.0, 1.0)) }
}

class EngineBackend(
    private val engine: WebEngine,
    private val focus: AudioFocusController,
) : PlaybackBackend {
    override val bridgeState: StateFlow<BridgeState> get() = engine.bridgeState
    override val queueEntries: StateFlow<List<QueueEntry>> get() = engine.queueEntries
    override val status: StateFlow<EngineStatus> get() = engine.status

    override suspend fun send(build: (String) -> BridgeCommand): CommandResult = engine.queue.player(build)

    override suspend fun play(): CommandResult = focus.play()

    override suspend fun pause(): CommandResult = focus.pause()

    override suspend fun stop(): CommandResult {
        val paused = if (engine.bridgeState.value.isPlaying) focus.pause() else CommandResult.Acknowledged
        focus.stop()
        return paused
    }

    override suspend fun resumeAt(
        videoId: String,
        playlistId: String?,
        positionMs: Long,
    ): CommandResult {
        val current = engine.bridgeState.value
        val snapshot =
            ResumeSnapshot(
                videoId = videoId,
                playlistId = playlistId,
                title = current.title,
                artist = current.artist,
                album = current.album,
                artworkUrl = current.artworkUrl,
                positionSec = positionMs / 1000.0,
                durationSec = 0.0,
                savedAt = System.currentTimeMillis(),
            )
        return engine.restore(snapshot, play = true)
    }

    override fun retry() {
        engine.reload()
    }
}
