package com.realmadhoney.musix.core.audio

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class AudioFocusMachineTest {
    private fun playing(): AudioFocusMachine =
        AudioFocusMachine().apply {
            handle(FocusInput.PlayRequested)
            handle(FocusInput.Granted)
        }

    @Test
    fun requestsFocusBeforePlaying() {
        val machine = AudioFocusMachine()
        assertThat(machine.handle(FocusInput.PlayRequested)).containsExactly(FocusEffect.RequestFocus)
        assertThat(machine.state).isEqualTo(FocusState.Requesting)
        assertThat(machine.handle(FocusInput.Granted)).containsExactly(FocusEffect.Play)
        assertThat(machine.state).isEqualTo(FocusState.Holding(ducked = false))
        assertThat(machine.isPlaying).isTrue()
    }

    @Test
    fun reportsDeniedFocusAndStaysIdle() {
        val machine = AudioFocusMachine()
        machine.handle(FocusInput.PlayRequested)
        assertThat(machine.handle(FocusInput.Denied)).containsExactly(FocusEffect.ReportDenied)
        assertThat(machine.state).isEqualTo(FocusState.Idle)
        assertThat(machine.isPlaying).isFalse()
    }

    @Test
    fun ducksAndRestoresForShortInterruptions() {
        val machine = playing()
        assertThat(machine.handle(FocusInput.LossTransientCanDuck)).containsExactly(FocusEffect.Duck(0.2))
        assertThat(machine.handle(FocusInput.Gain)).containsExactly(FocusEffect.Unduck)
        assertThat(machine.state).isEqualTo(FocusState.Holding(ducked = false))
    }

    @Test
    fun pausesForTransientLossAndResumesOnGain() {
        val machine = playing()
        assertThat(machine.handle(FocusInput.LossTransient)).containsExactly(FocusEffect.Pause)
        assertThat(machine.state).isEqualTo(FocusState.PausedTransient(resumeOnGain = true))
        assertThat(machine.handle(FocusInput.Gain)).containsExactly(FocusEffect.Unduck, FocusEffect.Play).inOrder()
        assertThat(machine.isPlaying).isTrue()
    }

    @Test
    fun doesNotResumeIfTheUserPausedDuringTheInterruption() {
        val machine = playing()
        machine.handle(FocusInput.LossTransient)
        assertThat(machine.handle(FocusInput.PauseRequested)).isEmpty()
        assertThat(machine.handle(FocusInput.Gain)).containsExactly(FocusEffect.Unduck)
        assertThat(machine.isPlaying).isFalse()
    }

    @Test
    fun doesNotResumeAfterTransientLossWhilePaused() {
        val machine = playing()
        machine.handle(FocusInput.PauseRequested)
        assertThat(machine.handle(FocusInput.LossTransient)).isEmpty()
        assertThat(machine.handle(FocusInput.Gain)).containsExactly(FocusEffect.Unduck)
    }

    @Test
    fun abandonsFocusOnPermanentLoss() {
        val machine = playing()
        assertThat(machine.handle(FocusInput.Loss))
            .containsExactly(FocusEffect.Pause, FocusEffect.Unduck, FocusEffect.AbandonFocus)
            .inOrder()
        assertThat(machine.state).isEqualTo(FocusState.Lost)
        assertThat(machine.handle(FocusInput.Gain)).isEmpty()
        assertThat(machine.handle(FocusInput.PlayRequested)).containsExactly(FocusEffect.RequestFocus)
    }

    @Test
    fun pausesWhenHeadphonesAreUnplugged() {
        val machine = playing()
        assertThat(machine.handle(FocusInput.BecomingNoisy)).containsExactly(FocusEffect.Pause)
        assertThat(machine.handle(FocusInput.BecomingNoisy)).isEmpty()
        assertThat(machine.state).isEqualTo(FocusState.Holding(ducked = false))
    }

    @Test
    fun noisyDuringTransientLossCancelsTheResume() {
        val machine = playing()
        machine.handle(FocusInput.LossTransientCanDuck)
        machine.handle(FocusInput.LossTransient)
        machine.handle(FocusInput.BecomingNoisy)
        assertThat(machine.handle(FocusInput.Gain)).doesNotContain(FocusEffect.Play)
    }

    @Test
    fun requestsFocusWhenPlaybackStartsInsideThePage() {
        val machine = AudioFocusMachine()
        assertThat(machine.handle(FocusInput.PlaybackChanged(true))).containsExactly(FocusEffect.RequestFocus)
        machine.handle(FocusInput.Granted)
        assertThat(machine.handle(FocusInput.PlaybackChanged(false))).isEmpty()
        assertThat(machine.isPlaying).isFalse()
        assertThat(machine.handle(FocusInput.PlaybackChanged(true))).isEmpty()
        assertThat(machine.isPlaying).isTrue()
    }

    @Test
    fun releasesFocusWhenStopped() {
        val machine = playing()
        assertThat(machine.handle(FocusInput.Stopped)).containsExactly(FocusEffect.Unduck, FocusEffect.AbandonFocus).inOrder()
        assertThat(machine.state).isEqualTo(FocusState.Idle)
        assertThat(machine.handle(FocusInput.Stopped)).isEmpty()
    }

    @Test
    fun pausingWhileRequestingCancelsTheRequest() {
        val machine = AudioFocusMachine()
        machine.handle(FocusInput.PlayRequested)
        assertThat(machine.handle(FocusInput.PauseRequested)).containsExactly(FocusEffect.AbandonFocus)
        assertThat(machine.handle(FocusInput.Granted)).isEmpty()
    }
}
