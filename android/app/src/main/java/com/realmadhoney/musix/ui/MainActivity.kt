package com.realmadhoney.musix.ui

import android.app.SearchManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.provider.MediaStore
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.media3.common.util.UnstableApi
import com.realmadhoney.musix.BuildConfig
import com.realmadhoney.musix.R
import com.realmadhoney.musix.core.browse.MediaIds
import com.realmadhoney.musix.core.browse.MediaRef
import com.realmadhoney.musix.engine.AccountState
import com.realmadhoney.musix.engine.WebEngine
import com.realmadhoney.musix.platform.PlatformInfo
import com.realmadhoney.musix.ui.screens.EngineBanner
import com.realmadhoney.musix.ui.screens.FolderScreen
import com.realmadhoney.musix.ui.screens.MiniPlayer
import com.realmadhoney.musix.ui.screens.NowPlayingScreen
import com.realmadhoney.musix.ui.screens.PlayerActions
import com.realmadhoney.musix.ui.screens.SaveToPlaylistDialog
import com.realmadhoney.musix.ui.screens.SearchScreen
import com.realmadhoney.musix.ui.screens.SettingsScreen
import com.realmadhoney.musix.ui.screens.ShellTab
import com.realmadhoney.musix.ui.screens.ShellTabBar
import com.realmadhoney.musix.ui.screens.ShellTopBar
import com.realmadhoney.musix.ui.screens.SignInScreen
import com.realmadhoney.musix.ui.screens.WebContent
import com.realmadhoney.musix.ui.theme.Musix
import com.realmadhoney.musix.ui.theme.MusixTheme
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.launch

@UnstableApi
class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.graph.engine
                    .filterNotNull()
                    .flatMapLatest { it.externalLinks }
                    .collect { openExternal(it) }
            }
        }
        setContent {
            MusixTheme(dark = true) {
                MusixApp(viewModel)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        when (intent?.action) {
            ACTION_SIGN_IN -> {
                viewModel.navigate(Route.SignIn)
            }

            MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH -> {
                viewModel.playFromSearch(intent.getStringExtra(SearchManager.QUERY).orEmpty())
            }
        }
    }

    private fun openExternal(url: String) {
        val uri = url.toUri()
        if (uri.scheme != "https" && uri.scheme != "http") {
            viewModel.graph.postMessage(getString(R.string.link_blocked))
            return
        }
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (error: ActivityNotFoundException) {
            viewModel.graph.postMessage(getString(R.string.link_open_failed))
        }
    }

    companion object {
        const val ACTION_SIGN_IN = "com.realmadhoney.musix.action.SIGN_IN"
    }
}

