package com.realmadhoney.musix.core.browse

import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

enum class RootTab(
    val key: String,
    val title: String,
    val nodeId: String?,
) {
    HOME("home", "Home", "home"),
    LIBRARY("library", "Library", null),
    PLAYLISTS("playlists", "Playlists", "playlists"),
    RECENT("recent", "Recent", "recent"),
}

enum class LibraryFolder(
    val key: String,
    val title: String,
    val nodeId: String,
) {
    LIKED("liked", "Liked songs", "library-liked"),
    ALBUMS("albums", "Albums", "library-albums"),
    ARTISTS("artists", "Artists", "library-artists"),
}

sealed interface MediaRef {
    data object Root : MediaRef

    data class Tab(
        val tab: RootTab,
    ) : MediaRef

    data class Folder(
        val folder: LibraryFolder,
    ) : MediaRef

    data class Node(
        val nodeId: String,
        val playlistId: String?,
    ) : MediaRef

    data class Track(
        val videoId: String,
        val playlistId: String?,
    ) : MediaRef

    data class SearchQuery(
        val query: String,
    ) : MediaRef
}

object MediaIds {
    const val ROOT = "root"
    private const val TAB = "tab"
    private const val FOLDER = "folder"
    private const val NODE = "node"
    private const val TRACK = "track"
    private const val SEARCH = "search"
    private const val SEPARATOR = '/'
    private const val MAX_LENGTH = 16_384

    fun tab(tab: RootTab): String = "$TAB$SEPARATOR${tab.key}"

    fun folder(folder: LibraryFolder): String = "$FOLDER$SEPARATOR${folder.key}"

    fun node(
        nodeId: String,
        playlistId: String? = null,
    ): String = "$NODE$SEPARATOR${encode(nodeId)}$SEPARATOR${encode(playlistId.orEmpty())}"

    fun track(
        videoId: String,
        playlistId: String? = null,
    ): String = "$TRACK$SEPARATOR${encode(videoId)}$SEPARATOR${encode(playlistId.orEmpty())}"

    fun search(query: String): String = "$SEARCH$SEPARATOR${encode(query)}"

    fun parse(mediaId: String): MediaRef? {
        if (mediaId.isEmpty() || mediaId.length > MAX_LENGTH) {
            return null
        }
        if (mediaId == ROOT) {
            return MediaRef.Root
        }
        val parts = mediaId.split(SEPARATOR)
        val kind = parts.firstOrNull() ?: return null
        return when (kind) {
            TAB -> {
                parts.getOrNull(1)?.let { key -> RootTab.entries.firstOrNull { it.key == key } }?.let { MediaRef.Tab(it) }
            }

            FOLDER -> {
                parts.getOrNull(1)?.let { key -> LibraryFolder.entries.firstOrNull { it.key == key } }?.let { MediaRef.Folder(it) }
            }

            NODE -> {
                if (parts.size != 3) return null
                val nodeId = decode(parts[1]) ?: return null
                val playlistId = decode(parts[2]) ?: return null
                if (nodeId.isEmpty()) null else MediaRef.Node(nodeId, playlistId.ifEmpty { null })
            }

            TRACK -> {
                if (parts.size != 3) return null
                val videoId = decode(parts[1]) ?: return null
                val playlistId = decode(parts[2]) ?: return null
                if (videoId.isEmpty()) null else MediaRef.Track(videoId, playlistId.ifEmpty { null })
            }

            SEARCH -> {
                if (parts.size != 2) return null
                val query = decode(parts[1]) ?: return null
                if (query.isBlank()) null else MediaRef.SearchQuery(query)
            }

            else -> {
                null
            }
        }
    }

    private fun encode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8.name())

    private fun decode(value: String): String? =
        try {
            URLDecoder.decode(value, StandardCharsets.UTF_8.name())
        } catch (error: IllegalArgumentException) {
            null
        }
}
