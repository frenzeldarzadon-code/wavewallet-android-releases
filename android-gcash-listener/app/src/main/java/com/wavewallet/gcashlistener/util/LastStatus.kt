package com.wavewallet.gcashlistener.util

import android.content.Context
import android.provider.Settings
import android.text.TextUtils

/**
 * Small status board for the UI. It holds only non-sensitive operational facts —
 * never the pairing secret, never full notification bodies of other apps.
 *
 * The states below are deliberately separate, because they fail independently:
 *  - Notification Access granted (a system setting)
 *  - NotificationListenerService actually CONNECTED (Android bound the service)
 *  - Foreground service running (keeps the process alive, proves nothing else)
 *  - A GCash notification actually RECEIVED by onNotificationPosted
 *  - The result of the recovery sweep at connect time
 *  - The parser verdict for the last GCash notification
 *  - The last server/event result
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

    /** Android bound (or unbound) the NotificationListenerService. */
    fun recordListenerConnected(context: Context, connected: Boolean) =
        prefs(context).edit().putBoolean("listener_connected", connected)
            .putLong("listener_connected_at", System.currentTimeMillis()).apply()

    /** The foreground service started or stopped. Never proof of connection. */
    fun recordForeground(context: Context, running: Boolean) =
        prefs(context).edit().putBoolean("fg_running", running)
            .putLong("fg_at", System.currentTimeMillis()).apply()

    /** A GCash-package notification arrived — recorded BEFORE any parsing. */
    fun recordReceived(context: Context, source: String, chars: Int) =
        prefs(context).edit()
            .putString("last_received", "$source · ${chars} chars of text")
            .putLong("last_received_at", System.currentTimeMillis())
            .putInt("received_count", prefs(context).getInt("received_count", 0) + 1)
            .apply()

    /** The parser verdict for the notification recorded above. */
    fun recordParseResult(context: Context, verdict: String) =
        prefs(context).edit().putString("last_parse", verdict.take(200))
            .putLong("last_parse_at", System.currentTimeMillis()).apply()

    /** Result of an activeNotifications sweep (connect time or manual re-scan). */
    fun recordSweep(context: Context, total: Int, gcash: Int, candidates: Int, note: String? = null) =
        prefs(context).edit()
            .putString(
                "last_sweep",
                "$total active · $gcash from GCash · $candidates payment candidate(s)" +
                    (note?.let { " · $it" } ?: ""),
            )
            .putLong("last_sweep_at", System.currentTimeMillis()).apply()

    fun isListenerConnected(context: Context): Boolean =
        prefs(context).getBoolean("listener_connected", false)

    fun snapshot(context: Context): Map<String, String> {
        val p = prefs(context)
        val connected = p.getBoolean("listener_connected", false)
        return mapOf(
            "listener" to (if (connected) "CONNECTED · since " else "NOT CONNECTED · since ") +
                timeOf(p.getLong("listener_connected_at", 0)),
            "foreground" to (if (p.getBoolean("fg_running", false)) "running · " else "not running · ") +
                timeOf(p.getLong("fg_at", 0)),
            "lastReceived" to (p.getString("last_received", null) ?: "—"),
            "lastReceivedAt" to timeOf(p.getLong("last_received_at", 0)),
            "receivedCount" to p.getInt("received_count", 0).toString(),
            "lastParse" to (p.getString("last_parse", null) ?: "—"),
            "lastParseAt" to timeOf(p.getLong("last_parse_at", 0)),
            "lastSweep" to (p.getString("last_sweep", null) ?: "—"),
            "lastSweepAt" to timeOf(p.getLong("last_sweep_at", 0)),
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
