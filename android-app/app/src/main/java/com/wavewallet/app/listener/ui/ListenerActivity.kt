package com.wavewallet.app.listener.ui

import android.content.ComponentName
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.wavewallet.app.BuildConfig
import com.wavewallet.app.listener.crypto.EventUid
import com.wavewallet.app.listener.crypto.PairingCode
import com.wavewallet.app.listener.data.ListenerDb
import com.wavewallet.app.listener.data.QueuedEvent
import com.wavewallet.app.listener.net.ListenerClient
import com.wavewallet.app.listener.parser.GcashParser
import com.wavewallet.app.listener.service.GcashNotificationListener
import com.wavewallet.app.listener.service.ListenerForegroundService
import com.wavewallet.app.listener.store.PairingStore
import com.wavewallet.app.listener.util.LastStatus
import com.wavewallet.app.listener.work.ListenerScheduler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ListenerActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Android 13+ hides the persistent "listener active" notification until
        // POST_NOTIFICATIONS is granted, which makes ColorOS far more likely to
        // freeze the process. Ask once; denial never blocks the listener.
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            runCatching {
                if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
                    android.content.pm.PackageManager.PERMISSION_GRANTED
                ) {
                    requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1001)
                }
            }
        }
        setContent { MaterialTheme { Surface { HomeScreen() } } }
    }
}

