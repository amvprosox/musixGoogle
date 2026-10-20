package com.realmadhoney.musix.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.util.UnstableApi
import com.realmadhoney.musix.AppGraph
import com.realmadhoney.musix.MusixApplication
import com.realmadhoney.musix.core.bridge.BridgeCodec
import com.realmadhoney.musix.core.bridge.BridgeCommand
import com.realmadhoney.musix.core.bridge.CommandResult
import com.realmadhoney.musix.core.bridge.FlatItem
import com.realmadhoney.musix.core.browse.MediaIds
import com.realmadhoney.musix.core.browse.RootTab
import com.realmadhoney.musix.engine.AccountState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

sealed interface Route {
    data object Home : Route

    data class Folder(
        val mediaId: String,
        val title: String,
        val playable: Boolean,
    ) : Route

    data object Search : Route

    data object NowPlaying : Route

    data object SignIn : Route

    data object Settings : Route
}

sealed interface SaveTargets {
    data object Loading : SaveTargets

    data class Loaded(
        val videoId: String,
        val items: List<FlatItem>,
    ) : SaveTargets

    data class Failed(
        val message: String,
    ) : SaveTargets
}

data class ListState(
    val entries: List<BrowseEntry>,
    val loading: Boolean,
    val endReached: Boolean,
    val error: BrowseResult.Failed?,
    val started: Boolean,
) {
    companion object {
        val INITIAL = ListState(emptyList(), loading = false, endReached = false, error = null, started = false)
    }
}

class PagedList(
    private val scope: CoroutineScope,
    private val pageSize: Int,
    private val load: suspend (page: Int, size: Int) -> BrowseResult,
) {
    private val flow = MutableStateFlow(ListState.INITIAL)
    val state: StateFlow<ListState> = flow.asStateFlow()
    private var job: Job? = null
    private var nextPage = 0

    fun start() {
        if (!flow.value.started) {
            loadNext()
        }
    }

    fun loadMore() {
        val current = flow.value
        if (current.loading || current.endReached || current.error != null) {
            return
        }
        loadNext()
    }

    fun retry() {
        job?.cancel()
        nextPage = 0
        flow.value = ListState.INITIAL
        loadNext()
    }

    private fun loadNext() {
        val page = nextPage
        flow.value = flow.value.copy(loading = true, error = null, started = true)
        job =
            scope.launch {
                when (val result = load(page, pageSize)) {
                    is BrowseResult.Items -> {
                        nextPage = page + 1
                        val known = flow.value.entries.mapTo(HashSet()) { it.mediaId }
                        val fresh = result.entries.filter { known.add(it.mediaId) }
                        flow.value =
                            flow.value.copy(
                                entries = flow.value.entries + fresh,
                                loading = false,
                                endReached = result.entries.size < pageSize || fresh.isEmpty(),
                            )
                    }

                    is BrowseResult.Failed -> {
                        flow.value = flow.value.copy(loading = false, error = result)
                    }
                }
            }
    }
}

