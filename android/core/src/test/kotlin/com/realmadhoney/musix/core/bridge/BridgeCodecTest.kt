package com.realmadhoney.musix.core.bridge

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import java.io.File

class BridgeCodecTest {
    private val contractDir = File(System.getProperty("musix.contract").orEmpty())

    private fun contract(name: String): String = File(contractDir, "$name.json").readText()

    private fun accepted(raw: String): BridgeEvent {
        val result = BridgeCodec.decodeEvent(raw)
        assertThat(result).isInstanceOf(DecodeResult.Accepted::class.java)
        return (result as DecodeResult.Accepted).event
    }

    private fun rejected(raw: String): String {
        val result = BridgeCodec.decodeEvent(raw)
        assertThat(result).isInstanceOf(DecodeResult.Rejected::class.java)
        return (result as DecodeResult.Rejected).reason
    }

    @Test
    fun decodesEveryContractFileProducedByTheSharedBridge() {
        val files = contractDir.listFiles { file -> file.extension == "json" }.orEmpty()
        assertThat(files.size).isAtLeast(20)
        for (file in files) {
            val result = BridgeCodec.decodeEvent(file.readText())
            assertThat(result).isInstanceOf(DecodeResult.Accepted::class.java)
        }
    }

    @Test
    fun decodesStateWithAllFields() {
        val event = accepted(contract("state-playing")) as BridgeEvent.State
        assertThat(event.state.videoId).isEqualTo("lYBUbBu4W08")
        assertThat(event.state.positionSec).isEqualTo(42.5)
        assertThat(event.state.likeStatus).isEqualTo(LikeStatus.LIKE)
        assertThat(event.state.repeatMode).isEqualTo(RepeatMode.ALL)
        assertThat(event.state.isSignedIn).isTrue()
    }

    @Test
    fun decodesBrowsePagesWithSectionsAndContinuations() {
        val home = accepted(contract("browseResult-browse-home")) as BridgeEvent.BrowseResult
        assertThat(home.page.sections).isNotEmpty()
        assertThat(home.page.continuation).isNotNull()
        val firstItem = home.page.sections[0].items[0]
        assertThat(firstItem.type).isEqualTo(ItemType.SONG)
        assertThat(firstItem.playable).isTrue()
        val album = accepted(contract("browseResult-browse-album")) as BridgeEvent.BrowseResult
        assertThat(album.page.title).isEqualTo("Random Access Memories")
    }

    @Test
    fun decodesErrorsWithAndWithoutRequestIds() {
        val scoped = accepted(contract("error-signed-out")) as BridgeEvent.Error
        assertThat(scoped.code).isEqualTo(BridgeErrorCode.NOT_SIGNED_IN)
        assertThat(scoped.requestId).isEqualTo("n4")
        val global = accepted(contract("error-global")) as BridgeEvent.Error
        assertThat(global.requestId).isNull()
    }

    @Test
    fun toleratesUnknownExtraFields() {
        val event = accepted("""{"v":1,"type":"ack","requestId":"n1","extra":{"nested":true}}""")
        assertThat(event).isEqualTo(BridgeEvent.Ack(1, "n1"))
    }

    @Test
    fun rejectsWrongVersionsUnknownTypesAndMalformedJson() {
        assertThat(rejected("""{"v":2,"type":"ack","requestId":"n1"}""")).contains("version")
        rejected("""{"v":1,"type":"teleport"}""")
        rejected("""{"v":1,"requestId":"n1"}""")
        rejected("not json")
        rejected("""{"v":1,"type":"ack"}""")
        rejected("""{"v":1,"type":"ack","requestId":""}""")
        rejected("""{"v":1,"type":"ack","requestId":"${"x".repeat(65)}"}""")
    }

    @Test
    fun rejectsStatesOutsideTheContract() {
        val base = contract("state-playing")
        rejected(base.replace("\"durationSec\": 213", "\"durationSec\": -1"))
        rejected(base.replace("\"volume\": 0.8", "\"volume\": 1.5"))
        rejected(base.replace("https://lh3.googleusercontent.com", "http://lh3.googleusercontent.com"))
        rejected(base.replace("\"likeStatus\": \"LIKE\"", "\"likeStatus\": \"LOVE\""))
        rejected(base.replace("\"isAd\": false,", ""))
    }

