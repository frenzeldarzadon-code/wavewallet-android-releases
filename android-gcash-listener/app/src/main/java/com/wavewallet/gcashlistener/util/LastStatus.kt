package com.wavewallet.gcashlistener.util

import android.content.Context
import android.provider.Settings
import android.text.TextUtils

/**
 * Small status board for the UI. It holds only non-sensitive operational facts —
 * never the pairing secret, never full notification bodies of other apps.
 */
object LastStatus {
    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences("listener_status", Context.MODE_PRIVATE)

    fun recordNotification(context: Context, summary: String) =
        prefs(context).edit().putString("last_notification", summary)
            .putLong("last_notification_at", System.currentTimeMillis()).apply()

    fun recordSent(context: Context, eventUid: String) =
        prefs(context).edit().putString("last_sent", eventUid)
            .putLong("last_sent_at", System.currentTimeMillis()).apply()

    fun recordServerResponse(context: Context, response: String) =
        prefs(context).edit().putString("last_response", response.take(300)).apply()

    fun recordHeartbeat(context: Context, ok: Boolean, response: String) =
        prefs(context).edit().putBoolean("hb_ok", ok)
            .putLong("hb_at", System.currentTimeMillis())
            .putString("last_response", response.take(300)).apply()

    fun snapshot(context: Context): Map<String, String> {
        val p = prefs(context)
        return mapOf(
            "lastNotification" to (p.getString("last_notification", null) ?: "—"),
            "lastNotificationAt" to timeOf(p.getLong("last_notification_at", 0)),
            "lastSent" to (p.getString("last_sent", null) ?: "—"),
            "lastSentAt" to timeOf(p.getLong("last_sent_at", 0)),
            "lastResponse" to (p.getString("last_response", null) ?: "—"),
            "heartbeat" to if (p.getLong("hb_at", 0) == 0L) "never" else
                (if (p.getBoolean("hb_ok", false)) "OK · " else "failed · ") + timeOf(p.getLong("hb_at", 0)),
        )
    }

    private fun timeOf(millis: Long) =
        if (millis == 0L) "—" else android.text.format.DateFormat.format("MMM d, HH:mm:ss", millis).toString()

    /** True only when the user granted Notification Access in system settings. */
    fun hasNotificationAccess(context: Context): Boolean {
        val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
        if (TextUtils.isEmpty(flat)) return false
        return flat.split(":").any { it.substringBefore("/") == context.packageName }
    }
}
