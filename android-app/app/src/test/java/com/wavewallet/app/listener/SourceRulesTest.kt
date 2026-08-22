package com.wavewallet.app.listener

import com.wavewallet.app.listener.source.SourceRule
import com.wavewallet.app.listener.source.SourceRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The phone must reach exactly the same verdict as listener_source_allowed.
 *
 * Runs under Robolectric like the other listener tests: SourceRules.parse()
 * uses android's org.json, which is an empty stub in a plain JVM unit test
 * (unitTests.isReturnDefaultValues = true), so parsing would silently yield an
 * empty rule set. Robolectric supplies the real implementation.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class, sdk = [34])
class SourceRulesTest {


    private val gcash = "com.globe.gcash.android"

    @Test
    fun `no rules allows every source`() {
        assertTrue(SourceRules.allows(emptyList(), gcash))
        assertTrue(SourceRules.allows(emptyList(), "com.example.other"))
    }

    @Test
    fun `platform deny blocks the source`() {
        val rules = listOf(SourceRule("com.example.spam", "deny", "platform"))
        assertFalse(SourceRules.allows(rules, "com.example.spam"))
        assertTrue(SourceRules.allows(rules, gcash))
    }

    @Test
    fun `device rule beats shop rule`() {
        val rules = listOf(
            SourceRule(gcash, "deny", "shop"),
            SourceRule(gcash, "allow", "device"),
        )
        assertTrue(SourceRules.allows(rules, gcash))
    }

    @Test
    fun `exact package beats wildcard in the same scope`() {
        val rules = listOf(
            SourceRule("*", "deny", "shop"),
            SourceRule(gcash, "allow", "shop"),
        )
        assertTrue(SourceRules.allows(rules, gcash))
        assertFalse(SourceRules.allows(rules, "com.example.other"))
    }

    @Test
    fun `allow wins over deny inside one scope`() {
        val rules = listOf(
            SourceRule(gcash, "deny", "shop"),
            SourceRule(gcash, "allow", "shop"),
        )
        assertTrue(SourceRules.allows(rules, gcash))
    }

    @Test
    fun `parses the server answer`() {
        val parsed = SourceRules.parse(
            """[{"package_name":"com.globe.gcash.android","mode":"deny","scope":"device"}]""",
        )
        assertEquals(1, parsed.size)
        assertFalse(SourceRules.allows(parsed, gcash))
    }

    @Test
    fun `unparseable payloads are ignored, never treated as a deny`() {
        assertTrue(SourceRules.allows(SourceRules.parse("not json"), gcash))
        assertTrue(SourceRules.allows(SourceRules.parse(null), gcash))
    }
}