@Composable
private fun HomeScreen() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val store = remember { PairingStore(context) }
    val dao = remember { ListenerDb.get(context).events() }

    var paired by remember { mutableStateOf(store.isPaired) }
    // A phone that was paired before keeps its device id, so re-pairing only
    // needs the fresh one-time code an admin issues in WaveWallet.
    var knownDeviceId by remember { mutableStateOf(store.lastKnownDeviceId) }
    var revoked by remember { mutableStateOf(store.revokedByServer) }
    var deviceId by remember { mutableStateOf("") }
    var secret by remember { mutableStateOf("") }
    var baseUrl by remember { mutableStateOf(store.baseUrl) }
    var access by remember { mutableStateOf(LastStatus.hasNotificationAccess(context)) }
    var status by remember { mutableStateOf(LastStatus.snapshot(context)) }
    var message by remember { mutableStateOf<String?>(null) }

    val queued by dao.pendingCount().collectAsState(initial = 0)
    val recent by dao.recent().collectAsState(initial = emptyList())

    var connected by remember { mutableStateOf(LastStatus.isListenerConnected(context)) }

    LaunchedEffect(Unit) {
        access = LastStatus.hasNotificationAccess(context)
        status = LastStatus.snapshot(context)
        connected = LastStatus.isListenerConnected(context)
        revoked = store.revokedByServer
        knownDeviceId = store.lastKnownDeviceId
        if (paired && !store.revokedByServer && access) {
            ListenerForegroundService.start(context)
            // Android can leave the listener unbound while the foreground
            // service runs. Asking for a rebind reconnects it and triggers a
            // fresh sweep of the notifications still on the status bar.
            runCatching {
                NotificationListenerService.requestRebind(
                    ComponentName(context, GcashNotificationListener::class.java),
                )
            }
        }
    }

    val ready = paired && !revoked && access && connected

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("WaveWallet GCash Listener", style = MaterialTheme.typography.headlineSmall)
        Text(
            if (ready) "Status: LISTENING — listener CONNECTED"
            else "Status: NOT READY — " + listOfNotNull(
                if (revoked) "device revoked — re-pair it below" else if (!paired) "device not paired" else null,
                if (!access) "Notification Access not granted" else null,
                if (access && !connected) "Notification Access granted but the listener is NOT connected" else null,
            ).joinToString(" and "),
            fontWeight = FontWeight.SemiBold,
        )

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("1. Pair device", fontWeight = FontWeight.SemiBold)
                if (paired && !revoked) {
                    Text("Paired as device ${store.deviceId}")
                    Text("Server: ${store.baseUrl}")
                    Text("The pairing secret is stored encrypted and is never shown again.")
                    OutlinedButton(onClick = {
                        store.unpair(); paired = false; knownDeviceId = store.lastKnownDeviceId
                    }) { Text("Unpair") }
                } else if (knownDeviceId != null) {
                    Text(
                        if (revoked) "This device was revoked in WaveWallet."
                        else "This device is not paired right now.",
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text("Device: $knownDeviceId")
                    Text("Server: ${store.baseUrl}")
                    Text(
                        "Ask a WaveWallet Super Admin — or your shop's admin — to open Settings > " +
                            "GCash notification listener and tap \"Re-pair this device\". They will " +
                            "read you a new one-time code. The old code no longer works.",
                    )
                    OutlinedTextField(
                        secret, { secret = it },
                        label = { Text("New one-time pairing code (or paste \"Copy both\")") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Button(
                        enabled = secret.isNotBlank(),
                        onClick = {
                            if (store.repair(PairingCode.secretOf(secret))) {
                                secret = ""
                                paired = true
                                revoked = false
                                store.revokedByServer = false
                                knownDeviceId = store.lastKnownDeviceId
                                ListenerScheduler.scheduleHeartbeat(context)
                                message = "Re-paired. Code discarded from memory."
                            } else {
                                message = "No device is known on this phone yet — pair it first."
                            }
                        },
                    ) { Text("Re-pair this device") }
                    OutlinedButton(onClick = {
                        store.forgetDevice()
                        paired = false; revoked = false; knownDeviceId = null
                    }) { Text("Pair a different device instead") }
                } else {
                    Text(
                        "Moving from the separate \"WaveWallet Listener\" app? Pairing cannot be " +
                            "copied between apps. Ask WaveWallet for a new device pairing code, pair " +
                            "here, then uninstall the old listener app.",
                    )
                    OutlinedTextField(baseUrl, { baseUrl = it }, label = { Text("WaveWallet URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Text(
                        "Tip: in WaveWallet tap \"Copy both (one paste)\" and paste that single " +
                            "value into either field below — the Device ID and the code are filled in " +
                            "automatically.",
                    )
                    OutlinedTextField(
                        deviceId,
                        { input ->
                            val combined = PairingCode.parse(input)
                            if (combined != null) {
                                deviceId = combined.deviceId; secret = combined.secret
                            } else {
                                deviceId = input
                            }
                        },
                        label = { Text("Device ID (or paste \"Copy both\" value)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        secret,
                        { input ->
                            val combined = PairingCode.parse(input)
                            if (combined != null) {
                                deviceId = combined.deviceId; secret = combined.secret
                            } else {
                                secret = input
                            }
                        },
                        label = { Text("Pairing secret (one time)") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Button(
                        enabled = deviceId.isNotBlank() && secret.isNotBlank(),
                        onClick = {
                            store.pair(deviceId, secret, baseUrl)
                            secret = ""; deviceId = ""
                            paired = true
                            knownDeviceId = store.lastKnownDeviceId
                            ListenerScheduler.scheduleHeartbeat(context)
                            message = "Paired. Secret discarded from memory."
                        },
                    ) { Text("Pair") }
                }
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("2. Notification Access", fontWeight = FontWeight.SemiBold)
                Text(if (access) "Granted — only ${BuildConfig.GCASH_PACKAGE} notifications are read." else "Not granted. The listener cannot work yet.")
                OutlinedButton(onClick = {
                    context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                }) { Text("Open Notification Access settings") }
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("3. Oppo / ColorOS checklist", fontWeight = FontWeight.SemiBold)
                Text("• Notification Access: granted for WaveWallet Listener")
                Text("• Allow notifications for this app (Android 13+)")
                Text("• Battery: set this app to \"Allow background activity\" / \"Don't optimise\"")
                Text("• Settings > Battery > Power saving: disable \"Sleep standby optimisation\"")
                Text("• Enable \"Auto-launch\" and \"Allow background running\" in App management")
                Text("• Lock the app in Recents (swipe down on the card > Lock)")
                Text("• Keep the persistent \"listener active\" notification enabled")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                    }) { Text("Battery settings") }
                    OutlinedButton(onClick = {
                        context.startActivity(
                            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName)),
                        )
                    }) { Text("App info") }
                }
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Diagnostics", fontWeight = FontWeight.SemiBold)
                Text("Notification Access: " + if (access) "granted" else "NOT granted")
                Text("Listener service: ${status["listener"]}")
                Text("Foreground service: ${status["foreground"]} (not proof of connection)")
                Text("Last GCash notification received: ${status["lastReceived"]} (${status["lastReceivedAt"]})")
                Text("GCash notifications received in total: ${status["receivedCount"]}")
                Text("Last parser result: ${status["lastParse"]} (${status["lastParseAt"]})")
                Text("Last recovery sweep: ${status["lastSweep"]} (${status["lastSweepAt"]})")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        runCatching {
                            NotificationListenerService.requestRebind(
                                ComponentName(context, GcashNotificationListener::class.java),
                            )
                        }
                        message = "Reconnect requested. The listener re-scans active notifications on connect."
                        status = LastStatus.snapshot(context)
                        connected = LastStatus.isListenerConnected(context)
                    }, enabled = access) { Text("Reconnect & re-scan") }
                    OutlinedButton(onClick = {
                        access = LastStatus.hasNotificationAccess(context)
                        status = LastStatus.snapshot(context)
                        connected = LastStatus.isListenerConnected(context)
                    }) { Text("Refresh status") }
                }
                Text("Activity", fontWeight = FontWeight.SemiBold)
                Text("Last notification read: ${status["lastNotification"]} (${status["lastNotificationAt"]})")
                Text("Last event sent: ${status["lastSent"]} (${status["lastSentAt"]})")
                Text("Last server response: ${status["lastResponse"]}")
                Text("Heartbeat: ${status["heartbeat"]}")
                Text("Queued events waiting to send: $queued")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        scope.launch {
                            val outcome = withContext(Dispatchers.IO) { ListenerClient(store).heartbeat() }
                            LastStatus.recordHeartbeat(context, outcome.ok, "${outcome.code} ${outcome.body}")
                            status = LastStatus.snapshot(context)
                            message = if (outcome.ok) "Heartbeat OK" else "Heartbeat failed: ${outcome.code}"
                        }
                    }, enabled = paired) { Text("Send heartbeat") }

                    OutlinedButton(onClick = {
                        scope.launch {
                            val now = System.currentTimeMillis()
                            val raw = "WAVEWALLET TEST EVENT — not a payment, no amount, cannot credit any wallet."
                            val event = QueuedEvent(
                                eventUid = EventUid.of("wavewallet-test", now, raw),
                                packageName = BuildConfig.GCASH_PACKAGE,
                                postedAt = now,
                                amountPhp = null, // null amount => server records it as unparsed, never matched
                                senderNumber = null,
                                senderName = null,
                                rawText = raw,
                                parserVersion = GcashParser.VERSION,
                                status = "queued",
                                isTest = true,
                            )
                            withContext(Dispatchers.IO) { dao.insertIfNew(event) }
                            ListenerScheduler.syncNow(context)
                            message = "Test event queued. It carries no amount, so it can never approve a Cash In."
                        }
                    }, enabled = paired) { Text("Send test event") }
                }
                message?.let { Text(it) }
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Recent events", fontWeight = FontWeight.SemiBold)
                if (recent.isEmpty()) Text("Nothing captured yet.")
                recent.forEach { e ->
                    Text(
                        buildString {
                            append(if (e.isTest) "[TEST] " else "")
                            append(e.amountPhp?.let { "PHP %.2f".format(it) } ?: "unparsed")
                            e.senderNumber?.let { append(" · $it") }
                            append(" · ${e.status}")
                            e.lastError?.let { append(" · $it") }
                        },
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}
