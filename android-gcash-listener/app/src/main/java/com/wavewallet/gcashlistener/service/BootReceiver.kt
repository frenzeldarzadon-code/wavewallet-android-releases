package com.wavewallet.gcashlistener.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.wavewallet.gcashlistener.store.PairingStore
import com.wavewallet.gcashlistener.util.LastStatus
import com.wavewallet.gcashlistener.work.ListenerScheduler

/** Restarts the foreground service and heartbeat after reboot or app update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (!PairingStore(context).isPaired) return
        if (LastStatus.hasNotificationAccess(context)) ListenerForegroundService.start(context)
        ListenerScheduler.scheduleHeartbeat(context)
    }
}
