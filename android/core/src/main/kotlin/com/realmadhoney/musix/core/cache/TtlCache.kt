package com.realmadhoney.musix.core.cache

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.File
import java.io.IOException
import java.security.MessageDigest

data class Stamped<V>(
    val value: V,
    val storedAt: Long,
)

interface DiskStore<V> {
    fun read(key: String): Stamped<V>?

    fun write(
        key: String,
        entry: Stamped<V>,
    )

    fun delete(key: String)

    fun clear()
}

class TtlCache<V>(
    private val ttlMs: Long,
    private val clock: () -> Long,
    private val maxEntries: Int = 64,
    private val disk: DiskStore<V>? = null,
) {
    private val memory = LinkedHashMap<String, Stamped<V>>(16, 0.75f, true)

    fun getFresh(key: String): V? {
        val entry = lookup(key) ?: return null
        return if (clock() - entry.storedAt <= ttlMs) entry.value else null
    }

    fun getAny(key: String): V? = lookup(key)?.value

    fun put(
        key: String,
        value: V,
    ) {
        val entry = Stamped(value, clock())
        synchronized(memory) {
            memory[key] = entry
            trim()
        }
        disk?.write(key, entry)
    }

    fun cachedValues(): List<V> = synchronized(memory) { memory.values.map { it.value } }

    fun invalidate(key: String) {
        synchronized(memory) { memory.remove(key) }
        disk?.delete(key)
    }

    fun clear() {
        synchronized(memory) { memory.clear() }
        disk?.clear()
    }

    private fun lookup(key: String): Stamped<V>? {
        val cached = synchronized(memory) { memory[key] }
        if (cached != null) {
            return cached
        }
        val stored = disk?.read(key) ?: return null
        synchronized(memory) {
            memory[key] = stored
            trim()
        }
        return stored
    }

    private fun trim() {
        while (memory.size > maxEntries) {
            val eldest = memory.keys.firstOrNull() ?: return
            memory.remove(eldest)
        }
    }
}

@Serializable
private data class StoredEntry(
    val key: String,
    val storedAt: Long,
    val body: String,
)

class JsonFileStore<V>(
    private val directory: File,
    private val serializer: KSerializer<V>,
    private val maxFiles: Int = 200,
    private val json: Json = Json { ignoreUnknownKeys = true },
    private val onError: (String, Throwable) -> Unit = { _, _ -> },
) : DiskStore<V> {
    override fun read(key: String): Stamped<V>? {
        val file = fileFor(key)
        if (!file.isFile) {
            return null
        }
        return try {
            val stored = json.decodeFromString(StoredEntry.serializer(), file.readText())
            if (stored.key != key) {
                null
            } else {
                Stamped(json.decodeFromString(serializer, stored.body), stored.storedAt)
            }
        } catch (error: IOException) {
            onError("read $key", error)
            null
        } catch (error: SerializationException) {
            onError("decode $key", error)
            file.delete()
            null
        } catch (error: IllegalArgumentException) {
            onError("decode $key", error)
            file.delete()
            null
        }
    }

    override fun write(
        key: String,
        entry: Stamped<V>,
    ) {
        try {
            if (!directory.isDirectory && !directory.mkdirs()) {
                onError("mkdir", IOException("Could not create ${directory.path}"))
                return
            }
            val body = json.encodeToString(serializer, entry.value)
            val text = json.encodeToString(StoredEntry.serializer(), StoredEntry(key, entry.storedAt, body))
            val target = fileFor(key)
            val temp = File(directory, "${target.name}.tmp")
            temp.writeText(text)
            if (!temp.renameTo(target)) {
                target.delete()
                if (!temp.renameTo(target)) {
                    temp.delete()
                    onError("write $key", IOException("Could not replace ${target.path}"))
                    return
                }
            }
            prune()
        } catch (error: IOException) {
            onError("write $key", error)
        } catch (error: SerializationException) {
            onError("encode $key", error)
        }
    }

    override fun delete(key: String) {
        fileFor(key).delete()
    }

    override fun clear() {
        directory.listFiles()?.forEach { it.delete() }
    }

    private fun prune() {
        val files = directory.listFiles { file -> file.name.endsWith(".json") } ?: return
        if (files.size <= maxFiles) {
            return
        }
        files.sortedBy { it.lastModified() }.take(files.size - maxFiles).forEach { it.delete() }
    }

    private fun fileFor(key: String): File {
        val digest = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8))
        val name = digest.joinToString("") { "%02x".format(it) }
        return File(directory, "$name.json")
    }
}
