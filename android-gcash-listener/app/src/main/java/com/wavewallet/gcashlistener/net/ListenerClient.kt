package com.wavewallet.gcashlistener.net

import com.wavewallet.gcashlistener.crypto.ListenerSigner
import com.wavewallet.gcashlistener.data.QueuedEvent
import com.wavewallet.gcashlistener.store.PairingStore
import com.wavewallet.gcashlistener.util.LastStatus
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Signed delivery to the Phase 1 endpoint. No Supabase key ever lives here. */
class ListenerClient(private val store: PairingStore) {

    data class Outcome(val ok: Boolean, val code: Int, val body: String)

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    /**
     * A heartbeat carries the phone's own listener health so the server can
     * tell "process alive" apart from "Android is actually delivering
     * notifications". No notification content is ever sent here.
     */
    suspend fun heartbeat(health: LastStatus.Health? = null, appVersion: String? = null): Outcome {
        val body = JSONObject().put("kind", "heartbeat")
        health?.let {
            body.put("listener_connected", it.listenerConnected)
            body.put("notification_access", it.notificationAccess)
            body.put("received_count", it.receivedCount)
            if (it.lastReceivedAt > 0) body.put("last_received_at", isoUtc(it.lastReceivedAt))
        }
        appVersion?.let { body.put("app_version", it) }
        return post(body.toString())
    }

    suspend fun sendEvent(event: QueuedEvent): Outcome {
        val body = JSONObject()
            .put("kind", "event")
            .put("event_uid", event.eventUid)
            .put("package_name", event.packageName)
            .put("posted_at", isoUtc(event.postedAt))
            .put("parser_version", event.parserVersion)
        event.amountPhp?.let { body.put("amount_php", it) }
        event.senderNumber?.let { body.put("sender_number", it) }
        event.senderName?.let { body.put("sender_name", it) }
        event.gcashReference?.let { body.put("gcash_reference", it) }

        body.put("raw_text", event.rawText)
        return post(body.toString())
    }

    private fun post(raw: String): Outcome {
        val deviceId = store.deviceId ?: return Outcome(false, 0, "Device is not paired")
        val key = store.hmacKey ?: return Outcome(false, 0, "Device is not paired")
        val ts = (System.currentTimeMillis() / 1000).toString()
        val nonce = UUID.randomUUID().toString()
        val signature = ListenerSigner.hmacHex(key, ListenerSigner.signingPayload(deviceId, ts, nonce, raw))

        val request = Request.Builder()
            .url(store.baseUrl.trimEnd('/') + PATH)
            .post(raw.toRequestBody(JSON))
            .header("x-listener-device", deviceId)
            .header("x-listener-ts", ts)
            .header("x-listener-nonce", nonce)
            .header("x-listener-sig", signature)
            .build()

        return try {
            http.newCall(request).execute().use { response ->
                Outcome(response.isSuccessful, response.code, response.body?.string().orEmpty().take(500))
            }
        } catch (e: Exception) {
            Outcome(false, 0, e.message ?: "Network error")
        }
    }

    private fun isoUtc(millis: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date(millis))

    private companion object {
        const val PATH = "/api/public/payments/listener"
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
