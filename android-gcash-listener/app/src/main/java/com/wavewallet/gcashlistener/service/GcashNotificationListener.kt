package com.wavewallet.gcashlistener.service

import android.content.ComponentName
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.wavewallet.gcashlistener.BuildConfig
import com.wavewallet.gcashlistener.crypto.EventUid
import com.wavewallet.gcashlistener.data.ListenerDb
import com.wavewallet.gcashlistener.data.QueuedEvent
import com.wavewallet.gcashlistener.parser.GcashParser
import com.wavewallet.gcashlistener.parser.NotificationText
import com.wavewallet.gcashlistener.util.LastStatus
import com.wavewallet.gcashlistener.work.ListenerScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Reads notifications only after the user grants Notification Access.
 *
 * Everything that is not a GCash incoming-payment notification is discarded in
 * memory and never stored or transmitted. On (re)connect the service also
 * sweeps the notifications still on the status bar, so a payment that arrived
 * while the service was disconnected is still captured.
 *
 * Diagnostics are deliberately layered: connection, reception and parsing are
 * recorded separately so an admin can tell whether Android failed to deliver
 * the notification or the parser failed to read it.
 */
class GcashNotificationListener : NotificationListenerService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onListenerConnected() {
        super.onListenerConnected()
        LastStatus.recordListenerConnected(this, true)
        ListenerForegroundService.start(this)
        ListenerScheduler.scheduleHeartbeat(this)
        ListenerScheduler.heartbeatNow(this)
        recoverActiveNotifications()
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        LastStatus.recordListenerConnected(this, false)
        // Report the outage immediately: the foreground service and its
        // heartbeat can stay alive while Android is no longer delivering.
        ListenerScheduler.heartbeatNow(this)
        // Android can unbind the listener while the foreground service keeps
        // running. Ask the system to bind us again; recovery then re-runs.
        runCatching { requestRebind(ComponentName(this, GcashNotificationListener::class.java)) }
    }

    /** Android delivers the current status-bar notifications only after connect. */
    private fun recoverActiveNotifications() {
        val active = try {
            activeNotifications
        } catch (e: SecurityException) {
            LastStatus.recordSweep(this, 0, 0, 0, "could not read active notifications")
            LastStatus.recordNotification(this, "Could not read existing notifications: ${e.message}")
            null
        } ?: return

        var gcash = 0
        var recovered = 0
        for (sbn in active) {
            if (sbn.packageName != BuildConfig.GCASH_PACKAGE) continue
            gcash++
            if (handle(sbn, source = "recovery")) recovered++
        }
        LastStatus.recordSweep(this, active.size, gcash, recovered)
        if (recovered > 0) {
            LastStatus.recordNotification(this, "Recovered $recovered GCash notification(s) after reconnect")
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName != BuildConfig.GCASH_PACKAGE) return
        handle(sbn, source = "posted")
    }

    /** Returns true when the notification was a GCash payment worth keeping. */
    private fun handle(sbn: StatusBarNotification, source: String): Boolean {
        val extras = sbn.notification?.extras
        val title = NotificationText.titleOf(extras)
        val body = NotificationText.bodyOf(extras)
        val raw = NotificationText.merge(listOf(title, body))

        // Recorded BEFORE parsing: proves Android delivered the notification
        // even when the parser later rejects it.
        LastStatus.recordReceived(this, source, raw.length)
        if (raw.isEmpty()) {
            LastStatus.recordParseResult(this, "empty notification — no readable text")
            return false
        }

        return when (val result = GcashParser.parse(title, body)) {
            is GcashParser.Result.Ignored -> {
                LastStatus.recordParseResult(this, "IGNORED — not an incoming-payment notification")
                false // not a payment: drop, never stored
            }
            is GcashParser.Result.Unparsed -> {
                LastStatus.recordParseResult(this, "UNPARSED — ${result.reason} (never credited)")
                LastStatus.recordNotification(this, "Unreadable GCash payment notification (${result.reason})")
                enqueue(sbn, raw, null, null, null, null, status = "unparsed")
                true
            }
            is GcashParser.Result.Payment -> {
                LastStatus.recordParseResult(
                    this,
                    "PAYMENT read via $source%s".format(result.reference?.let { " (ref present)" } ?: ""),
                )
                LastStatus.recordNotification(
                    this,
                    "PHP %.2f from %s%s".format(
                        result.amountPhp,
                        result.senderNumber ?: result.senderName ?: "unknown",
                        result.reference?.let { " (ref $it)" } ?: "",
                    ),
                )
                enqueue(
                    sbn, raw, result.amountPhp, result.senderNumber, result.senderName,
                    result.reference, status = "queued",
                )
                true
            }
        }
    }

    private fun enqueue(
        sbn: StatusBarNotification,
        raw: String,
        amount: Double?,
        number: String?,
        name: String?,
        reference: String?,
        status: String,
    ) {
        val event = QueuedEvent(
            // A reference identifies the payment itself, so a reposted or
            // recovered copy of the same notification resolves to one event.
            eventUid = reference?.let { EventUid.ofReference(it) }
                ?: EventUid.of(sbn.key ?: "${sbn.packageName}:${sbn.id}", sbn.postTime, raw),
            packageName = sbn.packageName,
            postedAt = sbn.postTime,
            amountPhp = amount,
            senderNumber = number,
            senderName = name,
            gcashReference = reference,
            rawText = raw,
            parserVersion = GcashParser.VERSION,
            status = status,
        )
        scope.launch {
            // Unique index on eventUid: a reposted notification, or the same
            // notification seen by both onNotificationPosted and recovery,
            // inserts exactly once.
            val inserted = ListenerDb.get(applicationContext).events().insertIfNew(event)
            if (inserted > 0 && status == "queued") ListenerScheduler.syncNow(applicationContext)
        }
    }
}