    @Test
    fun rejectsOversizedMessages() {
        val huge = "{\"v\":1,\"type\":\"signedIn\",\"avatarUrl\":\"https://a/" + "x".repeat(BridgeCodec.MAX_MESSAGE_CHARS) + "\"}"
        assertThat(rejected(huge)).contains("too large")
    }

    @Test
    fun encodesCommandsWithVersionAndType() {
        val json = BridgeCodec.encodeCommand(BridgeCommand.SeekTo("n9", 12.5))
        assertThat(json).isEqualTo("""{"type":"seekTo","requestId":"n9","seconds":12.5,"v":1}""")
        val play = BridgeCodec.encodeCommand(BridgeCommand.PlayVideoId("n1", "lYBUbBu4W08", null))
        assertThat(play).contains("\"playlistId\":null")
        val repeat = BridgeCodec.encodeCommand(BridgeCommand.SetRepeat("n2", RepeatMode.ONE))
        assertThat(repeat).contains("\"mode\":\"ONE\"")
        val search = BridgeCodec.encodeCommand(BridgeCommand.Search("n3", "daft punk", SearchFilter.SONGS))
        assertThat(search).contains("\"filter\":\"songs\"")
        val more = BridgeCodec.encodeCommand(BridgeCommand.LoadContinuation("n4", "token", ContinuationKind.SEARCH, "search:all:x"))
        assertThat(more).contains("\"kind\":\"search\"")
    }

    @Test
    fun encodesPlaylistCommands() {
        assertThat(BridgeCodec.encodeCommand(BridgeCommand.PlaylistTargets("n1", "lYBUbBu4W08"))).contains("\"type\":\"playlistTargets\"")
        val add = BridgeCodec.encodeCommand(BridgeCommand.AddToPlaylist("n2", "lYBUbBu4W08", "PLroadTrip001"))
        assertThat(add).contains("\"playlistId\":\"PLroadTrip001\"")
        assertThat(BridgeCodec.encodeCommand(BridgeCommand.SavePlaylist("n3", "OLAK5uy_abc", false))).contains("\"save\":false")
        assertThat(BridgeCodec.problemWith(BridgeCommand.PlaylistTargets("n1", "bad"))).isNotNull()
        assertThat(BridgeCodec.problemWith(BridgeCommand.AddToPlaylist("n1", "lYBUbBu4W08", "bad list"))).isNotNull()
        assertThat(BridgeCodec.problemWith(BridgeCommand.SavePlaylist("n1", "x", true))).isNotNull()
    }

    @Test
    fun refusesToEncodeInvalidCommands() {
        assertThat(BridgeCodec.problemWith(BridgeCommand.SetVolume("n1", 2.0))).isNotNull()
        assertThat(BridgeCodec.problemWith(BridgeCommand.SeekTo("n1", Double.NaN))).isNotNull()
        assertThat(BridgeCodec.problemWith(BridgeCommand.PlayVideoId("n1", "<script>", null))).isNotNull()
        assertThat(BridgeCodec.problemWith(BridgeCommand.PlayVideoId("n1", "", null))).isNotNull()
        assertThat(BridgeCodec.problemWith(BridgeCommand.PlayVideoId("n1", "", "OLAK5uy_abc"))).isNull()
        assertThat(BridgeCodec.problemWith(BridgeCommand.PlayVideoId("n1", "lYBUbBu4W08", "bad list"))).isNotNull()
        assertThat(BridgeCodec.problemWith(BridgeCommand.Search("n1", "   ", SearchFilter.ALL))).isNotNull()
        assertThat(BridgeCodec.problemWith(BridgeCommand.PlayQueueIndex("n1", -1))).isNotNull()
        assertThat(BridgeCodec.problemWith(BridgeCommand.Play(""))).isNotNull()
    }
}
