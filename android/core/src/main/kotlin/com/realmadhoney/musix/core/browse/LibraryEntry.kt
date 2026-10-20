package com.realmadhoney.musix.core.browse

import com.realmadhoney.musix.core.bridge.FlatItem
import com.realmadhoney.musix.core.bridge.ItemType
import kotlinx.serialization.Serializable

enum class EntryKind { TAB, FOLDER, SONG, VIDEO, ALBUM, PLAYLIST, ARTIST, CATEGORY }

@Serializable
data class LibraryEntry(
    val mediaId: String,
    val title: String,
    val subtitle: String,
    val artworkUrl: String,
    val browsable: Boolean,
    val playable: Boolean,
    val kind: EntryKind,
    val groupTitle: String?,
    val durationMs: Long?,
)

object LibraryEntries {
    fun rootTabs(): List<LibraryEntry> =
        RootTab.entries.map { tab ->
            LibraryEntry(
                mediaId = MediaIds.tab(tab),
                title = tab.title,
                subtitle = "",
                artworkUrl = "",
                browsable = true,
                playable = false,
                kind = EntryKind.TAB,
                groupTitle = null,
                durationMs = null,
            )
        }

    fun libraryFolders(): List<LibraryEntry> =
        LibraryFolder.entries.map { folder ->
            LibraryEntry(
                mediaId = MediaIds.folder(folder),
                title = folder.title,
                subtitle = "",
                artworkUrl = "",
                browsable = true,
                playable = false,
                kind = EntryKind.FOLDER,
                groupTitle = null,
                durationMs = null,
            )
        }

    fun fromItem(
        item: FlatItem,
        groupTitle: String?,
        contextPlaylistId: String?,
    ): LibraryEntry? {
        val title = item.title.trim()
        if (title.isEmpty()) {
            return null
        }
        val durationMs = item.durationSec?.let { (it * 1000).toLong() }
        val videoId = item.videoId?.takeIf { it.isNotEmpty() }
        val playlistId = item.playlistId?.takeIf { it.isNotEmpty() }
        val browseId = item.browseId?.takeIf { it.isNotEmpty() }
        val trackLike = item.type == ItemType.SONG || item.type == ItemType.VIDEO
        if (trackLike && videoId != null && item.playable) {
            return LibraryEntry(
                mediaId = MediaIds.track(videoId, playlistId ?: contextPlaylistId),
                title = title,
                subtitle = item.subtitle,
                artworkUrl = item.artworkUrl,
                browsable = false,
                playable = true,
                kind = if (item.type == ItemType.SONG) EntryKind.SONG else EntryKind.VIDEO,
                groupTitle = groupTitle,
                durationMs = durationMs,
            )
        }
        if (browseId != null && item.browsable) {
            val kind =
                when (item.type) {
                    ItemType.ALBUM -> EntryKind.ALBUM
                    ItemType.PLAYLIST -> EntryKind.PLAYLIST
                    ItemType.ARTIST -> EntryKind.ARTIST
                    else -> EntryKind.CATEGORY
                }
            val playableCollection = (kind == EntryKind.ALBUM || kind == EntryKind.PLAYLIST) && playlistId != null
            return LibraryEntry(
                mediaId = MediaIds.node(browseId, if (playableCollection) playlistId else null),
                title = title,
                subtitle = item.subtitle,
                artworkUrl = item.artworkUrl,
                browsable = true,
                playable = playableCollection,
                kind = kind,
                groupTitle = groupTitle,
                durationMs = null,
            )
        }
        if (videoId != null && item.playable) {
            return LibraryEntry(
                mediaId = MediaIds.track(videoId, playlistId ?: contextPlaylistId),
                title = title,
                subtitle = item.subtitle,
                artworkUrl = item.artworkUrl,
                browsable = false,
                playable = true,
                kind = EntryKind.SONG,
                groupTitle = groupTitle,
                durationMs = durationMs,
            )
        }
        if (playlistId != null && item.playable) {
            return LibraryEntry(
                mediaId = MediaIds.node(playlistId, playlistId),
                title = title,
                subtitle = item.subtitle,
                artworkUrl = item.artworkUrl,
                browsable = false,
                playable = true,
                kind = EntryKind.PLAYLIST,
                groupTitle = groupTitle,
                durationMs = null,
            )
        }
        return null
    }
}
