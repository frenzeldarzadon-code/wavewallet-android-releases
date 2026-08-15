package com.wavewallet.gcashlistener

import android.app.Application
import com.wavewallet.gcashlistener.store.PairingStore
import com.wavewallet.gcashlistener.work.ListenerScheduler

class WaveWalletApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if (PairingStore(this).isPaired) ListenerScheduler.scheduleHeartbeat(this)
    }
}
