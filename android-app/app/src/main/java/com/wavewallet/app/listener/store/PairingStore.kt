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

    /**
     * The device id of the last pairing on this phone, kept after an unpair or a
     * revoke so the operator never has to retype it. It is an identifier only —
     * on its own it grants nothing, because the credential is gone.
     */
    val lastKnownDeviceId: String? get() = deviceId ?: prefs.getString(KEY_LAST_DEVICE, null)

    /** WaveWallet answered that this device was revoked. Needs a fresh code. */
    var revokedByServer: Boolean
        get() = prefs.getBoolean(KEY_REVOKED, false)
        set(value) = prefs.edit().putBoolean(KEY_REVOKED, value).apply()

    var baseUrl: String
        get() = prefs.getString(KEY_BASE_URL, BuildConfig.DEFAULT_BASE_URL) ?: BuildConfig.DEFAULT_BASE_URL
        set(value) = prefs.edit().putString(KEY_BASE_URL, value.trimEnd('/')).apply()

    internal val hmacKey: String? get() = prefs.getString(KEY_HMAC, null)

    /** Stores the derived key. The raw [pairingSecret] is discarded immediately. */
    fun pair(deviceId: String, pairingSecret: String, baseUrl: String) {
        prefs.edit()
            .putString(KEY_DEVICE, deviceId.trim())
            .putString(KEY_LAST_DEVICE, deviceId.trim())
            .putString(KEY_HMAC, ListenerSigner.deriveHmacKey(pairingSecret.trim()))
            .putString(KEY_BASE_URL, baseUrl.trim().trimEnd('/'))
            .putBoolean(KEY_REVOKED, false)
            .apply()
    }

    /**
     * Re-pairs the device this phone already knows with a freshly issued one-time
     * secret. Fails when no previous device id is retained.
     */
    fun repair(pairingSecret: String, baseUrl: String = this.baseUrl): Boolean {
        val known = lastKnownDeviceId ?: return false
        pair(known, pairingSecret, baseUrl)
        return true
    }

    /** Drops the credential. The device id is retained for easy re-pairing. */
    fun unpair() = prefs.edit().remove(KEY_DEVICE).remove(KEY_HMAC).apply()

    /** Forgets the retained device id too, so a different device can be paired. */
    fun forgetDevice() = prefs.edit()
        .remove(KEY_DEVICE).remove(KEY_HMAC).remove(KEY_LAST_DEVICE).remove(KEY_REVOKED).apply()

    private companion object {
        const val KEY_DEVICE = "device_id"
        const val KEY_LAST_DEVICE = "last_device_id"
        const val KEY_HMAC = "hmac_key"
        const val KEY_BASE_URL = "base_url"
        const val KEY_REVOKED = "revoked_by_server"
    }
}

