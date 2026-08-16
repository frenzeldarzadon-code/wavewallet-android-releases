package com.wavewallet.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUrlTest {
    @Test
    fun `app url points at the published wavewallet site`() {
        assertEquals("https://wallet.sagadawave.com", BuildConfig.APP_URL)
        assertTrue(BuildConfig.APP_URL.startsWith("https://"))
    }

    @Test
    fun `application id is stable for install-over updates`() {
        assertTrue(BuildConfig.APPLICATION_ID.startsWith("com.wavewallet.app"))
    }
}
