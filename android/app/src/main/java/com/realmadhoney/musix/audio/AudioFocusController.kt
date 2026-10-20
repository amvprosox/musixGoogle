package com.realmadhoney.musix.audio

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.realmadhoney.musix.core.audio.AudioFocusMachine
import com.realmadhoney.musix.core.audio.FocusEffect
import com.realmadhoney.musix.core.audio.FocusInput
import com.realmadhoney.musix.core.audio.FocusState
import com.realmadhoney.musix.core.bridge.BridgeErrorCode
import com.realmadhoney.musix.core.bridge.CommandResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

interface PlaybackCommands {
    suspend fun play(): CommandResult

    suspend fun pause(): CommandResult

    suspend fun duck(level: Double): CommandResult
}

class AudioFocusController(
    private val context: Context,
    private val commands: PlaybackCommands,
    private val scope: CoroutineScope,
) {
    private val audioManager = context.getSystemService(AudioManager::class.java)
    private val machine = AudioFocusMachine()
    private val mutex = Mutex()
    private var noisyRegistered = false

    val state: FocusState get() = machine.state

    private val focusListener =
        AudioManager.OnAudioFocusChangeListener { change ->
            val input =
                when (change) {
                    AudioManager.AUDIOFOCUS_GAIN -> FocusInput.Gain
                    AudioManager.AUDIOFOCUS_LOSS -> FocusInput.Loss
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> FocusInput.LossTransient
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> FocusInput.LossTransientCanDuck
                    else -> null
                }
            if (input != null) {
                scope.launch { dispatch(input) }
            }
        }

    private val request: AudioFocusRequest =
        AudioFocusRequest
            .Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(
                AudioAttributes
                    .Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build(),
            ).setAcceptsDelayedFocusGain(false)
            .setWillPauseWhenDucked(false)
            .setOnAudioFocusChangeListener(focusListener, Handler(Looper.getMainLooper()))
            .build()

    private val noisyReceiver =
        object : BroadcastReceiver() {
            override fun onReceive(
                context: Context,
                intent: Intent,
            ) {
                if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                    scope.launch { dispatch(FocusInput.BecomingNoisy) }
                }
            }
        }

    suspend fun play(): CommandResult = dispatch(FocusInput.PlayRequested)

    suspend fun pause(): CommandResult = dispatch(FocusInput.PauseRequested)

    suspend fun stop(): CommandResult = dispatch(FocusInput.Stopped)

    suspend fun onPlaybackChanged(isPlaying: Boolean) {
        dispatch(FocusInput.PlaybackChanged(isPlaying))
        updateNoisyReceiver(isPlaying)
    }

    suspend fun becomingNoisy(): CommandResult = dispatch(FocusInput.BecomingNoisy)

    fun release() {
        if (noisyRegistered) {
            context.unregisterReceiver(noisyReceiver)
            noisyRegistered = false
        }
        audioManager?.abandonAudioFocusRequest(request)
    }

    private suspend fun dispatch(input: FocusInput): CommandResult =
        mutex.withLock {
            var result: CommandResult = CommandResult.Acknowledged
            val pending = ArrayDeque(machine.handle(input))
            while (pending.isNotEmpty()) {
                when (val effect = pending.removeFirst()) {
                    FocusEffect.RequestFocus -> {
                        val granted = audioManager?.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
                        pending.addAll(0, machine.handle(if (granted) FocusInput.Granted else FocusInput.Denied))
                    }

                    FocusEffect.AbandonFocus -> {
                        audioManager?.abandonAudioFocusRequest(request)
                    }

                    FocusEffect.Play -> {
                        result = commands.play()
                    }

                    FocusEffect.Pause -> {
                        result = commands.pause()
                    }

                    is FocusEffect.Duck -> {
                        commands.duck(effect.level)
                    }

                    FocusEffect.Unduck -> {
                        commands.duck(1.0)
                    }

                    FocusEffect.ReportDenied -> {
                        Log.w(TAG, "Audio focus denied")
                        result = CommandResult.Failed(BridgeErrorCode.UNSUPPORTED, "Another app is using audio right now.")
                    }
                }
            }
            result
        }

    private fun updateNoisyReceiver(isPlaying: Boolean) {
        if (isPlaying && !noisyRegistered) {
            ContextCompat.registerReceiver(
                context,
                noisyReceiver,
                IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            noisyRegistered = true
        } else if (!isPlaying && noisyRegistered) {
            context.unregisterReceiver(noisyReceiver)
            noisyRegistered = false
        }
    }

    private companion object {
        const val TAG = "MusixFocus"
    }
}
