package com.realmadhoney.musix.core.offline

import kotlin.random.Random

class OfflineSession(
    queue: List<String>,
    startId: String,
    shuffle: Boolean,
    private val random: Random = Random.Default,
) {
    private var queueIds: List<String> = dedupe(if (startId in queue) queue else listOf(startId) + queue)
    private var order: MutableList<String>
    private var position: Int
    private val history = ArrayList<String>()
    var shuffle: Boolean = shuffle
        private set

    init {
        order = buildOrder(startId)
        position = order.indexOf(startId).coerceAtLeast(0)
    }

    val current: String?
        get() = order.getOrNull(position)

    val ids: List<String>
        get() = queueIds

    val upcoming: List<String>
        get() = order.drop(position + 1)

    fun next(repeatAll: Boolean): String? {
        val cur = current ?: return null
        if (position + 1 < order.size) {
            pushHistory(cur)
            position++
            return current
        }
        if (!repeatAll) {
            return null
        }
        pushHistory(cur)
        order =
            if (shuffle) {
                val rest = queueIds.shuffled(random).toMutableList()
                if (rest.size > 1 && rest.first() == cur) {
                    rest.add(rest.removeAt(0))
                }
                rest
            } else {
                queueIds.toMutableList()
            }
        position = 0
        return current
    }

    fun previous(repeatAll: Boolean): String? {
        while (history.isNotEmpty()) {
            val id = history.removeAt(history.size - 1)
            val idx = order.indexOf(id)
            if (idx >= 0) {
                position = idx
                return id
            }
        }
        if (position > 0) {
            position--
            return current
        }
        if (repeatAll && order.size > 1) {
            position = order.size - 1
            return current
        }
        return null
    }

    fun setShuffle(on: Boolean) {
        if (on == shuffle) {
            return
        }
        shuffle = on
        val cur = current
        if (cur == null) {
            order = if (on) queueIds.shuffled(random).toMutableList() else queueIds.toMutableList()
            position = 0
            return
        }
        order = buildOrder(cur)
        position = order.indexOf(cur).coerceAtLeast(0)
    }

    fun jumpTo(id: String): Boolean {
        val cur = current
        if (id == cur) {
            return true
        }
        if (id !in queueIds) {
            return false
        }
        if (cur != null) {
            pushHistory(cur)
        }
        val idx = order.indexOf(id)
        if (shuffle && idx >= 0) {
            order.removeAt(idx)
            val insertAt = minOf(position + 1, order.size)
            order.add(insertAt, id)
            position = insertAt
        } else {
            position = idx.coerceAtLeast(0)
        }
        return true
    }

    fun syncQueue(ids: List<String>) {
        val next = dedupe(ids)
        val keep = next.toHashSet()
        val cur = current
        queueIds = next
        history.retainAll { it in keep }
        if (!shuffle) {
            order = next.toMutableList()
            val idx = if (cur != null) order.indexOf(cur) else -1
            position = if (idx >= 0) idx else minOf(position, (order.size - 1).coerceAtLeast(0))
            return
        }
        val existing = order.toHashSet()
        val kept = order.filter { it in keep }
        val added = next.filter { it !in existing }
        val curIdx = if (cur != null) kept.indexOf(cur) else -1
        val head = if (curIdx >= 0) kept.subList(0, curIdx + 1) else emptyList()
        val rest = if (curIdx >= 0) kept.subList(curIdx + 1, kept.size) else kept
        order = (head + (rest + added).shuffled(random)).toMutableList()
        position = if (curIdx >= 0) curIdx else minOf(position, (order.size - 1).coerceAtLeast(0))
    }

    private fun buildOrder(startId: String): MutableList<String> {
        if (!shuffle) {
            return queueIds.toMutableList()
        }
        return (listOf(startId) + queueIds.filter { it != startId }.shuffled(random)).toMutableList()
    }

    private fun pushHistory(id: String) {
        history.add(id)
        if (history.size > MAX_HISTORY) {
            history.subList(0, history.size - MAX_HISTORY).clear()
        }
    }

    private companion object {
        const val MAX_HISTORY = 500

        fun dedupe(ids: List<String>): List<String> = ids.filter { it.isNotEmpty() }.distinct()
    }
}
