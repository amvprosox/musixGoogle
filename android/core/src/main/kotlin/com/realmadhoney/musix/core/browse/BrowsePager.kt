package com.realmadhoney.musix.core.browse

import com.realmadhoney.musix.core.bridge.BrowsePage
import com.realmadhoney.musix.core.bridge.ContinuationKind
import com.realmadhoney.musix.core.cache.TtlCache
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable

sealed interface LoadFailure {
    data object SignedOut : LoadFailure

    data object Offline : LoadFailure

    data object TimedOut : LoadFailure

    data object NotReady : LoadFailure

    data class Error(
        val message: String,
    ) : LoadFailure
}

sealed interface PageLoad {
    data class Loaded(
        val page: BrowsePage,
    ) : PageLoad

    data class Failed(
        val failure: LoadFailure,
    ) : PageLoad
}

interface PageSource {
    suspend fun browse(nodeId: String): PageLoad

    suspend fun search(query: String): PageLoad

    suspend fun more(
        nodeId: String,
        token: String,
        kind: ContinuationKind,
    ): PageLoad
}

@Serializable
data class NodeSnapshot(
    val nodeId: String,
    val title: String,
    val entries: List<LibraryEntry>,
    val continuation: String?,
)

sealed interface ChildrenResult {
    data class Loaded(
        val title: String,
        val entries: List<LibraryEntry>,
        val stale: Boolean,
    ) : ChildrenResult

    data class Failed(
        val failure: LoadFailure,
    ) : ChildrenResult
}

class BrowsePager(
    private val source: PageSource,
    private val cache: TtlCache<NodeSnapshot>,
) {
    private val locks = HashMap<String, Mutex>()

    suspend fun children(
        nodeId: String,
        page: Int,
        pageSize: Int,
        contextPlaylistId: String? = null,
    ): ChildrenResult {
        val safePage = page.coerceAtLeast(0)
        val size = pageSize.coerceIn(1, MAX_PAGE_SIZE)
        val needed = (safePage.toLong() + 1L) * size.toLong()
        return lockFor(nodeId).withLock {
            val fresh = cache.getFresh(nodeId)
            var snapshot =
                fresh ?: when (val load = loadFirst(nodeId)) {
                    is PageLoad.Loaded -> {
                        toSnapshot(nodeId, load.page, contextPlaylistId).also { cache.put(nodeId, it) }
                    }

                    is PageLoad.Failed -> {
                        val stale = cache.getAny(nodeId)
                        return@withLock if (stale != null && load.failure != LoadFailure.SignedOut) {
                            ChildrenResult.Loaded(stale.title, slice(stale.entries, safePage, size), stale = true)
                        } else {
                            ChildrenResult.Failed(load.failure)
                        }
                    }
                }
            var guard = 0
            while (snapshot.entries.size < needed && guard < MAX_CONTINUATIONS) {
                val token = snapshot.continuation ?: break
                guard += 1
                when (val more = source.more(nodeId, token, kindFor(nodeId))) {
                    is PageLoad.Loaded -> {
                        val extra = entriesOf(more.page, contextPlaylistId)
                        val seen = snapshot.entries.mapTo(HashSet()) { it.mediaId }
                        snapshot =
                            snapshot.copy(
                                entries = snapshot.entries + extra.filter { seen.add(it.mediaId) },
                                continuation = more.page.continuation?.takeIf { it != token },
                            )
                        cache.put(nodeId, snapshot)
                    }

                    is PageLoad.Failed -> {
                        if (snapshot.entries.size <= safePage * size) {
                            return@withLock ChildrenResult.Failed(more.failure)
                        }
                        break
                    }
                }
            }
            ChildrenResult.Loaded(snapshot.title, slice(snapshot.entries, safePage, size), stale = false)
        }
    }

    suspend fun search(
        query: String,
        page: Int,
        pageSize: Int,
    ): ChildrenResult = children(searchNodeId(query), page, pageSize)

    fun find(mediaId: String): LibraryEntry? =
        cache.cachedValues().firstNotNullOfOrNull { snapshot -> snapshot.entries.firstOrNull { it.mediaId == mediaId } }

    fun invalidate(nodeId: String) {
        cache.invalidate(nodeId)
    }

    fun clear() {
        cache.clear()
    }

    private suspend fun loadFirst(nodeId: String): PageLoad {
        val query = queryOf(nodeId)
        return if (query != null) source.search(query) else source.browse(nodeId)
    }

    private fun toSnapshot(
        nodeId: String,
        page: BrowsePage,
        contextPlaylistId: String?,
    ): NodeSnapshot =
        NodeSnapshot(
            nodeId = nodeId,
            title = page.title,
            entries = entriesOf(page, contextPlaylistId).distinctBy { it.mediaId },
            continuation = page.continuation,
        )

    private fun entriesOf(
        page: BrowsePage,
        contextPlaylistId: String?,
    ): List<LibraryEntry> {
        val fromSections =
            page.sections.flatMap { section ->
                val group = section.title.takeIf { it.isNotBlank() }
                section.items.mapNotNull { LibraryEntries.fromItem(it, group, contextPlaylistId) }
            }
        val loose = page.items.mapNotNull { LibraryEntries.fromItem(it, null, contextPlaylistId) }
        return fromSections + loose
    }

    private fun slice(
        entries: List<LibraryEntry>,
        page: Int,
        size: Int,
    ): List<LibraryEntry> {
        val from = page.toLong() * size
        if (from >= entries.size) {
            return emptyList()
        }
        val to = minOf(entries.size.toLong(), from + size)
        return entries.subList(from.toInt(), to.toInt()).toList()
    }

    private fun lockFor(nodeId: String): Mutex = synchronized(locks) { locks.getOrPut(nodeId) { Mutex() } }

    companion object {
        const val MAX_PAGE_SIZE = 50
        private const val MAX_CONTINUATIONS = 20
        private const val SEARCH_PREFIX = "search:all:"

        fun searchNodeId(query: String): String = SEARCH_PREFIX + query.trim()

        fun queryOf(nodeId: String): String? = if (nodeId.startsWith(SEARCH_PREFIX)) nodeId.removePrefix(SEARCH_PREFIX) else null

        fun kindFor(nodeId: String): ContinuationKind =
            if (nodeId.startsWith("search:")) ContinuationKind.SEARCH else ContinuationKind.BROWSE
    }
}
