package com.wavewallet.app.listener.store

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.wavewallet.app.BuildConfig
import com.wavewallet.app.listener.crypto.ListenerSigner

/**
 * Android Keystore-backed storage for the pairing material.
 *
 * Only the derived HMAC key is persisted — the human-readable pairing secret is
 * consumed at pairing time and never written to disk, never logged, and never
 * shown again in the UI.
 */
class PairingStore(context: Context) {

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "wavewallet_pairing",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    val isPaired: Boolean get() = deviceId != null && hmacKey != null

    var deviceId: String?
        get() = prefs.getString(KEY_DEVICE, null)
        private set(value) = prefs.edit().putString(KEY_DEVICE, value).apply()

    var baseUrl: String
        get() = prefs.getString(KEY_BASE_URL, BuildConfig.DEFAULT_BASE_URL) ?: BuildConfig.DEFAULT_BASE_URL
        set(value) = prefs.edit().putString(KEY_BASE_URL, value.trimEnd('/')).apply()

    internal val hmacKey: String? get() = prefs.getString(KEY_HMAC, null)

    /** Stores the derived key. The raw [pairingSecret] is discarded immediately. */
    fun pair(deviceId: String, pairingSecret: String, baseUrl: String) {
        prefs.edit()
            .putString(KEY_DEVICE, deviceId.trim())
            .putString(KEY_HMAC, ListenerSigner.deriveHmacKey(pairingSecret.trim()))
            .putString(KEY_BASE_URL, baseUrl.trim().trimEnd('/'))
            .apply()
    }

    fun unpair() = prefs.edit().remove(KEY_DEVICE).remove(KEY_HMAC).apply()

    private companion object {
        const val KEY_DEVICE = "device_id"
        const val KEY_HMAC = "hmac_key"
        const val KEY_BASE_URL = "base_url"
    }
}