@UnstableApi
@Composable
fun MusixApp(viewModel: MainViewModel) {
    val routes by viewModel.routes.collectAsState()
    val route = routes.lastOrNull() ?: Route.Home
    val nowPlaying by viewModel.connection.nowPlaying.collectAsState()
    val connected by viewModel.connection.connected.collectAsState()
    val account by viewModel.account.collectAsState()
    val engine by viewModel.graph.engine.collectAsState()
    val query by viewModel.query.collectAsState()
    val adSkip by viewModel.graph.settings.adSkip
        .collectAsState(initial = true)
    viewModel.listVersion.collectAsState().value
    val engineStatus = engine?.status?.collectAsState()?.value
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val restrictions = remember { PlatformInfo.drivingRestrictions(context) }
    val restricted by restrictions.restricted.collectAsState()
    androidx.compose.runtime.DisposableEffect(restrictions) { onDispose { restrictions.release() } }

    LaunchedEffect(Unit) {
        merge(viewModel.connection.messages, viewModel.graph.messages).collect { snackbar.showSnackbar(it) }
    }
    var shellTab by rememberSaveable { mutableStateOf(ShellTab.Home) }
    var webQuery by rememberSaveable { mutableStateOf("") }
    val webBack = engine?.canNavigateBack?.collectAsState()?.value ?: false
    BackHandler(enabled = routes.size > 1) { viewModel.back() }
    BackHandler(enabled = routes.size <= 1 && shellTab == ShellTab.Search) { shellTab = ShellTab.Home }
    BackHandler(enabled = routes.size <= 1 && shellTab != ShellTab.Search && webBack) { engine?.goBack() }
    val selectShell: (ShellTab) -> Unit = { next ->
        when (next) {
            ShellTab.Settings -> {
                viewModel.navigate(Route.Settings)
            }

            ShellTab.Search -> {
                shellTab = ShellTab.Search
            }

            else -> {
                shellTab = next
                next.route?.let { target -> engine?.navigate(target) }
            }
        }
    }

    val actions =
        remember(viewModel) {
            object : PlayerActions {
                override fun togglePlay() = viewModel.connection.togglePlay()

                override fun next() = viewModel.connection.next()

                override fun previous() = viewModel.connection.previous()

                override fun seekTo(positionMs: Long) = viewModel.connection.seekTo(positionMs)

                override fun toggleLike() = viewModel.connection.toggleLike()

                override fun toggleShuffle() = viewModel.connection.toggleShuffle()

                override fun cycleRepeat() = viewModel.connection.cycleRepeat()

                override fun retry() = viewModel.connection.retry()

                override fun saveToPlaylist() = viewModel.openSaveToPlaylist()
            }
        }
    val open: (BrowseEntry) -> Unit = { entry ->
        when {
            entry.browsable -> {
                val playable = (MediaIds.parse(entry.mediaId) as? MediaRef.Node)?.playlistId != null
                viewModel.navigate(Route.Folder(entry.mediaId, entry.title, playable))
            }

            entry.playable -> {
                viewModel.connection.play(entry.mediaId)
            }
        }
    }
    val signIn = { viewModel.navigate(Route.SignIn) }
    val retryEngine: () -> Unit = { engine?.reload() }
    val cacheDone = stringResource(R.string.settings_cache_done)

    Box(
        Modifier
            .fillMaxSize()
            .background(Musix.colors.bg)
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f)) {
                when (val current = route) {
                    Route.Home -> {
                        val current = engine
                        Column(Modifier.fillMaxSize()) {
                            ShellTopBar(
                                searching = shellTab == ShellTab.Search,
                                query = webQuery,
                                canGoBack = webBack,
                                signedIn = account is AccountState.SignedIn,
                                onQueryChange = { webQuery = it },
                                onSubmit = { engine?.search(webQuery) },
                                onBack = { engine?.goBack() },
                                onSearch = { selectShell(ShellTab.Search) },
                                onAccount = { viewModel.navigate(Route.Settings) },
                                onSignIn = signIn,
                            )
                            EngineBanner(engineStatus, retryEngine)
                            if (current == null) {
                                Box(Modifier.weight(1f).fillMaxWidth())
                            } else {
                                WebContent(current, Modifier.weight(1f))
                            }
                        }
                    }

                    is Route.Folder -> {
                        val collectionId = (MediaIds.parse(current.mediaId) as? MediaRef.Node)?.playlistId
                        FolderScreen(
                            title = current.title,
                            playable = current.playable,
                            connected = connected,
                            list = viewModel.list(current.mediaId),
                            onBack = { viewModel.back() },
                            onPlayAll = { viewModel.connection.play(current.mediaId) },
                            onOpen = open,
                            onSignIn = signIn,
                            onSaveToLibrary =
                                collectionId?.let { id ->
                                    { save: Boolean -> viewModel.saveCollection(id, save, current.title) }
                                },
                        )
                    }

                    Route.Search -> {
                        SearchScreen(
                            initialQuery = query,
                            connected = connected,
                            listFor = viewModel::searchList,
                            onQueryChange = viewModel::setQuery,
                            onBack = { viewModel.back() },
                            onOpen = open,
                            onSignIn = signIn,
                        )
                    }

                    Route.NowPlaying -> {
                        NowPlayingScreen(nowPlaying, actions, onClose = { viewModel.back() })
                    }

                    Route.SignIn -> {
                        SignInScreen(
                            engine = engine,
                            account = account,
                            drivingRestricted = restricted,
                            onDone = { viewModel.back() },
                        )
                    }

                    Route.Settings -> {
                        SettingsScreen(
                            account = account,
                            adSkip = adSkip,
                            blockedRequests = engine?.blockedRequests ?: 0L,
                            versionName = BuildConfig.VERSION_NAME,
                            onBack = { viewModel.back() },
                            onSignIn = signIn,
                            onSignOut = { scope.launch { signOut(engine, viewModel) } },
                            onAdSkip = { enabled -> scope.launch { viewModel.graph.settings.setAdSkip(enabled) } },
                            onClearCache = {
                                viewModel.graph.clearCaches()
                                viewModel.refreshAll()
                                viewModel.graph.postMessage(cacheDone)
                            },
                        )
                    }
                }
            }
            if (route != Route.NowPlaying && route != Route.SignIn) {
                MiniPlayer(nowPlaying, actions, onOpen = { viewModel.navigate(Route.NowPlaying) })
            }
            if (route == Route.Home) {
                ShellTabBar(shellTab, selectShell)
            }
        }
        SnackbarHost(snackbar, modifier = Modifier.align(Alignment.BottomCenter))
    }
    val targets by viewModel.saveTargets.collectAsState()
    targets?.let { current ->
        SaveToPlaylistDialog(
            targets = current,
            onPick = viewModel::saveTo,
            onRetry = viewModel::openSaveToPlaylist,
            onDismiss = viewModel::closeSaveToPlaylist,
        )
    }
}

@UnstableApi
private suspend fun signOut(
    engine: WebEngine?,
    viewModel: MainViewModel,
) {
    if (engine == null) {
        viewModel.graph.postMessage(viewModel.getApplication<android.app.Application>().getString(R.string.signin_unavailable))
        return
    }
    engine.signOut()
    viewModel.graph.pager.clear()
    viewModel.graph.settings.clearResume()
    viewModel.refreshAll()
    viewModel.graph.postMessage(viewModel.getApplication<android.app.Application>().getString(R.string.settings_sign_out_done))
}
