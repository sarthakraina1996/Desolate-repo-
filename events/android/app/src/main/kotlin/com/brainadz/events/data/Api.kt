// HTTP client for the versioned API. The session token is sent as a bearer token.
package com.brainadz.events.data

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

// status 0 means the request never reached the server (no connection).
class ApiException(val status: Int, message: String, val code: String? = null) : Exception(message) {
    val offline get() = status == 0
}

val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

// Builds a JSON body from plain values.
fun body(vararg pairs: Pair<String, Any?>): JsonObject = JsonObject(pairs.associate { (k, v) -> k to toJson(v) })
private fun toJson(v: Any?): JsonElement = when (v) {
    null -> JsonNull
    is JsonElement -> v
    is String -> JsonPrimitive(v)
    is Number -> JsonPrimitive(v)
    is Boolean -> JsonPrimitive(v)
    is Map<*, *> -> JsonObject(v.entries.associate { it.key.toString() to toJson(it.value) })
    is Iterable<*> -> kotlinx.serialization.json.JsonArray(v.map { toJson(it) })
    else -> JsonPrimitive(v.toString())
}

object Api {
    var baseUrl: String = ""
    var token: String? = null
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    suspend fun raw(method: String, path: String, payload: JsonElement? = null): String = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url("$baseUrl/api/v1$path").header("X-Client", "android")
        token?.let { builder.header("Authorization", "Bearer $it") }
        val requestBody = payload?.toString()?.toRequestBody("application/json".toMediaType())
        builder.method(method, requestBody ?: if (method == "GET") null else "".toRequestBody(null))
        val response = try {
            http.newCall(builder.build()).execute()
        } catch (e: IOException) {
            throw ApiException(0, "No connection. Check the network and try again.", "offline")
        } catch (e: IllegalArgumentException) {
            throw ApiException(0, "The server address is not valid.", "offline")
        }
        response.use {
            val text = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                val err = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
                throw ApiException(
                    it.code,
                    err?.get("error")?.jsonPrimitive?.contentOrNull ?: "Something went wrong (${it.code})",
                    err?.get("code")?.jsonPrimitive?.contentOrNull,
                )
            }
            text
        }
    }

    suspend inline fun <reified T> get(path: String): T = json.decodeFromString(serializer(), raw("GET", path))
    suspend inline fun <reified T> post(path: String, payload: JsonElement = body()): T = json.decodeFromString(serializer(), raw("POST", path, payload))
    suspend inline fun <reified T> put(path: String, payload: JsonElement = body()): T = json.decodeFromString(serializer(), raw("PUT", path, payload))
    suspend fun delete(path: String, payload: JsonElement? = null) { raw("DELETE", path, payload) }
}
