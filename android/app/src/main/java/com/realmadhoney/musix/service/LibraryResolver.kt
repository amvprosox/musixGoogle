package com.realmadhoney.musix.service

import androidx.media3.common.MediaItem
import com.realmadhoney.musix.core.browse.BrowsePager
import com.realmadhoney.musix.core.browse.ChildrenResult
import com.realmadhoney.musix.core.browse.EntryKind
import com.realmadhoney.musix.core.browse.LibraryEntries
import com.realmadhoney.musix.core.browse.LibraryEntry
import com.realmadhoney.musix.core.browse.LoadFailure
import com.realmadhoney.musix.core.browse.MediaIds
import com.realmadhoney.musix.core.browse.MediaRef
import com.realmadhoney.musix.core.browse.RootTab
import com.realmadhoney.musix.core.resume.ResumeSnapshot
import com.realmadhoney.musix.player.MediaItemFactory

sealed interface Children {
    data class Items(
        val items: List<MediaItem>,
        val stale: Boolean,
    ) : Children

    data class Error(
        val failure: LoadFailure,
    ) : Children

    data object NotFound : Children
}

class LibraryResolver(
    private val pager: BrowsePager,
    private val items: MediaItemFactory,
    private val resume: suspend () -> ResumeSnapshot?,
) {
    suspend fun children(
        parentId: String,
        page: Int,
        pageSize: Int,
    ): Children {
        if (parentId == MediaItemFactory.RECENT_ROOT) {
            val snapshot = resume() ?: return Children.Items(emptyList(), stale = false)
            return Children.Items(if (page == 0) listOf(items.fromResume(snapshot)) else emptyList(), stale = false)
        }
        return when (val ref = MediaIds.parse(parentId)) {
            MediaRef.Root -> {
                staticPage(LibraryEntries.rootTabs(), page, pageSize)
            }

            is MediaRef.Tab -> {
                if (ref.tab == RootTab.LIBRARY) {
                    staticPage(LibraryEntries.libraryFolders(), page, pageSize)
                } else {
                    dynamic(pager.children(ref.tab.nodeId ?: return Children.NotFound, page, pageSize))
                }
            }

            is MediaRef.Folder -> {
                dynamic(pager.children(ref.folder.nodeId, page, pageSize))
            }

            is MediaRef.Node -> {
                dynamic(pager.children(ref.nodeId, page, pageSize, ref.playlistId))
            }

            is MediaRef.SearchQuery -> {
                search(ref.query, page, pageSize)
            }

            is MediaRef.Track, null -> {
                Children.NotFound
            }
        }
    }

    suspend fun search(
        query: String,
        page: Int,
        pageSize: Int,
    ): Children {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) {
            return Children.Items(emptyList(), stale = false)
        }
        return dynamic(pager.search(trimmed.take(MAX_QUERY), page, pageSize))
    }

    suspend fun item(mediaId: String): MediaItem? {
        if (mediaId == MediaIds.ROOT) {
            return items.root()
        }
        if (mediaId == MediaItemFactory.RECENT_ROOT) {
            return items.recentRoot()
        }
        val ref = MediaIds.parse(mediaId) ?: return null
        pager.find(mediaId)?.let { return items.fromEntry(it) }
        return when (ref) {
            MediaRef.Root -> {
                items.root()
            }

            is MediaRef.Tab -> {
                LibraryEntries.rootTabs().firstOrNull { it.mediaId == mediaId }?.let { items.fromEntry(it) }
            }

            is MediaRef.Folder -> {
                LibraryEntries.libraryFolders().firstOrNull { it.mediaId == mediaId }?.let { items.fromEntry(it) }
            }

            is MediaRef.Track -> {
                val snapshot = resume()
                if (snapshot != null && snapshot.videoId == ref.videoId) items.fromResume(snapshot) else items.placeholder(mediaId, "Track")
            }

            is MediaRef.Node, is MediaRef.SearchQuery -> {
                null
            }
        }
    }

    suspend fun resolveForPlayback(requested: MediaItem): MediaItem? {
        val ref = MediaIds.parse(requested.mediaId)
        if (ref is MediaRef.Track || (ref is MediaRef.Node && ref.playlistId != null)) {
            return pager.find(requested.mediaId)?.let { items.fromEntry(it) } ?: requested
        }
        val query = requested.requestMetadata.searchQuery?.trim()
        if (query == null) {
            return null
        }
        if (query.isEmpty()) {
            resume()?.let { return items.fromResume(it) }
            val home = pager.children(RootTab.HOME.nodeId ?: "home", 0, BrowsePager.MAX_PAGE_SIZE)
            return (home as? ChildrenResult.Loaded)?.entries?.let(::firstPlayable)?.let { items.fromEntry(it) }
        }
        val results = pager.search(query.take(MAX_QUERY), 0, BrowsePager.MAX_PAGE_SIZE)
        return (results as? ChildrenResult.Loaded)?.entries?.let(::firstPlayable)?.let { items.fromEntry(it) }
    }

    fun invalidateAll() {
        pager.clear()
    }

    private fun firstPlayable(entries: List<LibraryEntry>): LibraryEntry? =
        entries.firstOrNull { it.playable && it.kind == EntryKind.SONG }
            ?: entries.firstOrNull { it.playable }

    private fun staticPage(
        entries: List<LibraryEntry>,
        page: Int,
        pageSize: Int,
    ): Children {
        val size = pageSize.coerceIn(1, BrowsePager.MAX_PAGE_SIZE)
        val from = page.coerceAtLeast(0) * size
        val slice = if (from >= entries.size) emptyList() else entries.subList(from, minOf(entries.size, from + size))
        return Children.Items(slice.map { items.fromEntry(it) }, stale = false)
    }

    private fun dynamic(result: ChildrenResult): Children =
        when (result) {
            is ChildrenResult.Loaded -> Children.Items(result.entries.map { items.fromEntry(it) }, result.stale)
            is ChildrenResult.Failed -> Children.Error(result.failure)
        }

    private companion object {
        const val MAX_QUERY = 200
    }
}
