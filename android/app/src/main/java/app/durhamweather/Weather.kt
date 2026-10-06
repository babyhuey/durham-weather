package app.durhamweather

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.OffsetDateTime
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sqrt

const val API = "https://api.weather.gov"
private const val PREFS = "weather"

// Fallback when the app has never had a location fix: ZIP 27712, same as the web app.
val HOME = 36.091 to -78.902

class HttpException(val status: Int, val url: String) : Exception("HTTP $status from $url")

data class Day(val label: String, val kind: String, val low: Int?, val high: Int?)

data class Snapshot(
    val tempF: Int?,
    val kind: String,
    val lowF: Int?,
    val days: List<Day>,
    val savedAt: Long,
) {
    fun toJson(): String = JSONObject()
        .put("tempF", tempF ?: JSONObject.NULL)
        .put("kind", kind)
        .put("lowF", lowF ?: JSONObject.NULL)
        .put("savedAt", savedAt)
        .put("days", JSONArray(days.map {
            JSONObject().put("label", it.label).put("kind", it.kind)
                .put("low", it.low ?: JSONObject.NULL).put("high", it.high ?: JSONObject.NULL)
        }))
        .toString()

    companion object {
        fun fromJson(s: String): Snapshot {
            val o = JSONObject(s)
            val days = o.getJSONArray("days")
            return Snapshot(
                tempF = o.optIntOrNull("tempF"),
                kind = o.getString("kind"),
                lowF = o.optIntOrNull("lowF"),
                savedAt = o.getLong("savedAt"),
                days = (0 until days.length()).map { i ->
                    val d = days.getJSONObject(i)
                    Day(d.getString("label"), d.getString("kind"), d.optIntOrNull("low"), d.optIntOrNull("high"))
                },
            )
        }
    }
}

private fun JSONObject.optIntOrNull(key: String): Int? = if (isNull(key)) null else getInt(key)

// Port of weatherKind() in public/icons.js, folded down to the widget's icon set.
fun weatherKind(text: String, isDay: Boolean): String {
    val t = text.lowercase()
    return when {
        Regex("thunder|t-storm").containsMatchIn(t) -> "storm"
        Regex("snow|flurr|blizzard|sleet|freezing|ice|wintry").containsMatchIn(t) -> "snow"
        Regex("rain|shower|drizzle").containsMatchIn(t) ->
            if (isDay && Regex("chance|isolated|scattered").containsMatchIn(t)) "partly-rain" else "rain"
        Regex("fog|haze|smoke|mist").containsMatchIn(t) -> "fog"
        Regex("partly|mostly sunny|mostly clear").containsMatchIn(t) -> if (isDay) "partly-day" else "partly-night"
        Regex("cloudy|overcast").containsMatchIn(t) -> "cloudy"
        else -> if (isDay) "clear-day" else "clear-night"
    }
}

object Weather {
    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // Returns whether the rounded position actually moved.
    fun saveLocation(ctx: Context, lat: Double, lon: Double): Boolean {
        val p = prefs(ctx)
        val (newLat, newLon) = round3(lat).toString() to round3(lon).toString()
        if (p.getString("lat", null) == newLat && p.getString("lon", null) == newLon) return false
        p.edit().putString("lat", newLat).putString("lon", newLon).apply()
        return true
    }

    fun cached(ctx: Context): Snapshot? =
        prefs(ctx).getString("snapshot", null)?.let { runCatching { Snapshot.fromJson(it) }.getOrNull() }

    // Returns null when the location changed mid-fetch; a newer refresh owns the snapshot then.
    fun refresh(ctx: Context): Snapshot? {
        val p = prefs(ctx)
        val lat = p.getString("lat", null)?.toDouble() ?: HOME.first
        val lon = p.getString("lon", null)?.toDouble() ?: HOME.second
        val where = "$lat,$lon"
        // weather.gov only covers the US; elsewhere fall back to the home forecast like the web app.
        // A position NWS doesn't cover is remembered for a day so refreshes skip the failing lookup.
        val outside = p.getString("outside", null) == where &&
            System.currentTimeMillis() - p.getLong("outsideAt", 0) < 24 * 3_600_000L
        val meta = if (outside) meta(ctx, HOME.first, HOME.second) else try {
            meta(ctx, lat, lon)
        } catch (e: HttpException) {
            if (e.status != 404 || !e.url.startsWith("$API/points/")) throw e
            p.edit().putString("outside", where).putLong("outsideAt", System.currentTimeMillis()).apply()
            meta(ctx, HOME.first, HOME.second)
        }
        val periods = get(meta.getString("forecast")).getJSONObject("properties").getJSONArray("periods")
        val snap = build(periods, current(meta, periods))
        synchronized(this) {
            val now = "${p.getString("lat", null)?.toDouble() ?: HOME.first},${p.getString("lon", null)?.toDouble() ?: HOME.second}"
            if (now != where) return null
            p.edit().putString("snapshot", snap.toJson()).apply()
        }
        return snap
    }

