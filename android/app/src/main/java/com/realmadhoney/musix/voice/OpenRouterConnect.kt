package com.realmadhoney.musix.voice

import android.content.Context
import android.content.Intent
import androidx.core.net.toUri
import com.realmadhoney.musix.core.voice.AiIntentParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

object OpenRouterConnect {
    private const val TIMEOUT_MS = 5 * 60_000
    private const val HTTP_TIMEOUT_MS = 15_000
    private const val MAX_REQUEST = 16_384
    private const val MAX_CODE = 2_000
    private const val MAX_KEY = 400
    private const val BACKLOG = 4
    private const val BACK_LINK = "musix://connected"
    private val random = SecureRandom()

    private fun token(bytes: Int): String {
        val buffer = ByteArray(bytes)
        random.nextBytes(buffer)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buffer)
    }

    private fun challenge(verifier: String): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(
            MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)),
        )

    @Throws(IOException::class)
    suspend fun connect(context: Context): String {
        val verifier = token(32)
        val state = token(16)
        return withContext(Dispatchers.IO) {
            ServerSocket(0, BACKLOG, InetAddress.getByName("127.0.0.1")).use { server ->
                server.soTimeout = TIMEOUT_MS
                val auth =
                    "https://openrouter.ai/auth"
                        .toUri()
                        .buildUpon()
                        .appendQueryParameter("callback_url", "http://localhost:${server.localPort}/callback")
                        .appendQueryParameter("code_challenge", challenge(verifier))
                        .appendQueryParameter("code_challenge_method", "S256")
                        .appendQueryParameter("key_label", "Musix Android")
                        .appendQueryParameter("state", state)
                        .build()
                withContext(Dispatchers.Main) {
                    context.startActivity(Intent(Intent.ACTION_VIEW, auth).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                val code = waitForCode(server, state)
                exchange(code, verifier)
            }
        }
    }

    private fun waitForCode(
        server: ServerSocket,
        state: String,
    ): String {
        while (true) {
            server.accept().use { socket ->
                socket.soTimeout = HTTP_TIMEOUT_MS
                val code = codeFrom(readRequestLine(socket), state)
                respond(socket, code != null)
                if (code != null) return code
            }
        }
    }

    private fun readRequestLine(socket: Socket): String {
        val input = socket.getInputStream()
        val line = StringBuilder()
        while (line.length < MAX_REQUEST) {
            val next = input.read()
            if (next < 0 || next == '\n'.code) break
            if (next != '\r'.code) line.append(next.toChar())
        }
        return line.toString()
    }

    private fun codeFrom(
        requestLine: String,
        state: String,
    ): String? {
        val parts = requestLine.split(' ')
        if (parts.size < 2 || parts[0] != "GET") return null
        val uri = "http://localhost${parts[1]}".toUri()
        if (uri.path != "/callback") return null
        val returned = uri.getQueryParameter("state")
        if (returned != null && returned != state) return null
        val code = uri.getQueryParameter("code").orEmpty()
        return code.takeIf { it.isNotEmpty() && it.length <= MAX_CODE }
    }

    private fun respond(
        socket: Socket,
        success: Boolean,
    ) {
        val title = if (success) "Musix is connected" else "Connection failed"
        val message =
            if (success) {
                "<a href=\"$BACK_LINK\" style=\"display:inline-block;padding:14px 24px;border-radius:24px;" +
                    "background:#8b8cf8;color:#0b0b0b;text-decoration:none;font-weight:600\">Back to Musix</a>"
            } else {
                "Go back to Musix and try again."
            }
        val refresh = if (success) "<meta http-equiv=\"refresh\" content=\"1;url=$BACK_LINK\">" else ""
        val page =
            "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
                "$refresh<title>$title</title></head><body style=\"margin:0;min-height:100vh;display:grid;place-items:center;" +
                "background:#121212;color:#f2f2f2;font:17px sans-serif\"><main style=\"padding:24px;text-align:center\"><h1>$title</h1>" +
                "<p>$message</p></main></body></html>"
        val body = page.toByteArray(Charsets.UTF_8)
        val head =
            "HTTP/1.1 ${if (success) "200 OK" else "400 Bad Request"}\r\nContent-Type: text/html; charset=utf-8\r\n" +
                "Content-Length: ${body.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        socket.getOutputStream().apply {
            write(head.toByteArray(Charsets.US_ASCII))
            write(body)
            flush()
        }
    }

    private fun exchange(
        code: String,
        verifier: String,
    ): String {
        val connection = URL("${AiIntentParser.BASE}/auth/keys").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = HTTP_TIMEOUT_MS
            connection.readTimeout = HTTP_TIMEOUT_MS
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            val request =
                buildJsonObject {
                    put("code", code)
                    put("code_verifier", verifier)
                    put("code_challenge_method", "S256")
                }.toString()
            connection.outputStream.use { it.write(request.toByteArray(Charsets.UTF_8)) }
            if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                throw IOException("OpenRouter did not accept the sign-in (HTTP ${connection.responseCode})")
            }
            val text = connection.inputStream.bufferedReader().use { it.readText() }
            val key =
                ((Json.parseToJsonElement(text) as? JsonObject)?.get("key") as? JsonPrimitive)
                    ?.takeIf { it.isString }
                    ?.content
                    ?.trim()
                    .orEmpty()
            if (key.isEmpty() || key.length > MAX_KEY) throw IOException("OpenRouter returned no key")
            return key
        } finally {
            connection.disconnect()
        }
    }
}
