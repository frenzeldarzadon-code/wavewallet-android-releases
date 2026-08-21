package com.wavewallet.app.listener.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.wavewallet.app.listener.store.PairingStore
import com.wavewallet.app.listener.util.LastStatus
import com.wavewallet.app.listener.work.ListenerScheduler

/** Restarts the foreground service and heartbeat after reboot or app update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (!PairingStore(context).isPaired) return
        if (LastStatus.hasNotificationAccess(context)) ListenerForegroundService.start(context)
        ListenerScheduler.scheduleHeartbeat(context)
    }
}
