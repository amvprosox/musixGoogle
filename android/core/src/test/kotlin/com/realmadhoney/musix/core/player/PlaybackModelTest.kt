package com.realmadhoney.musix.core.player

import com.google.common.truth.Truth.assertThat
import com.realmadhoney.musix.core.bridge.BridgeState
import com.realmadhoney.musix.core.bridge.QueueEntry
import com.realmadhoney.musix.core.bridge.RepeatMode
import com.realmadhoney.musix.core.browse.MediaIds
import com.realmadhoney.musix.core.browse.MediaRef
import org.junit.Test

class PlaybackModelTest {
    private val playing =
        BridgeState.EMPTY.copy(
            videoId = "bbbbbbbbbbb",
            playlistId = "RDAMVMbbbbbbbbbbb",
            title = "Second",
            artist = "Artist B",
            album = "Album B",
            artworkUrl = "https://lh3.googleusercontent.com/b",
            durationSec = 200.0,
            positionSec = 12.0,
            bufferedSec = 40.0,
            isPlaying = true,
        )

    private val queue =
        listOf(
            QueueEntry(2, "ccccccccccc", "Third", "Artist C", "https://i.ytimg.com/c", 100.0, false),
            QueueEntry(0, "aaaaaaaaaaa", "First", "Artist A", "https://i.ytimg.com/a", 150.0, false),
            QueueEntry(1, "bbbbbbbbbbb", "Second", "Artist B", "https://i.ytimg.com/b", 200.0, true),
        )

    @Test
    fun buildsTheTimelineFromTheQueueInOrder() {
        val timeline = PlaybackModel.timeline(playing, queue)
        assertThat(timeline.tracks.map { it.title }).containsExactly("First", "Second", "Third").inOrder()
        assertThat(timeline.currentIndex).isEqualTo(1)
        val current = timeline.current
        assertThat(current?.album).isEqualTo("Album B")
        assertThat(current?.artworkUrl).isEqualTo("https://lh3.googleusercontent.com/b")
        assertThat(current?.durationMs).isEqualTo(200_000L)
        assertThat(MediaIds.parse(current?.mediaId.orEmpty())).isEqualTo(MediaRef.Track("bbbbbbbbbbb", "RDAMVMbbbbbbbbbbb"))
        assertThat(timeline.tracks.map { it.uid }.toSet()).hasSize(3)
    }

    @Test
    fun keepsUidsUniqueWhenATrackRepeats() {
        val repeated = queue + QueueEntry(3, "aaaaaaaaaaa", "First", "Artist A", "", 150.0, false)
        val timeline = PlaybackModel.timeline(playing, repeated)
        assertThat(timeline.tracks.map { it.uid }.toSet()).hasSize(4)
    }

    @Test
    fun fallsBackToTheCurrentTrackWhenTheQueueIsMissingIt() {
        val timeline = PlaybackModel.timeline(playing.copy(videoId = "zzzzzzzzzzz"), queue.map { it.copy(isCurrent = false) })
        assertThat(timeline.tracks).hasSize(1)
        assertThat(timeline.current?.videoId).isEqualTo("zzzzzzzzzzz")
        assertThat(PlaybackModel.timeline(playing, emptyList()).tracks).hasSize(1)
        assertThat(PlaybackModel.timeline(BridgeState.EMPTY, emptyList())).isEqualTo(TimelineSpec.EMPTY)
    }

    @Test
    fun showsAdsAsLoading() {
        val ad = playing.copy(isAd = true, title = "Buy things", artist = "Advertiser")
        val timeline = PlaybackModel.timeline(ad, queue)
        val current = timeline.current
        assertThat(current?.title).isEqualTo(PlaybackModel.LOADING_TITLE)
        assertThat(current?.artist).isEmpty()
        assertThat(current?.artworkUrl).isEmpty()
        assertThat(current?.isAd).isTrue()
        assertThat(PlaybackModel.positionMs(ad)).isEqualTo(0L)
        assertThat(PlaybackModel.bufferedMs(ad)).isEqualTo(0L)
    }

    @Test
    fun reportsPositionAndBufferInMilliseconds() {
        assertThat(PlaybackModel.positionMs(playing)).isEqualTo(12_000L)
        assertThat(PlaybackModel.bufferedMs(playing)).isEqualTo(40_000L)
        assertThat(PlaybackModel.bufferedMs(playing.copy(bufferedSec = 1.0))).isEqualTo(12_000L)
    }

    @Test
    fun previousRestartsTheTrackAfterThreeSeconds() {
        assertThat(PlaybackModel.previousAction(3_001)).isEqualTo(SeekAction.SeekWithinTrack(0.0))
        assertThat(PlaybackModel.previousAction(3_000)).isEqualTo(SeekAction.PreviousTrack)
        assertThat(PlaybackModel.previousAction(0)).isEqualTo(SeekAction.PreviousTrack)
    }

    @Test
    fun translatesMedia3SeeksIntoBridgeActions() {
        assertThat(PlaybackModel.translateSeek(1, 1, 30_500, 3)).isEqualTo(SeekAction.SeekWithinTrack(30.5))
        assertThat(PlaybackModel.translateSeek(1, 2, 0, 3)).isEqualTo(SeekAction.NextTrack)
        assertThat(PlaybackModel.translateSeek(1, 0, 0, 3)).isEqualTo(SeekAction.PreviousTrack)
        assertThat(PlaybackModel.translateSeek(0, 2, 0, 3)).isEqualTo(SeekAction.JumpToQueueIndex(2))
        assertThat(PlaybackModel.translateSeek(0, 5, 0, 3)).isEqualTo(SeekAction.Ignore)
        assertThat(PlaybackModel.translateSeek(0, 0, 0, 0)).isEqualTo(SeekAction.Ignore)
        assertThat(PlaybackModel.translateSeek(1, 1, -50, 3)).isEqualTo(SeekAction.SeekWithinTrack(0.0))
    }

    @Test
    fun honoursNextAndPreviousIntentsEvenWhenRepeatWraps() {
        assertThat(PlaybackModel.translateSeek(1, 0, 0, 2, SeekIntent.NEXT)).isEqualTo(SeekAction.NextTrack)
        assertThat(PlaybackModel.translateSeek(0, 1, 0, 2, SeekIntent.PREVIOUS)).isEqualTo(SeekAction.PreviousTrack)
        assertThat(PlaybackModel.translateSeek(1, 1, 0, 2, SeekIntent.PREVIOUS)).isEqualTo(SeekAction.SeekWithinTrack(0.0))
        assertThat(PlaybackModel.translateSeek(0, 0, 0, 0, SeekIntent.NEXT)).isEqualTo(SeekAction.Ignore)
    }

    @Test
    fun cyclesRepeatModes() {
        assertThat(PlaybackModel.nextRepeatMode(RepeatMode.NONE)).isEqualTo(RepeatMode.ALL)
        assertThat(PlaybackModel.nextRepeatMode(RepeatMode.ALL)).isEqualTo(RepeatMode.ONE)
        assertThat(PlaybackModel.nextRepeatMode(RepeatMode.ONE)).isEqualTo(RepeatMode.NONE)
    }
}
