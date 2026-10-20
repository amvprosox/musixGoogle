package com.realmadhoney.musix.core.browse

import com.google.common.truth.Truth.assertThat
import com.realmadhoney.musix.core.bridge.BridgeCodec
import com.realmadhoney.musix.core.bridge.BridgeEvent
import com.realmadhoney.musix.core.bridge.BrowsePage
import com.realmadhoney.musix.core.bridge.ContinuationKind
import com.realmadhoney.musix.core.bridge.DecodeResult
import com.realmadhoney.musix.core.bridge.FlatItem
import com.realmadhoney.musix.core.bridge.FlatSection
import com.realmadhoney.musix.core.bridge.ItemType
import com.realmadhoney.musix.core.cache.TtlCache
import kotlinx.coroutines.test.runTest
import org.junit.Test
import java.io.File

class BrowseTest {
    private val contractDir = File(System.getProperty("musix.contract").orEmpty())

    private fun page(name: String): BrowsePage {
        val result = BridgeCodec.decodeEvent(File(contractDir, "$name.json").readText())
        val event = (result as DecodeResult.Accepted).event
        return when (event) {
            is BridgeEvent.BrowseResult -> event.page
            is BridgeEvent.SearchResult -> event.page
            else -> error("not a page")
        }
    }

    private fun song(
        n: Int,
        playlistId: String? = null,
    ) = FlatItem(
        id = "v$n",
        title = "Song $n",
        subtitle = "Artist",
        artworkUrl = "",
        type = ItemType.SONG,
        playable = true,
        browsable = false,
        videoId = "video${n.toString().padStart(5, '0')}",
        playlistId = playlistId,
        browseId = null,
        durationSec = 180.0,
        continuation = null,
    )

    private class FakeSource(
        private val pages: Map<String, BrowsePage>,
        private val continuations: Map<String, BrowsePage> = emptyMap(),
    ) : PageSource {
        var failure: LoadFailure? = null
        val calls = mutableListOf<String>()

        override suspend fun browse(nodeId: String): PageLoad {
            calls += "browse:$nodeId"
            failure?.let { return PageLoad.Failed(it) }
            val page = pages[nodeId] ?: return PageLoad.Failed(LoadFailure.Error("missing $nodeId"))
            return PageLoad.Loaded(page)
        }

        override suspend fun search(query: String): PageLoad {
            calls += "search:$query"
            failure?.let { return PageLoad.Failed(it) }
            val page = pages["search:$query"] ?: return PageLoad.Failed(LoadFailure.Error("missing search"))
            return PageLoad.Loaded(page)
        }

        override suspend fun more(
            nodeId: String,
            token: String,
            kind: ContinuationKind,
        ): PageLoad {
            calls += "more:$nodeId:$token:$kind"
            failure?.let { return PageLoad.Failed(it) }
            val page = continuations[token] ?: return PageLoad.Failed(LoadFailure.Error("missing $token"))
            return PageLoad.Loaded(page)
        }
    }

    @Test
    fun mediaIdsRoundTripEveryKind() {
        val ids =
            listOf(
                MediaIds.ROOT to MediaRef.Root,
                MediaIds.tab(RootTab.RECENT) to MediaRef.Tab(RootTab.RECENT),
                MediaIds.folder(LibraryFolder.ALBUMS) to MediaRef.Folder(LibraryFolder.ALBUMS),
                MediaIds.node("FEmusic_moods|params/with=slash", "OLAK5uy_x") to
                    MediaRef.Node("FEmusic_moods|params/with=slash", "OLAK5uy_x"),
                MediaIds.node("MPREb_abc") to MediaRef.Node("MPREb_abc", null),
                MediaIds.track("lYBUbBu4W08", "RDAMVM") to MediaRef.Track("lYBUbBu4W08", "RDAMVM"),
                MediaIds.search("daft punk / live") to MediaRef.SearchQuery("daft punk / live"),
            )
        for ((id, ref) in ids) {
            assertThat(MediaIds.parse(id)).isEqualTo(ref)
        }
    }

    @Test
    fun mediaIdsRejectGarbage() {
        listOf("", "tab/unknown", "node", "node/a", "track//", "search/", "search/%20", "what/ever", "track/%zz/").forEach {
            assertThat(MediaIds.parse(it)).isNull()
        }
        assertThat(MediaIds.parse("x".repeat(20_000))).isNull()
    }

    @Test
    fun rootHasFourTabsAndLibraryHasThreeFolders() {
        assertThat(LibraryEntries.rootTabs().map { it.title }).containsExactly("Home", "Library", "Playlists", "Recent").inOrder()
        assertThat(LibraryEntries.rootTabs().all { it.browsable && !it.playable }).isTrue()
        assertThat(LibraryEntries.libraryFolders().map { it.title }).containsExactly("Liked songs", "Albums", "Artists").inOrder()
    }

    @Test
    fun mapsSongsAlbumsPlaylistsAndArtists() {
        val home = page("browseResult-browse-home")
        val entries =
            home.sections.flatMap { section -> section.items.mapNotNull { LibraryEntries.fromItem(it, section.title, null) } }
        val song = entries.first()
        assertThat(song.kind).isEqualTo(EntryKind.SONG)
        assertThat(song.playable).isTrue()
        assertThat(song.browsable).isFalse()
        assertThat(song.groupTitle).isEqualTo("Quick picks")
        assertThat(MediaIds.parse(song.mediaId)).isInstanceOf(MediaRef.Track::class.java)
        val playlist = entries.first { it.kind == EntryKind.PLAYLIST }
        assertThat(playlist.browsable).isTrue()
        val ref = MediaIds.parse(playlist.mediaId) as MediaRef.Node
        assertThat(ref.nodeId).isNotEmpty()
        val artist = page("browseResult-browse-artist")
        val artistEntries = artist.sections.flatMap { s -> s.items.mapNotNull { LibraryEntries.fromItem(it, s.title, null) } }
        assertThat(artistEntries.map { it.kind }.toSet()).containsAtLeast(EntryKind.SONG, EntryKind.ALBUM)
        val albums = artistEntries.filter { it.kind == EntryKind.ALBUM }
        assertThat(albums.all { it.browsable }).isTrue()
    }

