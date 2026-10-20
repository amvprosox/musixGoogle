package com.realmadhoney.musix.player

import android.content.ContentResolver
import android.net.Uri
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaConstants
import com.realmadhoney.musix.R
import com.realmadhoney.musix.core.browse.EntryKind
import com.realmadhoney.musix.core.browse.LibraryEntry
import com.realmadhoney.musix.core.browse.MediaIds
import com.realmadhoney.musix.core.browse.RootTab
import com.realmadhoney.musix.core.player.TrackSpec
import com.realmadhoney.musix.core.resume.ResumeSnapshot

@OptIn(UnstableApi::class)
class MediaItemFactory(
    private val packageName: String,
    private val artworkUri: (String) -> Uri?,
) {
    fun root(): MediaItem =
        MediaItem
            .Builder()
            .setMediaId(MediaIds.ROOT)
            .setMediaMetadata(
                MediaMetadata
                    .Builder()
                    .setTitle("Musix")
                    .setIsBrowsable(true)
                    .setIsPlayable(false)
                    .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
                    .setExtras(rootExtras())
                    .build(),
            ).build()

    fun recentRoot(): MediaItem =
        MediaItem
            .Builder()
            .setMediaId(RECENT_ROOT)
            .setMediaMetadata(
                MediaMetadata
                    .Builder()
                    .setTitle("Recently played")
                    .setIsBrowsable(true)
                    .setIsPlayable(false)
                    .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
                    .build(),
            ).build()

    fun rootExtras(): Bundle =
        Bundle().apply {
            putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE, MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM)
            putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE, MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM)
        }

    fun fromEntry(entry: LibraryEntry): MediaItem {
        val metadata =
            MediaMetadata
                .Builder()
                .setTitle(entry.title)
                .setDisplayTitle(entry.title)
                .setSubtitle(entry.subtitle.ifEmpty { null })
                .setIsBrowsable(entry.browsable)
                .setIsPlayable(entry.playable)
                .setMediaType(mediaTypeFor(entry.kind))
        if (entry.kind == EntryKind.SONG || entry.kind == EntryKind.VIDEO) {
            metadata.setArtist(entry.subtitle.substringBefore(" • ").ifEmpty { null })
        }
        entry.durationMs?.let { metadata.setDurationMs(it) }
        val artwork =
            when (entry.kind) {
                EntryKind.TAB -> tabIcon(entry.mediaId)
                EntryKind.FOLDER -> resourceUri(R.drawable.ic_library)
                else -> artworkUri(entry.artworkUrl)
            }
        metadata.setArtworkUri(artwork)
        val extras = Bundle()
        entry.groupTitle?.let { extras.putString(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_GROUP_TITLE, it) }
        if (entry.kind == EntryKind.TAB || entry.kind == EntryKind.FOLDER) {
            extras.putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE, MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM)
            extras.putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE, MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM)
        }
        if (!extras.isEmpty) {
            metadata.setExtras(extras)
        }
        return MediaItem
            .Builder()
            .setMediaId(entry.mediaId)
            .setMediaMetadata(metadata.build())
            .build()
    }

    fun fromTrack(track: TrackSpec): MediaItem {
        val metadata =
            MediaMetadata
                .Builder()
                .setTitle(track.title)
                .setDisplayTitle(track.title)
                .setArtist(track.artist.ifEmpty { null })
                .setAlbumTitle(track.album.ifEmpty { null })
                .setIsBrowsable(false)
                .setIsPlayable(true)
                .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
        if (track.isAd) {
            metadata.setArtworkUri(resourceUri(R.drawable.ic_music))
        } else {
            metadata.setArtworkUri(artworkUri(track.artworkUrl))
        }
        track.durationMs?.let { metadata.setDurationMs(it) }
        return MediaItem
            .Builder()
            .setMediaId(track.mediaId)
            .setMediaMetadata(metadata.build())
            .build()
    }

    fun fromResume(snapshot: ResumeSnapshot): MediaItem =
        MediaItem
            .Builder()
            .setMediaId(MediaIds.track(snapshot.videoId, snapshot.playlistId))
            .setMediaMetadata(
                MediaMetadata
                    .Builder()
                    .setTitle(snapshot.title)
                    .setArtist(snapshot.artist.ifEmpty { null })
                    .setAlbumTitle(snapshot.album.ifEmpty { null })
                    .setArtworkUri(artworkUri(snapshot.artworkUrl))
                    .setIsBrowsable(false)
                    .setIsPlayable(true)
                    .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
                    .apply { if (snapshot.durationSec > 0) setDurationMs((snapshot.durationSec * 1000).toLong()) }
                    .build(),
            ).build()

    fun placeholder(
        mediaId: String,
        title: String,
    ): MediaItem =
        MediaItem
            .Builder()
            .setMediaId(mediaId)
            .setMediaMetadata(
                MediaMetadata
                    .Builder()
                    .setTitle(title)
                    .setIsBrowsable(false)
                    .setIsPlayable(true)
                    .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
                    .build(),
            ).build()

    private fun tabIcon(mediaId: String): Uri {
        val res =
            when (mediaId) {
                MediaIds.tab(RootTab.HOME) -> R.drawable.ic_home
                MediaIds.tab(RootTab.LIBRARY) -> R.drawable.ic_library
                MediaIds.tab(RootTab.PLAYLISTS) -> R.drawable.ic_list_music
                else -> R.drawable.ic_history
            }
        return resourceUri(res)
    }

    private fun resourceUri(resId: Int): Uri =
        Uri
            .Builder()
            .scheme(ContentResolver.SCHEME_ANDROID_RESOURCE)
            .authority(packageName)
            .appendPath(resId.toString())
            .build()

    private fun mediaTypeFor(kind: EntryKind): Int =
        when (kind) {
            EntryKind.TAB, EntryKind.FOLDER, EntryKind.CATEGORY -> MediaMetadata.MEDIA_TYPE_FOLDER_MIXED
            EntryKind.SONG -> MediaMetadata.MEDIA_TYPE_MUSIC
            EntryKind.VIDEO -> MediaMetadata.MEDIA_TYPE_VIDEO
            EntryKind.ALBUM -> MediaMetadata.MEDIA_TYPE_ALBUM
            EntryKind.PLAYLIST -> MediaMetadata.MEDIA_TYPE_PLAYLIST
            EntryKind.ARTIST -> MediaMetadata.MEDIA_TYPE_ARTIST
        }

    companion object {
        const val RECENT_ROOT = "recent-root"
    }
}
