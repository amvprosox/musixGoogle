package com.realmadhoney.musix.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.util.UnstableApi
import com.realmadhoney.musix.AppGraph
import com.realmadhoney.musix.MusixApplication
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
