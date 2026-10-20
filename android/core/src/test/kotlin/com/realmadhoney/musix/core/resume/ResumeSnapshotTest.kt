package com.realmadhoney.musix.core.resume

import com.google.common.truth.Truth.assertThat
import com.realmadhoney.musix.core.bridge.BridgeState
import org.junit.Test

class ResumeSnapshotTest {
    private val state =
        BridgeState.EMPTY.copy(
            videoId = "lYBUbBu4W08",
            playlistId = "RDAMVMlYBUbBu4W08",
            title = "Never Gonna Give You Up",
            artist = "Rick Astley",
            durationSec = 213.0,
            positionSec = 61.25,
        )

    @Test
    fun capturesAndRestoresTheLastTrack() {
        val snapshot = ResumeSnapshot.from(state, now = 42L)
        assertThat(snapshot).isNotNull()
        val restored = ResumeSnapshot.decode(snapshot?.let { ResumeSnapshot.encode(it) })
        assertThat(restored).isEqualTo(snapshot)
        assertThat(restored?.positionMs).isEqualTo(61_250L)
        assertThat(restored?.playlistId).isEqualTo("RDAMVMlYBUbBu4W08")
    }

    @Test
    fun skipsAdsAndEmptyStates() {
        assertThat(ResumeSnapshot.from(state.copy(isAd = true), 0L)).isNull()
        assertThat(ResumeSnapshot.from(BridgeState.EMPTY, 0L)).isNull()
        assertThat(ResumeSnapshot.from(state.copy(videoId = "bad id"), 0L)).isNull()
    }

    @Test
    fun restartsTracksThatHadAlmostFinished() {
        val snapshot = ResumeSnapshot.from(state.copy(positionSec = 210.0), 0L)
        assertThat(snapshot?.positionSec).isEqualTo(0.0)
    }

    @Test
    fun ignoresInvalidStoredData() {
        assertThat(ResumeSnapshot.decode(null)).isNull()
        assertThat(ResumeSnapshot.decode("")).isNull()
        assertThat(ResumeSnapshot.decode("{")).isNull()
        assertThat(ResumeSnapshot.decode("""{"videoId":"x"}""")).isNull()
    }
}
