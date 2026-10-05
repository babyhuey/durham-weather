package app.durhamweather

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AlertsTest {
    private fun fixture(name: String) = JSONObject(javaClass.classLoader!!.getResource(name).readText())

    private val features = fixture("alerts.json").getJSONArray("features")
    private val advisory = "urn:oid:2.49.0.1.840.0.2ec9803dbea4b774a0cc081c7640d75ab17c11d5.001.1"
    private val warning = "urn:oid:2.49.0.1.840.0.4c60c77291886e4de9a704e959e0f7f1f5ce3a44.001.1"

    @Test
    fun skipsCancelsAndTests() {
        val (fresh, updates) = newAlerts(features, emptySet())
        assertEquals(listOf(advisory, warning), fresh.map { it.id })
        assertEquals(emptyList<String>(), updates.map { it.id })
    }

    @Test
    fun skipsAlertsAlreadySent() {
        val (fresh, _) = newAlerts(features, setOf(advisory))
        assertEquals(listOf(warning), fresh.map { it.id })
    }

    @Test
    fun recordsButDoesNotResendUpdatesToSentAlerts() {
        val original = features.getJSONObject(1).getJSONObject("properties")
            .getJSONArray("references").getJSONObject(0).getString("identifier")
        val (fresh, updates) = newAlerts(features, setOf(original))
        assertEquals(listOf(advisory), fresh.map { it.id })
        assertEquals(listOf(warning), updates.map { it.id })
    }

    @Test
    fun readsExpiry() {
        val (fresh, _) = newAlerts(features, emptySet())
        assertEquals(java.time.OffsetDateTime.parse("2026-10-05T15:00:00-04:00").toInstant().toEpochMilli(), fresh[0].expires)
        assertEquals("Flood Advisory", fresh[0].event)
    }

    @Test
    fun quartersStartAtTheCurrentQuarter() {
        val om = fixture("open-meteo.json")
        val first = om.getJSONObject("minutely_15").getJSONArray("time").getLong(0) * 1000
        val q = quarters(om, first + 20 * 60_000L)
        assertEquals(first + 15 * 60_000L, q.first().start)
        assertEquals(6, q.size)
    }

    private fun q(vararg mm: Double) = mm.mapIndexed { i, v -> Quarter(i * 900_000L, v) }

    @Test
    fun rainStartsWithinTheHour() {
        assertEquals(2 * 900_000L, rainStart(q(0.0, 0.05, 0.3, 1.0, 0.0)))
        assertEquals(4 * 900_000L, rainStart(q(0.0, 0.0, 0.0, 0.0, 0.1)))
    }

    @Test
    fun noRainNoticeWhenAlreadyRainingOrDryAllHour() {
        assertNull(rainStart(q(0.2, 0.5, 0.5)))
        assertNull(rainStart(q(0.0, 0.0, 0.0, 0.0, 0.0, 2.0)))
        assertNull(rainStart(emptyList()))
    }
}
