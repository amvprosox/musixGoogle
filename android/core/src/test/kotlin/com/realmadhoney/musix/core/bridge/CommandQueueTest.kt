package com.realmadhoney.musix.core.bridge

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CommandQueueTest {
    private class RecordingTransport : BridgeTransport {
        val sent = mutableListOf<String>()
        var accept = true

        override suspend fun deliver(json: String): Boolean {
            sent += json
            return accept
        }
    }

    private fun requestIdOf(json: String): String =
        Regex("\"requestId\":\"([^\"]+)\"")
            .find(json)
            ?.groupValues
            ?.get(1)
            .orEmpty()

    @Test
    fun waitsForTheReadyGateBeforeSending() =
        runTest {
            val transport = RecordingTransport()
            val queue = CommandQueue(transport)
            val result = async { queue.player { BridgeCommand.Play(it) } }
            runCurrent()
            assertThat(transport.sent).isEmpty()
            queue.markReady()
            runCurrent()
            assertThat(transport.sent).hasSize(1)
            queue.onEvent(BridgeEvent.Ack(1, requestIdOf(transport.sent[0])))
            assertThat(result.await()).isEqualTo(CommandResult.Acknowledged)
        }

    @Test
    fun reportsNotReadyWhenThePageNeverBecomesReady() =
        runTest {
            val queue = CommandQueue(RecordingTransport(), readyTimeoutMs = 1_000)
            val result = async { queue.player { BridgeCommand.Pause(it) } }
            advanceTimeBy(1_001)
            assertThat(result.await()).isEqualTo(CommandResult.NotReady)
        }

    @Test
    fun timesOutAfterFiveSecondsWithoutAnAck() =
        runTest {
            val transport = RecordingTransport()
            val queue = CommandQueue(transport)
            queue.markReady()
            val result = async { queue.player { BridgeCommand.Next(it) } }
            advanceTimeBy(4_999)
            runCurrent()
            assertThat(result.isCompleted).isFalse()
            advanceTimeBy(2)
            assertThat(result.await()).isEqualTo(CommandResult.TimedOut)
            assertThat(queue.pendingCount()).isEqualTo(0)
        }

    @Test
    fun serializesCommandsWithinALane() =
        runTest {
            val transport = RecordingTransport()
            val queue = CommandQueue(transport)
            queue.markReady()
            val first = async { queue.player { BridgeCommand.Play(it) } }
            val second = async { queue.player { BridgeCommand.Pause(it) } }
            runCurrent()
            assertThat(transport.sent).hasSize(1)
            queue.onEvent(BridgeEvent.Ack(1, requestIdOf(transport.sent[0])))
            runCurrent()
            assertThat(transport.sent).hasSize(2)
            assertThat(transport.sent[1]).contains("\"type\":\"pause\"")
            queue.onEvent(BridgeEvent.Ack(1, requestIdOf(transport.sent[1])))
            assertThat(first.await()).isEqualTo(CommandResult.Acknowledged)
            assertThat(second.await()).isEqualTo(CommandResult.Acknowledged)
        }

    @Test
    fun dataRequestsDoNotBlockPlayerCommands() =
        runTest {
            val transport = RecordingTransport()
            val queue = CommandQueue(transport)
            queue.markReady()
            val browse = async { queue.data { BridgeCommand.Browse(it, "home") } }
            runCurrent()
            val pause = async { queue.player { BridgeCommand.Pause(it) } }
            runCurrent()
            assertThat(transport.sent).hasSize(2)
            queue.onEvent(BridgeEvent.Ack(1, requestIdOf(transport.sent[1])))
            assertThat(pause.await()).isEqualTo(CommandResult.Acknowledged)
            val page = BrowsePage("home", "Home", emptyList(), emptyList(), null)
            queue.onEvent(BridgeEvent.BrowseResult(1, requestIdOf(transport.sent[0]), page))
            assertThat(browse.await()).isEqualTo(CommandResult.Page(page))
        }

    @Test
    fun dataRequestsRunConcurrently() =
        runTest {
            val transport = RecordingTransport()
            val queue = CommandQueue(transport)
            queue.markReady()
            val home = async { queue.data { BridgeCommand.Browse(it, "home") } }
            val search = async { queue.data { BridgeCommand.Search(it, "daft punk", SearchFilter.ALL) } }
            runCurrent()
            assertThat(transport.sent).hasSize(2)
            val page = BrowsePage("x", "", emptyList(), emptyList(), null)
            queue.onEvent(BridgeEvent.SearchResult(1, requestIdOf(transport.sent[1]), "daft punk", page))
            assertThat(search.await()).isEqualTo(CommandResult.Page(page))
            assertThat(home.isCompleted).isFalse()
            queue.onEvent(BridgeEvent.BrowseResult(1, requestIdOf(transport.sent[0]), page))
            assertThat(home.await()).isEqualTo(CommandResult.Page(page))
        }

    @Test
    fun mapsBridgeErrorsToFailures() =
        runTest {
            val transport = RecordingTransport()
            val queue = CommandQueue(transport)
            queue.markReady()
            val result = async { queue.data { BridgeCommand.Browse(it, "playlists") } }
            runCurrent()
            val consumed =
                queue.onEvent(
                    BridgeEvent.Error(1, BridgeErrorCode.NOT_SIGNED_IN, "Sign in", requestIdOf(transport.sent[0])),
                )
            assertThat(consumed).isTrue()
            assertThat(result.await()).isEqualTo(CommandResult.Failed(BridgeErrorCode.NOT_SIGNED_IN, "Sign in"))
        }

    @Test
    fun ignoresUnknownAndUnscopedEvents() {
        val queue = CommandQueue(RecordingTransport())
        assertThat(queue.onEvent(BridgeEvent.Ack(1, "missing"))).isFalse()
        assertThat(queue.onEvent(BridgeEvent.Error(1, BridgeErrorCode.NETWORK, "x", null))).isFalse()
        assertThat(queue.onEvent(BridgeEvent.AdStart(1))).isFalse()
    }

    @Test
    fun failsPendingCommandsWhenTheRendererGoesAway() =
        runTest {
            val transport = RecordingTransport()
            val queue = CommandQueue(transport)
            queue.markReady()
            val result = async { queue.player { BridgeCommand.Play(it) } }
            runCurrent()
            queue.markNotReady()
            assertThat(result.await()).isEqualTo(CommandResult.NotReady)
            assertThat(queue.isReady.value).isFalse()
        }

    @Test
    fun reportsNotReadyWhenTheTransportRefuses() =
        runTest {
            val transport = RecordingTransport().apply { accept = false }
            val queue = CommandQueue(transport)
            queue.markReady()
            assertThat(queue.player { BridgeCommand.Play(it) }).isEqualTo(CommandResult.NotReady)
        }

    @Test
    fun rejectsInvalidCommandsWithoutSending() =
        runTest {
            val transport = RecordingTransport()
            val queue = CommandQueue(transport)
            queue.markReady()
            val result = queue.player { BridgeCommand.SetVolume(it, 3.0) }
            assertThat(result).isInstanceOf(CommandResult.Failed::class.java)
            assertThat(transport.sent).isEmpty()
        }
}
