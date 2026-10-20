package com.realmadhoney.musix.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStoreFile
import com.realmadhoney.musix.core.resume.ResumeSnapshot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.IOException

class SettingsRepository(
    context: Context,
    scope: CoroutineScope,
    fileName: String = "musix_settings",
) {
    private val store: DataStore<Preferences> =
        PreferenceDataStoreFactory.create(
            corruptionHandler = ReplaceFileCorruptionHandler { emptyPreferences() },
            scope = scope,
            produceFile = { context.preferencesDataStoreFile(fileName) },
        )

    private val safeData: Flow<Preferences> =
        store.data.catch { error ->
            if (error is IOException) emit(emptyPreferences()) else throw error
        }

    val adSkip: Flow<Boolean> = safeData.map { it[AD_SKIP] ?: true }.distinctUntilChanged()

    val resume: Flow<ResumeSnapshot?> = safeData.map { ResumeSnapshot.decode(it[RESUME]) }.distinctUntilChanged()

    suspend fun setAdSkip(enabled: Boolean) {
        store.edit { it[AD_SKIP] = enabled }
    }

    suspend fun saveResume(snapshot: ResumeSnapshot) {
        store.edit { it[RESUME] = ResumeSnapshot.encode(snapshot) }
    }

    suspend fun clearResume() {
        store.edit { it.remove(RESUME) }
    }

    suspend fun currentResume(): ResumeSnapshot? = resume.first()

    suspend fun currentAdSkip(): Boolean = adSkip.first()

    private companion object {
        val AD_SKIP = booleanPreferencesKey("ad_skip")
        val RESUME = stringPreferencesKey("resume_snapshot")
    }
}