    // One cached lookup, replaced whenever the location changes.
    private fun meta(ctx: Context, lat: Double, lon: Double): JSONObject {
        val key = "$lat,$lon"
        prefs(ctx).getString("meta", null)?.let { JSONObject(it) }?.takeIf { it.optString("key") == key }?.let { return it }
        val points = get("$API/points/$lat,$lon").getJSONObject("properties")
        val stations = get(points.getString("observationStations")).getJSONArray("features")
        val meta = JSONObject()
            .put("key", key)
            .put("forecast", points.getString("forecast"))
            .put("hourly", points.getString("forecastHourly"))
            .put("station", nearestStation(stations, lat, lon))
        prefs(ctx).edit().putString("meta", meta.toString()).apply()
        return meta
    }

    // Mirrors currentConditions(): a station reading under 90 minutes old, else the hourly forecast.
    private fun current(meta: JSONObject, periods: JSONArray): Pair<Int?, String> {
        val obs = runCatching {
            get("$API/stations/${meta.getString("station")}/observations/latest").getJSONObject("properties")
        }.getOrNull()
        val c = obs?.optJSONObject("temperature")?.let { if (it.isNull("value")) null else it.getDouble("value") }
        val fresh = obs != null && c != null &&
            System.currentTimeMillis() - OffsetDateTime.parse(obs.getString("timestamp")).toInstant().toEpochMilli() < 90 * 60_000
        val hourly = runCatching { currentPeriod(get(meta.getString("hourly")).getJSONObject("properties").getJSONArray("periods")) }
            .getOrNull() ?: periods.getJSONObject(0)
        if (fresh) {
            val text = if (obs!!.isNull("textDescription")) "" else obs.optString("textDescription")
            return (c!! * 9 / 5 + 32).roundToInt() to text.ifBlank { hourly.getString("shortForecast") }
        }
        return hourly.optIntOrNull("temperature") to hourly.getString("shortForecast")
    }

    // The hourly period covering now; NWS sometimes serves a product whose first hour is already past.
    private fun currentPeriod(periods: JSONArray): JSONObject {
        val now = System.currentTimeMillis()
        val all = (0 until periods.length()).map { periods.getJSONObject(it) }
        return all.firstOrNull {
            val start = OffsetDateTime.parse(it.getString("startTime")).toInstant().toEpochMilli()
            val end = OffsetDateTime.parse(it.getString("endTime")).toInstant().toEpochMilli()
            now in start until end
        } ?: all.first()
    }

    // Each day column is a daytime period paired with the night that follows it (WED 66/80 = Wed night low / Wed high).
    private fun build(periods: JSONArray, now: Pair<Int?, String>): Snapshot {
        val list = (0 until periods.length()).map { periods.getJSONObject(it) }
        val isDay = list.first().getBoolean("isDaytime")
        val days = list.withIndex().filter { it.value.getBoolean("isDaytime") }.take(6).map { (i, p) ->
            val night = list.getOrNull(i + 1)?.takeIf { !it.getBoolean("isDaytime") }
            Day(
                label = OffsetDateTime.parse(p.getString("startTime")).dayOfWeek
                    .getDisplayName(TextStyle.SHORT, Locale.US).uppercase(),
                kind = weatherKind(p.getString("shortForecast"), true),
                low = night?.optIntOrNull("temperature"),
                high = p.optIntOrNull("temperature"),
            )
        }
        return Snapshot(
            tempF = now.first,
            kind = weatherKind(now.second, isDay),
            lowF = list.firstOrNull { !it.getBoolean("isDaytime") }?.optIntOrNull("temperature"),
            days = days,
            savedAt = System.currentTimeMillis(),
        )
    }

    private fun nearestStation(stations: JSONArray, lat: Double, lon: Double): String {
        val k = cos(Math.toRadians(lat))
        return (0 until stations.length()).map { stations.getJSONObject(it) }.minBy {
            val c = it.getJSONObject("geometry").getJSONArray("coordinates")
            val dx = (c.getDouble(0) - lon) * k
            val dy = c.getDouble(1) - lat
            sqrt(dx * dx + dy * dy)
        }.getJSONObject("properties").getString("stationIdentifier")
    }

    private fun round3(v: Double) = (v * 1000).roundToInt() / 1000.0

    fun get(url: String): JSONObject = JSONObject(text(url, "application/geo+json"))

    fun text(url: String, accept: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        // weather.gov and GitHub both reject requests without a User-Agent.
        conn.setRequestProperty("User-Agent", "DurhamWeather Android (github.com/babyhuey/durham-weather)")
        conn.setRequestProperty("Accept", accept)
        try {
            if (conn.responseCode !in 200..299) throw HttpException(conn.responseCode, url)
            return conn.inputStream.bufferedReader().readText()
        } finally {
            conn.disconnect()
        }
    }
}
