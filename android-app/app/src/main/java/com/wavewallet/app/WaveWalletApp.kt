package com.wavewallet.app

import android.app.Application
import android.util.Log
import com.wavewallet.app.listener.store.PairingStore
import com.wavewallet.app.listener.work.ListenerScheduler

/**
 * Application entry point for the WaveWallet shell.
 *
 * Its only job is to restart the GCash listener heartbeat when this device was
 * already paired. The WebView UI is unaffected: an unpaired phone schedules
 * nothing and behaves exactly as before the listener was integrated.
 */
class WaveWalletApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // The encrypted pairing store needs a working Android Keystore. Never let
        // an unavailable keystore crash app startup — the UI reports "not paired".
        runCatching {
            if (PairingStore(this).isPaired) {
                ListenerScheduler.scheduleHeartbeat(this)
                // Refresh the notification-source allow/deny rules early so a
                // disabled source is filtered before its content is ever read.
                ListenerScheduler.syncSourceRules(this)
            }
        }.onFailure { Log.w("WaveWalletApp", "Pairing store unavailable at startup: ${it.message}") }
    }
}
