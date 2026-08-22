package com.wavewallet.app.listener.source

import android.content.Context
import org.json.JSONArray

/**
 * Notification-source allow/deny rules, mirrored from WaveWallet.
 *
 * This is an optimisation and privacy layer only: the server re-applies exactly
 * the same decision in `listener_source_allowed` for every event it receives.
 * The phone applies it first so the content of a disabled app never leaves the
 * device.
 *
 * Precedence (identical to the server):
 *   device rule > shop rule > platform rule
 *   inside one scope: exact package beats the `*` wildcard, and `allow` beats `deny`
 *
 * Safe default: with no rules at all, every source is ALLOWED. Installations
 * that never configured anything keep reading GCash exactly as before, and a
 * failed rules fetch can never silently disable a working listener — only rules
 * that were successfully fetched (and cached) can deny a source.
 */
data class SourceRule(val packageName: String, val mode: String, val scope: String)

object SourceRules {

    private const val PREFS = "listener_source_rules"
    private const val KEY_JSON = "rules_json"
    private const val KEY_FETCHED_AT = "fetched_at"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Decision for one package against a rule set. No rules ⇒ allowed. */
    fun allows(rules: List<SourceRule>, packageName: String): Boolean {
        val pkg = packageName.trim().lowercase()
        if (pkg.isEmpty()) return true
        val applicable = rules.filter {
            val rulePkg = it.packageName.trim().lowercase()
            rulePkg == "*" || rulePkg == pkg
        }
        val best = applicable.maxWithOrNull(
            compareBy(
                { scopeRank(it.scope) },
                { if (it.packageName.trim() == "*") 0 else 1 },
                { if (it.mode.equals("allow", true)) 1 else 0 },
            ),
        ) ?: return true
        return best.mode.equals("allow", ignoreCase = true)
    }

    private fun scopeRank(scope: String) = when (scope.lowercase()) {
        "device" -> 3
        "shop", "ecosystem" -> 2
        else -> 1
    }

    /** Cached decision used by the notification listener on the hot path. */
    fun allows(context: Context, packageName: String): Boolean =
        allows(cached(context), packageName)

    fun cached(context: Context): List<SourceRule> =
        parse(prefs(context).getString(KEY_JSON, null))

    fun lastFetchedAt(context: Context): Long = prefs(context).getLong(KEY_FETCHED_AT, 0)

    /** Replaces the cache. Only ever called with a successful server answer. */
    fun store(context: Context, json: String) {
        prefs(context).edit()
            .putString(KEY_JSON, json)
            .putLong(KEY_FETCHED_AT, System.currentTimeMillis())
            .apply()
    }

    /** Parses the `rules` array of the ingest endpoint's source_rules answer. */
    fun parse(json: String?): List<SourceRule> {
        if (json.isNullOrBlank()) return emptyList()
        return runCatching {
            val array = JSONArray(json)
            (0 until array.length()).mapNotNull { i ->
                val o = array.optJSONObject(i) ?: return@mapNotNull null
                val pkg = o.optString("package_name").trim()
                val mode = o.optString("mode").trim()
                if (pkg.isEmpty() || mode.isEmpty()) return@mapNotNull null
                SourceRule(pkg, mode, o.optString("scope", "platform"))
            }
        }.getOrDefault(emptyList())
    }

    /** Extracts the `rules` array out of a full response body. */
    fun rulesArrayOf(responseBody: String): String? = runCatching {
        val obj = org.json.JSONObject(responseBody)
        if (!obj.optBoolean("accepted", false)) null else obj.optJSONArray("rules")?.toString()
    }.getOrNull()

    /** Human-readable summary for the diagnostics screen. */
    fun summary(context: Context): String {
        val rules = cached(context)
        if (rules.isEmpty()) return "no rules — every source Android grants is allowed"
        val denied = rules.count { it.mode.equals("deny", true) }
        return "${rules.size} rule(s) · $denied deny · ${rules.size - denied} allow"
    }
}