    @Test
    fun skipsItemsThatCanNeitherPlayNorBrowse() {
        val inert =
            FlatItem("x", "Header", "", "", ItemType.SHELF, playable = false, browsable = false, null, null, null, null, null)
        assertThat(LibraryEntries.fromItem(inert, null, null)).isNull()
        assertThat(LibraryEntries.fromItem(song(1).copy(title = "  "), null, null)).isNull()
    }

    @Test
    fun tracksInheritThePagePlaylistContext() {
        val entry = LibraryEntries.fromItem(song(1), null, "PLcontext")
        assertThat(MediaIds.parse(entry?.mediaId.orEmpty())).isEqualTo(MediaRef.Track("video00001", "PLcontext"))
    }

    @Test
    fun pagesInChunksOfFiftyAndFollowsContinuations() =
        runTest {
            val first = BrowsePage("VLPL", "Big playlist", emptyList(), (0 until 100).map { song(it) }, "c1")
            val second = BrowsePage("VLPL", "", listOf(FlatSection("s", "", null, (100 until 160).map { song(it) })), emptyList(), null)
            val source = FakeSource(mapOf("VLPL" to first), mapOf("c1" to second))
            val pager = BrowsePager(source, TtlCache(600_000, { 0L }))
            val page0 = pager.children("VLPL", 0, 200) as ChildrenResult.Loaded
            assertThat(page0.entries).hasSize(50)
            assertThat(page0.title).isEqualTo("Big playlist")
            val page2 = pager.children("VLPL", 2, 50) as ChildrenResult.Loaded
            assertThat(page2.entries.first().title).isEqualTo("Song 100")
            assertThat(page2.entries).hasSize(50)
            val page3 = pager.children("VLPL", 3, 50) as ChildrenResult.Loaded
            assertThat(page3.entries).hasSize(10)
            val page4 = pager.children("VLPL", 4, 50) as ChildrenResult.Loaded
            assertThat(page4.entries).isEmpty()
            assertThat(source.calls).containsExactly("browse:VLPL", "more:VLPL:c1:BROWSE")
            assertThat(pager.find(MediaIds.track("video00120"))?.title).isEqualTo("Song 120")
            assertThat(pager.find("track/missing/")).isNull()
        }

    @Test
    fun servesFreshCacheWithinTenMinutesAndReloadsAfter() =
        runTest {
            var now = 0L
            val source = FakeSource(mapOf("home" to page("browseResult-browse-home")))
            val pager = BrowsePager(source, TtlCache(600_000, { now }))
            pager.children("home", 0, 50)
            now = 599_000
            pager.children("home", 0, 50)
            assertThat(source.calls.count { it.startsWith("browse") }).isEqualTo(1)
            now = 601_000
            pager.children("home", 0, 50)
            assertThat(source.calls.count { it.startsWith("browse") }).isEqualTo(2)
        }

    @Test
    fun fallsBackToStaleEntriesWhenOffline() =
        runTest {
            var now = 0L
            val source = FakeSource(mapOf("home" to page("browseResult-browse-home")))
            val pager = BrowsePager(source, TtlCache(600_000, { now }))
            pager.children("home", 0, 50)
            now = 3_600_000
            source.failure = LoadFailure.Offline
            val result = pager.children("home", 0, 50) as ChildrenResult.Loaded
            assertThat(result.stale).isTrue()
            assertThat(result.entries).isNotEmpty()
        }

    @Test
    fun reportsSignedOutAndOfflineWithoutCache() =
        runTest {
            val source = FakeSource(emptyMap())
            val pager = BrowsePager(source, TtlCache(600_000, { 0L }))
            source.failure = LoadFailure.SignedOut
            assertThat(pager.children("playlists", 0, 50)).isEqualTo(ChildrenResult.Failed(LoadFailure.SignedOut))
            source.failure = LoadFailure.Offline
            assertThat(pager.children("recent", 0, 50)).isEqualTo(ChildrenResult.Failed(LoadFailure.Offline))
        }

    @Test
    fun searchUsesSearchContinuations() =
        runTest {
            val first = BrowsePage("search:all:q", "", emptyList(), (0 until 20).map { song(it) }, "s1")
            val second = BrowsePage("search:all:q", "", emptyList(), (20 until 40).map { song(it) }, null)
            val source = FakeSource(mapOf("search:q" to first), mapOf("s1" to second))
            val pager = BrowsePager(source, TtlCache(600_000, { 0L }))
            val result = pager.search("q", 0, 30) as ChildrenResult.Loaded
            assertThat(result.entries).hasSize(30)
            assertThat(source.calls).containsExactly("search:q", "more:search:all:q:s1:SEARCH")
        }

    @Test
    fun stopsWhenAContinuationRepeats() =
        runTest {
            val first = BrowsePage("loop", "", emptyList(), (0 until 5).map { song(it) }, "same")
            val again = BrowsePage("loop", "", emptyList(), (5 until 10).map { song(it) }, "same")
            val source = FakeSource(mapOf("loop" to first), mapOf("same" to again))
            val pager = BrowsePager(source, TtlCache(600_000, { 0L }))
            val result = pager.children("loop", 0, 50) as ChildrenResult.Loaded
            assertThat(result.entries).hasSize(10)
            assertThat(source.calls.count { it.startsWith("more") }).isEqualTo(1)
        }
}
