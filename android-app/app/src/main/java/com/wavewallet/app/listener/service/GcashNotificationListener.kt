package com.wavewallet.app.listener.service

import android.content.ComponentName
import android.content.pm.PackageManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.wavewallet.app.listener.crypto.EventUid
import com.wavewallet.app.listener.data.ListenerDb
import com.wavewallet.app.listener.data.QueuedEvent
import com.wavewallet.app.listener.parser.GcashParser
import com.wavewallet.app.listener.parser.NotificationText
import com.wavewallet.app.listener.parser.PaymentSignals
import com.wavewallet.app.listener.source.SourceRules
import com.wavewallet.app.listener.util.LastStatus
import com.wavewallet.app.listener.work.ListenerScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Reads notifications only after the user grants Notification Access.
 *
 * The class name is kept for backwards compatibility: renaming it would revoke
 * the Notification Access grant on every phone that already has it. The
 * behaviour is provider-agnostic — it reads every source Android delivers,
 * not just GCash.
 *
 * Layered filtering, strictest first:
 *  1. Our own notifications are ignored outright.
 *  2. Sources disabled by listener_source_rules are dropped before their text
 *     is read into anything durable. This is a privacy/bandwidth optimisation;
 *     the server enforces the same rule again on every event.
 *  3. Notifications with no money shape at all are counted and dropped locally.
 *  4. Everything else is queued as a payment CANDIDATE. Classification,
 *     matching and any crediting happen exclusively on the server.
 *
 * Diagnostics are deliberately layered: notifications seen, source-filtered,
 * candidates and non-payment are separate counters so an admin can tell which
 * stage discarded something.
 */
class GcashNotificationListener : NotificationListenerService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onListenerConnected() {
        super.onListenerConnected()
        LastStatus.recordListenerConnected(this, true)
        ListenerForegroundService.start(this)
        ListenerScheduler.scheduleHeartbeat(this)
        ListenerScheduler.heartbeatNow(this)
        ListenerScheduler.syncSourceRules(this)
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

        var considered = 0
        var recovered = 0
        for (sbn in active) {
            if (sbn.packageName == packageName) continue
            if (!SourceRules.allows(this, sbn.packageName)) continue
            considered++
            if (handle(sbn, source = "recovery")) recovered++
        }
        LastStatus.recordSweep(this, active.size, considered, recovered)
        if (recovered > 0) {
            LastStatus.recordNotification(this, "Recovered $recovered payment candidate(s) after reconnect")
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        // Never read ourselves back: WaveWallet's own notifications can never
        // be a payment and would otherwise loop through the queue.
        if (sbn.packageName == packageName) return

        LastStatus.recordSeen(this)

        // Earliest safe filter point. Nothing of a disabled source is read into
        // the queue, uploaded or persisted — only the app identity is counted.
        if (!SourceRules.allows(this, sbn.packageName)) {
            LastStatus.recordSourceDisabled(this, sbn.packageName)
            return
        }
        handle(sbn, source = "posted")
    }

    /** Returns true when the notification was queued as a payment candidate. */
    private fun handle(sbn: StatusBarNotification, source: String): Boolean {
        val extras = sbn.notification?.extras
        val title = NotificationText.titleOf(extras)
        val body = NotificationText.bodyOf(extras)
        val raw = NotificationText.merge(listOf(title, body))
        val provider = PaymentSignals.providerFor(sbn.packageName)
        val label = appLabelOf(sbn.packageName)

        // Recorded BEFORE parsing: proves Android delivered the notification
        // even when triage or the parser later rejects it.
        LastStatus.recordReceived(this, "$source · ${label ?: sbn.packageName}", raw.length)
        if (raw.isEmpty()) {
            LastStatus.recordParseResult(this, "empty notification — no readable text")
            return false
        }

        // GCash keeps its dedicated parser so existing behaviour is unchanged.
        if (provider == "gcash") return handleGcash(sbn, title, body, raw, label)

        if (!PaymentSignals.looksLikeMoney(raw)) {
            LastStatus.recordNonPayment(this, sbn.packageName)
            LastStatus.recordParseResult(this, "NON-PAYMENT — no amount or money wording")
            return false
        }

        // Unknown provider: send the facts, let WaveWallet classify. The phone
        // never guesses an amount, a sender or a reference for a new provider.
        LastStatus.recordCandidate(this, sbn.packageName, provider)
        LastStatus.recordParseResult(this, "CANDIDATE — sent to WaveWallet for classification")
        enqueue(
            sbn = sbn, raw = raw, title = title, text = body, label = label, provider = null,
            amount = null, number = null, name = null, reference = null,
            parserVersion = PaymentSignals.VERSION, status = "queued",
        )
        return true
    }

    private fun handleGcash(
        sbn: StatusBarNotification,
        title: String?,
        body: String,
        raw: String,
        label: String?,
    ): Boolean = when (val result = GcashParser.parse(title, body)) {
        is GcashParser.Result.Ignored -> {
            LastStatus.recordNonPayment(this, sbn.packageName)
            LastStatus.recordParseResult(this, "IGNORED — not an incoming-payment notification")
            false // not a payment: drop, never stored
        }
        is GcashParser.Result.Unparsed -> {
            LastStatus.recordCandidate(this, sbn.packageName, "gcash")
            LastStatus.recordParseResult(this, "UNPARSED — ${result.reason} (never credited)")
            LastStatus.recordNotification(this, "Unreadable GCash payment notification (${result.reason})")
            enqueue(
                sbn, raw, title, body, label, "gcash",
                null, null, null, null, GcashParser.VERSION, status = "unparsed",
            )
            true
        }
        is GcashParser.Result.Payment -> {
            LastStatus.recordCandidate(this, sbn.packageName, "gcash")
            LastStatus.recordParseResult(
                this,
                "PAYMENT read%s".format(result.reference?.let { " (ref present)" } ?: ""),
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
                sbn, raw, title, body, label, "gcash",
                result.amountPhp, result.senderNumber, result.senderName, result.reference,
                GcashParser.VERSION, status = "queued",
            )
            true
        }
    }

    private fun appLabelOf(packageName: String): String? = runCatching {
        val pm = packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString().take(160)
    }.getOrElse { if (it is PackageManager.NameNotFoundException) null else null }

    private fun enqueue(
        sbn: StatusBarNotification,
        raw: String,
        title: String?,
        text: String?,
        label: String?,
        provider: String?,
        amount: Double?,
        number: String?,
        name: String?,
        reference: String?,
        parserVersion: String,
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
            title = title,
            text = text?.takeIf { it.isNotBlank() },
            appLabel = label,
            providerId = provider,
            parserVersion = parserVersion,
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
