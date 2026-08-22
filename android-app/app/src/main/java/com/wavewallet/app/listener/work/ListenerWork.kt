package com.wavewallet.app.listener.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.wavewallet.app.BuildConfig
import com.wavewallet.app.listener.data.ListenerDb
import com.wavewallet.app.listener.net.ListenerClient
import com.wavewallet.app.listener.source.SourceRules
import com.wavewallet.app.listener.store.PairingStore
import com.wavewallet.app.listener.util.LastStatus
import java.util.concurrent.TimeUnit

/** Drains the local queue with WorkManager's exponential backoff. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val store = PairingStore(applicationContext)
        if (!store.isPaired) return Result.success()
        val dao = ListenerDb.get(applicationContext).events()
        val client = ListenerClient(store)

        var retry = false
        for (event in dao.pending()) {
            val outcome = client.sendEvent(event)
            LastStatus.recordServerResponse(applicationContext, "${outcome.code} ${outcome.body}")
            if (isRevoked(outcome)) { store.revokedByServer = true; return Result.success() }
            when {
                outcome.ok -> {
                    dao.mark(event.id, "sent", null, outcome.body)
                    LastStatus.recordSent(applicationContext, event.eventUid)
                }
                // 409 replay / 4xx contract errors will never succeed on retry.
                outcome.code in 400..499 && outcome.code != 429 ->
                    dao.mark(event.id, "rejected", "HTTP ${outcome.code}", outcome.body)
                else -> {
                    dao.mark(event.id, "queued", outcome.body, null)
                    retry = true
                }
            }
        }
        return if (retry) Result.retry() else Result.success()
    }
}

/** Periodic heartbeat, also self-heals the queue after long offline periods. */
class HeartbeatWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val store = PairingStore(applicationContext)
        if (!store.isPaired) return Result.success()
        val outcome = ListenerClient(store).heartbeat(
            health = LastStatus.health(applicationContext),
            appVersion = BuildConfig.VERSION_NAME,
        )
        LastStatus.recordHeartbeat(applicationContext, outcome.ok, "${outcome.code} ${outcome.body}")
        // A revoked device can only come back through a fresh one-time code
        // issued by an authorised admin. Remember it so the UI offers re-pairing.
        if (isRevoked(outcome)) { store.revokedByServer = true; return Result.success() }
        if (outcome.ok) store.revokedByServer = false
        ListenerScheduler.syncNow(applicationContext)
        ListenerScheduler.syncSourceRules(applicationContext)
        return if (outcome.ok) Result.success() else Result.retry()
    }
}

/**
 * Refreshes the notification-source allow/deny rules for this device.
 *
 * The cache is only ever replaced by a successful answer, so a failed fetch
 * leaves the previous decision in place and an installation that never had any
 * rules keeps allowing every source (GCash included).
 */
class SourceRulesWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val store = PairingStore(applicationContext)
        if (!store.isPaired) return Result.success()
        val outcome = ListenerClient(store).fetchSourceRules()
        if (!outcome.ok) {
            LastStatus.recordSourceRules(
                applicationContext,
                false,
                "sync failed (HTTP ${outcome.code}) - using " + SourceRules.summary(applicationContext),
            )
            return Result.retry()
        }
        val rules = SourceRules.rulesArrayOf(outcome.body)
        if (rules != null) SourceRules.store(applicationContext, rules)
        LastStatus.recordSourceRules(applicationContext, true, SourceRules.summary(applicationContext))
        return Result.success()
    }
}

/** WaveWallet refused this device because it was revoked. */
private fun isRevoked(outcome: ListenerClient.Outcome) =
    outcome.code == 403 && outcome.body.contains("revoked", ignoreCase = true)

object ListenerScheduler {
    private val NETWORK = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun syncNow(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            "listener-sync",
            ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(NETWORK)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build(),
        )
    }

    /** Pull the notification-source rules that apply to this device. */
    fun syncSourceRules(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            "listener-source-rules",
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<SourceRulesWorker>()
                .setConstraints(NETWORK)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 60, TimeUnit.SECONDS)
                .build(),
        )
    }

    /**
     * Push the health snapshot right now. Used when Android connects or drops
     * the listener, so a disconnect is visible on the server within seconds
     * instead of at the next 15-minute heartbeat.
     */
    fun heartbeatNow(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            "listener-heartbeat-now",
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<HeartbeatWorker>()
                .setConstraints(NETWORK)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build(),
        )
    }

    fun scheduleHeartbeat(context: Context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "listener-heartbeat",
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<HeartbeatWorker>(15, TimeUnit.MINUTES)
                .setConstraints(NETWORK)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
                .build(),
        )
    }
}
