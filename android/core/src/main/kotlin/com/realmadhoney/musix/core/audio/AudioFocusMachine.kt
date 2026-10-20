package com.realmadhoney.musix.core.audio

sealed interface FocusState {
    data object Idle : FocusState

    data object Requesting : FocusState

    data class Holding(
        val ducked: Boolean,
    ) : FocusState

    data class PausedTransient(
        val resumeOnGain: Boolean,
    ) : FocusState

    data object Lost : FocusState
}

sealed interface FocusInput {
    data object PlayRequested : FocusInput

    data object PauseRequested : FocusInput

    data object Granted : FocusInput

    data object Denied : FocusInput

    data object Gain : FocusInput

    data object LossTransient : FocusInput

    data object LossTransientCanDuck : FocusInput

    data object Loss : FocusInput

    data object BecomingNoisy : FocusInput

    data object Stopped : FocusInput

    data class PlaybackChanged(
        val isPlaying: Boolean,
    ) : FocusInput
}

sealed interface FocusEffect {
    data object RequestFocus : FocusEffect

    data object AbandonFocus : FocusEffect

    data object Play : FocusEffect

    data object Pause : FocusEffect

    data class Duck(
        val level: Double,
    ) : FocusEffect

    data object Unduck : FocusEffect

    data object ReportDenied : FocusEffect
}

class AudioFocusMachine(
    private val duckLevel: Double = DEFAULT_DUCK_LEVEL,
) {
    var state: FocusState = FocusState.Idle
        private set

    var isPlaying: Boolean = false
        private set

    fun handle(input: FocusInput): List<FocusEffect> {
        val current = state
        return when (input) {
            FocusInput.PlayRequested -> onPlay(current)
            FocusInput.PauseRequested -> onPause(current)
            FocusInput.Granted -> onGranted(current)
            FocusInput.Denied -> onDenied(current)
            FocusInput.Gain -> onGain(current)
            FocusInput.LossTransient -> onLossTransient(current)
            FocusInput.LossTransientCanDuck -> onDuck(current)
            FocusInput.Loss -> onLoss(current)
            FocusInput.BecomingNoisy -> onNoisy()
            FocusInput.Stopped -> onStopped(current)
            is FocusInput.PlaybackChanged -> onPlaybackChanged(current, input.isPlaying)
        }
    }

    private fun onPlay(current: FocusState): List<FocusEffect> =
        when (current) {
            FocusState.Idle, FocusState.Lost -> {
                state = FocusState.Requesting
                listOf(FocusEffect.RequestFocus)
            }

            FocusState.Requesting -> {
                emptyList()
            }

            is FocusState.Holding -> {
                isPlaying = true
                listOf(FocusEffect.Play)
            }

            is FocusState.PausedTransient -> {
                state = FocusState.PausedTransient(resumeOnGain = true)
                emptyList()
            }
        }

    private fun onPause(current: FocusState): List<FocusEffect> {
        isPlaying = false
        return when (current) {
            FocusState.Requesting -> {
                state = FocusState.Idle
                listOf(FocusEffect.AbandonFocus)
            }

            is FocusState.PausedTransient -> {
                state = FocusState.PausedTransient(resumeOnGain = false)
                emptyList()
            }

            else -> {
                listOf(FocusEffect.Pause)
            }
        }
    }

    private fun onGranted(current: FocusState): List<FocusEffect> {
        if (current != FocusState.Requesting) {
            return emptyList()
        }
        state = FocusState.Holding(ducked = false)
        isPlaying = true
        return listOf(FocusEffect.Play)
    }

    private fun onDenied(current: FocusState): List<FocusEffect> {
        if (current != FocusState.Requesting) {
            return emptyList()
        }
        state = FocusState.Idle
        isPlaying = false
        return listOf(FocusEffect.ReportDenied)
    }

    private fun onGain(current: FocusState): List<FocusEffect> =
        when (current) {
            is FocusState.Holding -> {
                if (current.ducked) {
                    state = FocusState.Holding(ducked = false)
                    listOf(FocusEffect.Unduck)
                } else {
                    emptyList()
                }
            }

            is FocusState.PausedTransient -> {
                state = FocusState.Holding(ducked = false)
                if (current.resumeOnGain) {
                    isPlaying = true
                    listOf(FocusEffect.Unduck, FocusEffect.Play)
                } else {
                    listOf(FocusEffect.Unduck)
                }
            }

            else -> {
                emptyList()
            }
        }

    private fun onLossTransient(current: FocusState): List<FocusEffect> =
        when (current) {
            is FocusState.Holding -> {
                val wasPlaying = isPlaying
                state = FocusState.PausedTransient(resumeOnGain = wasPlaying)
                isPlaying = false
                if (wasPlaying) listOf(FocusEffect.Pause) else emptyList()
            }

            else -> {
                emptyList()
            }
        }

    private fun onDuck(current: FocusState): List<FocusEffect> =
        when (current) {
            is FocusState.Holding -> {
                state = FocusState.Holding(ducked = true)
                listOf(FocusEffect.Duck(duckLevel))
            }

            else -> {
                emptyList()
            }
        }

    private fun onLoss(current: FocusState): List<FocusEffect> {
        if (current == FocusState.Idle || current == FocusState.Lost) {
            return emptyList()
        }
        val wasPlaying = isPlaying
        state = FocusState.Lost
        isPlaying = false
        return if (wasPlaying) {
            listOf(FocusEffect.Pause, FocusEffect.Unduck, FocusEffect.AbandonFocus)
        } else {
            listOf(FocusEffect.Unduck, FocusEffect.AbandonFocus)
        }
    }

    private fun onNoisy(): List<FocusEffect> {
        val current = state
        if (current is FocusState.PausedTransient) {
            state = FocusState.PausedTransient(resumeOnGain = false)
        }
        if (!isPlaying) {
            return emptyList()
        }
        isPlaying = false
        return listOf(FocusEffect.Pause)
    }

    private fun onStopped(current: FocusState): List<FocusEffect> {
        isPlaying = false
        state = FocusState.Idle
        return when (current) {
            FocusState.Idle, FocusState.Lost -> emptyList()
            else -> listOf(FocusEffect.Unduck, FocusEffect.AbandonFocus)
        }
    }

    private fun onPlaybackChanged(
        current: FocusState,
        playing: Boolean,
    ): List<FocusEffect> {
        if (playing == isPlaying) {
            return emptyList()
        }
        if (!playing) {
            isPlaying = false
            return emptyList()
        }
        return when (current) {
            is FocusState.Holding -> {
                isPlaying = true
                emptyList()
            }

            FocusState.Requesting -> {
                emptyList()
            }

            else -> {
                state = FocusState.Requesting
                listOf(FocusEffect.RequestFocus)
            }
        }
    }

    companion object {
        const val DEFAULT_DUCK_LEVEL = 0.2
    }
}
