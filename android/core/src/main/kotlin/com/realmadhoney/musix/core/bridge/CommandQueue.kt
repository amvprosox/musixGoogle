package com.realmadhoney.musix.core.bridge

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

sealed interface CommandResult {
    data object Acknowledged : CommandResult

    data class Page(
        val page: BrowsePage,
    ) : CommandResult

    data class Failed(
        val code: BridgeErrorCode,
        val message: String,
    ) : CommandResult

    data object TimedOut : CommandResult

    data object NotReady : CommandResult
}

enum class CommandLane { PLAYER, DATA }

fun interface BridgeTransport {
    suspend fun deliver(json: String): Boolean
}

class CommandQueue(
    private val transport: BridgeTransport,
    private val timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    private val readyTimeoutMs: Long = DEFAULT_READY_TIMEOUT_MS,
) {
    private val ready = MutableStateFlow(false)
    private val pending = ConcurrentHashMap<String, CompletableDeferred<CommandResult>>()
    private val playerLock = Mutex()
    private val dataLock = Mutex()
    private val counter = AtomicLong(0)
    private val generation = AtomicLong(0)

    val isReady: StateFlow<Boolean> = ready.asStateFlow()

    fun markReady() {
        ready.value = true
    }

    fun markNotReady() {
        ready.value = false
        generation.incrementAndGet()
        val waiting = pending.values.toList()
        pending.clear()
        waiting.forEach { it.complete(CommandResult.NotReady) }
    }

    suspend fun player(build: (String) -> BridgeCommand): CommandResult = send(CommandLane.PLAYER, build)

    suspend fun data(build: (String) -> BridgeCommand): CommandResult = send(CommandLane.DATA, build)

    suspend fun send(
        lane: CommandLane,
        build: (String) -> BridgeCommand,
    ): CommandResult {
        val lock = if (lane == CommandLane.PLAYER) playerLock else dataLock
        return lock.withLock { dispatch(build) }
    }

    fun onEvent(event: BridgeEvent): Boolean =
        when (event) {
            is BridgeEvent.Ack -> {
                complete(event.requestId, CommandResult.Acknowledged)
            }

            is BridgeEvent.BrowseResult -> {
                complete(event.requestId, CommandResult.Page(event.page))
            }

            is BridgeEvent.SearchResult -> {
                complete(event.requestId, CommandResult.Page(event.page))
            }

            is BridgeEvent.Error -> {
                val id = event.requestId
                if (id == null) false else complete(id, CommandResult.Failed(event.code, event.message))
            }

            else -> {
                false
            }
        }

    fun pendingCount(): Int = pending.size

    private suspend fun dispatch(build: (String) -> BridgeCommand): CommandResult {
        val isUp = withTimeoutOrNull(readyTimeoutMs) { ready.first { it } }
        if (isUp == null) {
            return CommandResult.NotReady
        }
        val startedGeneration = generation.get()
        val requestId = "n${counter.incrementAndGet()}"
        val command = build(requestId)
        if (command.requestId != requestId) {
            return CommandResult.Failed(BridgeErrorCode.INVALID_COMMAND, "Command must use the assigned request id")
        }
        val payload =
            try {
                BridgeCodec.encodeCommand(command)
            } catch (error: IllegalArgumentException) {
                return CommandResult.Failed(BridgeErrorCode.INVALID_COMMAND, error.message ?: "Invalid command")
            }
        val deferred = CompletableDeferred<CommandResult>()
        pending[requestId] = deferred
        try {
            if (generation.get() != startedGeneration) {
                return CommandResult.NotReady
            }
            if (!transport.deliver(payload)) {
                return CommandResult.NotReady
            }
            return withTimeoutOrNull(timeoutMs) { deferred.await() } ?: CommandResult.TimedOut
        } finally {
            pending.remove(requestId)
        }
    }

    private fun complete(
        requestId: String,
        result: CommandResult,
    ): Boolean {
        val deferred = pending.remove(requestId) ?: return false
        return deferred.complete(result)
    }

    companion object {
        const val DEFAULT_TIMEOUT_MS = 5_000L
        const val DEFAULT_READY_TIMEOUT_MS = 20_000L
    }
}
