package com.realmadhoney.musix.artwork

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import com.realmadhoney.musix.MusixApplication
import java.io.FileNotFoundException

class ArtworkProvider : ContentProvider() {
    private fun store(): ArtworkStore? = (context?.applicationContext as? MusixApplication)?.graph?.artwork

    override fun onCreate(): Boolean = true

    override fun openFile(
        uri: Uri,
        mode: String,
    ): ParcelFileDescriptor {
        if (mode != "r") {
            throw SecurityException("Artwork is read-only")
        }
        val artwork = store() ?: throw FileNotFoundException("Artwork store unavailable")
        val file = artwork.fileFor(uri) ?: throw FileNotFoundException("No artwork for $uri")
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun getType(uri: Uri): String? = if (store()?.remoteUrlFor(uri) != null) "image/*" else null

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? {
        val artwork = store() ?: return null
        if (artwork.remoteUrlFor(uri) == null) {
            return null
        }
        val columns = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME)
        val cursor = MatrixCursor(columns)
        cursor.addRow(
            columns.map { column ->
                when (column) {
                    OpenableColumns.DISPLAY_NAME -> "artwork"
                    OpenableColumns.SIZE -> null
                    else -> null
                }
            },
        )
        return cursor
    }

    override fun insert(
        uri: Uri,
        values: ContentValues?,
    ): Uri? = throw UnsupportedOperationException("Artwork is read-only")

    override fun delete(
        uri: Uri,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = throw UnsupportedOperationException("Artwork is read-only")

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = throw UnsupportedOperationException("Artwork is read-only")
}
