package com.wavewallet.gcashlistener

import android.app.Application
import android.util.Log
import com.wavewallet.gcashlistener.store.PairingStore
import com.wavewallet.gcashlistener.work.ListenerScheduler

class WaveWalletApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // The encrypted pairing store needs a working Android Keystore. Never let
        // an unavailable keystore crash app startup — the UI reports "not paired".
        runCatching {
            if (PairingStore(this).isPaired) ListenerScheduler.scheduleHeartbeat(this)
        }.onFailure { Log.w("WaveWalletApp", "Pairing store unavailable at startup: ${it.message}") }
    }
}
