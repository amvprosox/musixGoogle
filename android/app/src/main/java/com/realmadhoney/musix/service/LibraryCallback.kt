package com.realmadhoney.musix.service

import android.app.PendingIntent
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSession.MediaItemsWithStartPosition
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.realmadhoney.musix.core.bridge.CommandResult
import com.realmadhoney.musix.core.browse.LoadFailure
import com.realmadhoney.musix.core.resume.ResumeSnapshot
import com.realmadhoney.musix.player.MediaItemFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.guava.future

@UnstableApi
class LibraryCallback(
    private val resolver: LibraryResolver,
    private val items: MediaItemFactory,
    private val scope: CoroutineScope,
    private val signInIntent: PendingIntent,
    private val resume: suspend () -> ResumeSnapshot?,
    private val customCommand: suspend (String) -> CommandResult,
) : MediaLibrarySession.Callback {
    override fun onConnect(
        session: MediaSession,
        controller: MediaSession.ControllerInfo,
    ): MediaSession.ConnectionResult {
        val commands =
            MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS
                .buildUpon()
                .apply { MusixCommands.all.forEach { add(it) } }
                .build()
        return MediaSession.ConnectionResult
            .AcceptedResultBuilder(session)
            .setAvailableSessionCommands(commands)
            .build()
    }

    override fun onGetLibraryRoot(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<MediaItem>> {
        val rootParams = LibraryParams.Builder().setExtras(items.rootExtras()).build()
        val root = if (params?.isRecent == true) items.recentRoot() else items.root()
        return Futures.immediateFuture(LibraryResult.ofItem(root, rootParams))
    }

    override fun onGetItem(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> =
        scope.future {
            val item = resolver.item(mediaId)
            if (item == null) {
                LibraryResult.ofError(SessionError(SessionError.ERROR_BAD_VALUE, "Unknown item"))
            } else {
                LibraryResult.ofItem(item, null)
            }
        }

    override fun onGetChildren(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        parentId: String,
        page: Int,
        pageSize: Int,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
        scope.future { toResult(resolver.children(parentId, page, pageSize), params) }

    override fun onSearch(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        query: String,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<Void>> =
        scope.future {
            when (val result = resolver.search(query, 0, PAGE_SIZE)) {
                is Children.Items -> {
                    session.notifySearchResultChanged(browser, query, result.items.size, params)
                    LibraryResult.ofVoid()
                }

                is Children.Error -> {
                    LibraryResult.ofError(errorFor(result.failure))
                }

                Children.NotFound -> {
                    LibraryResult.ofError(SessionError(SessionError.ERROR_BAD_VALUE, "Search is unavailable"))
                }
            }
        }

    override fun onGetSearchResult(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        query: String,
        page: Int,
        pageSize: Int,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = scope.future { toResult(resolver.search(query, page, pageSize), params) }

    override fun onSetMediaItems(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
        mediaItems: MutableList<MediaItem>,
        startIndex: Int,
        startPositionMs: Long,
    ): ListenableFuture<MediaItemsWithStartPosition> =
        scope.future {
            val resolved = mediaItems.mapNotNull { resolver.resolveForPlayback(it) }
            if (resolved.isEmpty()) {
                throw UnsupportedOperationException("Nothing playable matched the request")
            }
            MediaItemsWithStartPosition(resolved, startIndex.coerceIn(0, resolved.size - 1), startPositionMs)
        }

    override fun onAddMediaItems(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
        mediaItems: MutableList<MediaItem>,
    ): ListenableFuture<MutableList<MediaItem>> =
        scope.future {
            val resolved = mediaItems.mapNotNull { resolver.resolveForPlayback(it) }
            if (resolved.isEmpty()) {
                throw UnsupportedOperationException("Nothing playable matched the request")
            }
            resolved.toMutableList()
        }

    override fun onCustomCommand(
        session: MediaSession,
        controller: MediaSession.ControllerInfo,
        customCommand: SessionCommand,
        args: Bundle,
    ): ListenableFuture<SessionResult> =
        scope.future {
            when (val result = customCommand(customCommand.customAction)) {
                CommandResult.Acknowledged, is CommandResult.Page, is CommandResult.LyricsFound, is CommandResult.Suggested -> {
                    SessionResult(SessionResult.RESULT_SUCCESS)
                }

                CommandResult.NotReady -> {
                    SessionResult(SessionError(SessionError.ERROR_INVALID_STATE, "YouTube Music is still loading"))
                }

                CommandResult.TimedOut -> {
                    SessionResult(SessionError(SessionError.ERROR_UNKNOWN, "YouTube Music did not respond"))
                }

                is CommandResult.Failed -> {
                    SessionResult(SessionError(SessionError.ERROR_UNKNOWN, result.message))
                }
            }
        }

    override fun onPlaybackResumption(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
        isForPlayback: Boolean,
    ): ListenableFuture<MediaItemsWithStartPosition> =
        scope.future {
            val snapshot = resume() ?: throw UnsupportedOperationException("Nothing to resume")
            MediaItemsWithStartPosition(listOf(items.fromResume(snapshot)), 0, snapshot.positionMs)
        }

    private fun toResult(
        children: Children,
        params: LibraryParams?,
    ): LibraryResult<ImmutableList<MediaItem>> =
        when (children) {
            is Children.Items -> LibraryResult.ofItemList(children.items, params)
            is Children.Error -> LibraryResult.ofError(errorFor(children.failure))
            Children.NotFound -> LibraryResult.ofError(SessionError(SessionError.ERROR_BAD_VALUE, "This folder no longer exists"))
        }

    fun errorFor(failure: LoadFailure): SessionError =
        when (failure) {
            LoadFailure.SignedOut -> {
                SessionError(
                    SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED,
                    SIGNED_OUT_MESSAGE,
                    Bundle().apply {
                        putParcelable(MediaConstants.EXTRAS_KEY_ERROR_RESOLUTION_ACTION_INTENT_COMPAT, signInIntent)
                        putString(MediaConstants.EXTRAS_KEY_ERROR_RESOLUTION_ACTION_LABEL_COMPAT, "Sign in")
                    },
                )
            }

            LoadFailure.Offline -> {
                SessionError(SessionError.ERROR_IO, OFFLINE_MESSAGE)
            }

            LoadFailure.TimedOut -> {
                SessionError(SessionError.ERROR_UNKNOWN, "YouTube Music took too long to respond. Try again.")
            }

            LoadFailure.NotReady -> {
                SessionError(SessionError.ERROR_INVALID_STATE, "YouTube Music is still loading. Try again in a moment.")
            }

            is LoadFailure.Error -> {
                SessionError(SessionError.ERROR_UNKNOWN, failure.message)
            }
        }

    companion object {
        const val PAGE_SIZE = 50
        const val SIGNED_OUT_MESSAGE = "Sign in to YouTube Music in the Musix app to see your library."
        const val OFFLINE_MESSAGE = "You're offline. Connect to the internet to browse YouTube Music."
    }
}
