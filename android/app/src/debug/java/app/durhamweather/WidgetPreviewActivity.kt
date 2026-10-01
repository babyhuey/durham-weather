package app.durhamweather

import android.app.Activity
import android.os.Bundle
import android.util.TypedValue
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.RemoteViews
import android.widget.TextView

// Renders the widget layout at fixed sizes so short launcher rows can be checked without a launcher.
class WidgetPreviewActivity : Activity() {
    private val sample = Snapshot(
        tempF = 77, kind = "clear-day", lowF = 63, savedAt = System.currentTimeMillis(),
        days = listOf(
            Day("THU", "partly-day", 63, 87), Day("FRI", "clear-day", 67, 90), Day("SAT", "partly-rain", 62, 80),
            Day("SUN", "storm", 62, 72), Day("MON", "partly-rain", 53, 75), Day("TUE", "clear-day", 47, 68),
        ),
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dp = { v: Int -> TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt() }
        val list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(8), dp(48), dp(8), dp(8))
        }
        for (height in listOf(44, 52, 60, 72, 90)) {
            list.addView(TextView(this).apply { text = "${height}dp"; setTextColor(0xFFFFFFFF.toInt()) })
            val frame = FrameLayout(this)
            list.addView(frame, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(height)).apply { bottomMargin = dp(8) })
            val views = RemoteViews(packageName, R.layout.widget)
            ForecastWidget.fill(this, views, sample, 6)
            frame.addView(views.apply(this, frame))
        }
        list.setBackgroundColor(0xFF101010.toInt())
        setContentView(list)
    }
}
