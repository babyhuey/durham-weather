package app.durhamweather

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdatesTest {
    private val releases = JSONArray(javaClass.classLoader!!.getResource("releases.json").readText())

    @Test
    fun offersTheNewestReleaseAsItsApk() {
        val r = newerRelease(releases, "0.1.4")!!
        assertEquals("0.1.6", r.version)
        assertEquals("https://github.com/babyhuey/durham-weather/releases/download/v0.1.6/durham-weather-0.1.6.apk", r.url)
    }

    @Test
    fun nothingWhenUpToDate() {
        assertNull(newerRelease(releases, "0.1.6"))
        assertNull(newerRelease(releases, "0.2.0"))
    }

    @Test
    fun comparesVersionsNumerically() {
        assertTrue(newer(parseVersion("v0.1.10")!!, parseVersion("0.1.9")!!))
        assertFalse(newer(parseVersion("0.1")!!, parseVersion("0.1.0")!!))
        assertNull(parseVersion("v0.2.0-beta"))
    }

    @Test
    fun skipsDraftsAndFallsBackToTheReleasePage() {
        val list = JSONArray()
            .put(JSONObject().put("tag_name", "v0.3.0").put("draft", true).put("html_url", "draft"))
            .put(JSONObject().put("tag_name", "v0.2.0").put("html_url", "page"))
        assertEquals("page", newerRelease(list, "0.1.6")!!.url)
    }
}