@UnstableApi
class MainViewModel(
    application: Application,
) : AndroidViewModel(application) {
    val graph: AppGraph = (application as MusixApplication).graph
    val connection = PlayerConnection(application, viewModelScope)

    private val stack = MutableStateFlow<List<Route>>(listOf(Route.Home))
    val routes: StateFlow<List<Route>> = stack.asStateFlow()

    private val tabFlow = MutableStateFlow(RootTab.HOME)
    val tab: StateFlow<RootTab> = tabFlow.asStateFlow()

    private val lists = HashMap<String, PagedList>()

    private val queryFlow = MutableStateFlow("")
    val query: StateFlow<String> = queryFlow.asStateFlow()

    val account: StateFlow<AccountState> = accountFlow()

    val listVersion = MutableStateFlow(0)

    init {
        connection.connect()
        viewModelScope.launch {
            connection.connected.collect { isConnected ->
                val query = pendingSearch
                if (isConnected && query != null) {
                    pendingSearch = null
                    connection.playFromSearch(query)
                }
            }
        }
        viewModelScope.launch {
            account.map { it::class }.distinctUntilChanged().collect {
                lists.clear()
                listVersion.value += 1
            }
        }
    }

    fun list(mediaId: String): PagedList =
        lists.getOrPut(mediaId) {
            PagedList(viewModelScope, PAGE_SIZE) { page, size -> connection.children(mediaId, page, size) }
        }

    fun searchList(query: String): PagedList =
        lists.getOrPut(MediaIds.search(query)) {
            PagedList(viewModelScope, PAGE_SIZE) { page, size -> connection.search(query, page, size) }
        }

    fun setQuery(value: String) {
        queryFlow.value = value.take(200)
    }

    fun selectTab(tab: RootTab) {
        tabFlow.value = tab
    }

    fun navigate(route: Route) {
        if (stack.value.lastOrNull() != route) {
            stack.value = stack.value + route
        }
    }

    fun back(): Boolean {
        val current = stack.value
        if (current.size <= 1) {
            return false
        }
        stack.value = current.dropLast(1)
        return true
    }

    private var pendingSearch: String? = null

    fun playFromSearch(query: String) {
        if (!connection.playFromSearch(query)) {
            pendingSearch = query
        }
    }

    private val targetsFlow = MutableStateFlow<SaveTargets?>(null)
    val saveTargets: StateFlow<SaveTargets?> = targetsFlow.asStateFlow()

    fun openSaveToPlaylist() {
        val engine = graph.engine.value
        val videoId =
            engine
                ?.bridgeState
                ?.value
                ?.videoId
                .orEmpty()
        if (engine == null || !BridgeCodec.isValidVideoId(videoId)) {
            graph.postMessage("Play a song first.")
            return
        }
        targetsFlow.value = SaveTargets.Loading
        viewModelScope.launch {
            val result = engine.queue.data { BridgeCommand.PlaylistTargets(it, videoId) }
            targetsFlow.value =
                when (result) {
                    is CommandResult.Page -> SaveTargets.Loaded(videoId, result.page.items.filter { it.playlistId != null })
                    else -> SaveTargets.Failed(describe(result))
                }
        }
    }

    fun closeSaveToPlaylist() {
        targetsFlow.value = null
    }

    fun saveTo(
        videoId: String,
        target: FlatItem,
    ) {
        val engine = graph.engine.value ?: return
        val playlistId = target.playlistId ?: return
        targetsFlow.value = null
        viewModelScope.launch {
            val result = engine.queue.data { BridgeCommand.AddToPlaylist(it, videoId, playlistId) }
            graph.postMessage(if (result == CommandResult.Acknowledged) "Saved to ${target.title}" else describe(result))
        }
    }

    fun saveCollection(
        playlistId: String,
        save: Boolean,
        title: String,
    ) {
        val engine = graph.engine.value
        if (engine == null) {
            graph.postMessage("YouTube Music is still loading. Try again in a moment.")
            return
        }
        viewModelScope.launch {
            val result = engine.queue.data { BridgeCommand.SavePlaylist(it, playlistId, save) }
            val message =
                when {
                    result != CommandResult.Acknowledged -> describe(result)
                    save -> "$title saved to your library"
                    else -> "$title removed from your library"
                }
            graph.postMessage(message)
            if (result == CommandResult.Acknowledged) {
                graph.pager.clear()
            }
        }
    }

    private fun describe(result: CommandResult): String =
        when (result) {
            is CommandResult.Failed -> result.message
            CommandResult.NotReady -> "YouTube Music is still loading. Try again in a moment."
            CommandResult.TimedOut -> "YouTube Music did not respond. Try again."
            CommandResult.Acknowledged, is CommandResult.Page -> "Done"
        }

    fun refreshAll() {
        lists.values.forEach { it.retry() }
    }

    override fun onCleared() {
        connection.release()
        super.onCleared()
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    private fun accountFlow(): StateFlow<AccountState> {
        val out = MutableStateFlow<AccountState>(AccountState.Unknown)
        viewModelScope.launch {
            graph.engine
                .filterNotNull()
                .flatMapLatest { it.account }
                .collect { out.value = it }
        }
        return out.asStateFlow()
    }

    companion object {
        const val PAGE_SIZE = 50
    }
}
