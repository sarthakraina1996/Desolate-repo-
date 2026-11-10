// Design tokens and shared components. The colours are the brief's exact tokens, the same
// ones the web app (styles.css) and the iOS app (Theme.swift) use.
package com.brainadz.events.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Shapes
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.brainadz.events.data.ApiException
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.launch

object C {
    val Canvas = Color(0xFFF5F4F0)
    val Surface = Color(0xFFFFFFFF)
    val Ink = Color(0xFF20262B)
    val Ink2 = Color(0xFF54615F)
    val Petrol = Color(0xFF1F5154)
    val Selected = Color(0xFFE8EFED)
    val Rule = Color(0xFFD9DEDA)
    val Control = Color(0xFF7A8580)
    val Ok = Color(0xFF2E6046)
    val OkBg = Color(0xFFE8F2EB)
    val Pending = Color(0xFF765018)
    val PendingBg = Color(0xFFF8EFD9)
    val Error = Color(0xFF963D34)
    val ErrorBg = Color(0xFFFAEDE9)
    val Neutral = Color(0xFFECEEEB)
}

private val scheme = lightColorScheme(
    primary = C.Petrol, onPrimary = Color.White, background = C.Canvas, onBackground = C.Ink,
    surface = C.Surface, onSurface = C.Ink, onSurfaceVariant = C.Ink2, surfaceVariant = C.Selected,
    outline = C.Control, outlineVariant = C.Rule, secondaryContainer = C.Selected, onSecondaryContainer = C.Petrol,
    error = C.Error, errorContainer = C.ErrorBg, onErrorContainer = C.Error,
)
// System font (Roboto) as the close fallback to IBM Plex Sans; sizes scale with the user's
// font size setting.
private val type = Typography(
    headlineLarge = TextStyle(fontSize = 30.sp, lineHeight = 34.sp, fontWeight = FontWeight.SemiBold),
    headlineSmall = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    labelLarge = TextStyle(fontSize = 16.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 13.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium, letterSpacing = 1.sp),
)

@Composable
fun EventsTheme(content: @Composable () -> Unit) = MaterialTheme(
    colorScheme = scheme,
    typography = type,
    shapes = Shapes(extraSmall = RoundedCornerShape(4.dp), small = RoundedCornerShape(6.dp), medium = RoundedCornerShape(8.dp), large = RoundedCornerShape(8.dp)),
    content = content,
)

// ---------- formatting ----------
private val IN = Locale("en", "IN")
private val IST = ZoneId.of("Asia/Kolkata")
fun inr(paise: Long): String = NumberFormat.getCurrencyInstance(IN).apply { maximumFractionDigits = if (paise % 100 == 0L) 0 else 2 }.format(paise / 100.0)
fun day(ymd: String): String = runCatching { LocalDate.parse(ymd).format(DateTimeFormatter.ofPattern("d MMM yyyy", IN)) }.getOrDefault(ymd)
fun weekday(ymd: String): String = runCatching { LocalDate.parse(ymd).format(DateTimeFormatter.ofPattern("EEEE, d MMMM", IN)) }.getOrDefault(ymd)
fun clock(iso: String?): String = iso?.let { runCatching { DateTimeFormatter.ofPattern("HH:mm").format(Instant.parse(it).atZone(IST)) }.getOrNull() } ?: ""
fun dateRange(from: String, to: String): String = if (from == to) day(from) else "${runCatching { LocalDate.parse(from).dayOfMonth.toString() }.getOrDefault(from)}–${day(to)}"

// ---------- messages ----------
// A one-line message shown at the bottom of the screen; screens call toast("…").
val LocalToast = staticCompositionLocalOf<(String) -> Unit> { {} }

// Runs a suspending action, shows its error, and reports whether it is running.
class Action(val busy: Boolean, val run: (suspend () -> Unit) -> Unit)
@Composable
fun rememberAction(): Action {
    val scope = rememberCoroutineScope()
    val toast = LocalToast.current
    var busy by remember { mutableStateOf(false) }
    return Action(busy) { block ->
        if (!busy) scope.launch {
            busy = true
            try {
                block()
            } catch (e: ApiException) {
                toast(e.message ?: "Something went wrong")
            }
            busy = false
        }
    }
}

// ---------- components ----------
enum class StatusTone(val fg: Color, val bg: Color, val icon: ImageVector?) {
    OK(C.Ok, C.OkBg, Icons.Outlined.CheckCircle),
    PENDING(C.Pending, C.PendingBg, Icons.Outlined.Schedule),
    ERROR(C.Error, C.ErrorBg, Icons.Outlined.ErrorOutline),
    NEUTRAL(C.Ink, C.Neutral, null),
}
// A state shown as icon and words on a tinted background; never colour alone.
@Composable
fun StatusChip(text: String, tone: StatusTone = StatusTone.NEUTRAL) {
    Row(
        Modifier.background(tone.bg, RoundedCornerShape(4.dp)).padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        tone.icon?.let { Icon(it, null, Modifier.size(15.dp), tint = tone.fg); Spacer(Modifier.width(4.dp)) }
        Text(text, color = tone.fg, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    }
}
fun toneOf(state: String): StatusTone = when (state) {
    "confirmed", "paid", "approved", "complete", "accepted", "printed", "active" -> StatusTone.OK
    "pending_review", "pending", "held", "awaiting_review", "submitted", "invited", "part_paid", "open", "unverified", "queued" -> StatusTone.PENDING
    "rejected", "cancelled", "failed", "changes_requested", "revoked" -> StatusTone.ERROR
    else -> StatusTone.NEUTRAL
}
fun labelOf(state: String): String = when (state) {
    "pending_review", "submitted", "awaiting_review" -> "Awaiting review"
    "changes_requested" -> "Changes requested"
    "part_paid" -> "Part paid"
    "open" -> "Unpaid"
    "todo" -> "To do"
    "accepted" -> "Signed in"
    else -> state.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

@Composable
fun Notice(text: String, tone: StatusTone = StatusTone.NEUTRAL, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().background(if (tone == StatusTone.NEUTRAL) C.Selected else tone.bg, RoundedCornerShape(6.dp)).padding(12.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        tone.icon?.let { Icon(it, null, Modifier.size(20.dp), tint = tone.fg); Spacer(Modifier.width(8.dp)) }
        Text(text, color = if (tone == StatusTone.NEUTRAL) C.Ink else tone.fg)
    }
}

// The one filled button on a screen. 48 dp tall for touch.
@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, busy: Boolean = false, onClick: () -> Unit) {
    Button(
        onClick, modifier.fillMaxWidth().heightIn(min = 52.dp), enabled = enabled && !busy, shape = RoundedCornerShape(6.dp),
        colors = ButtonDefaults.buttonColors(containerColor = C.Petrol),
    ) {
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
        else Text(text, style = MaterialTheme.typography.labelLarge)
    }
}
@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, icon: ImageVector? = null, onClick: () -> Unit) {
    OutlinedButton(
        onClick, modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = enabled, shape = RoundedCornerShape(6.dp),
        border = BorderStroke(1.dp, C.Control), colors = ButtonDefaults.outlinedButtonColors(contentColor = C.Ink),
    ) {
        icon?.let { Icon(it, null, Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}
@Composable
fun LinkButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    TextButton(onClick, modifier.heightIn(min = 48.dp)) { Text(text, color = C.Petrol, style = MaterialTheme.typography.labelLarge) }
}

// A field with its label always visible above it, and the error announced below it.
@Composable
fun LabeledField(
    label: String, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier, hint: String? = null,
    error: String? = null, keyboard: KeyboardType = KeyboardType.Text, singleLine: Boolean = true,
) {
    Column(modifier.fillMaxWidth()) {
        Text(label, fontWeight = FontWeight.SemiBold)
        hint?.let { Text(it, color = C.Ink2, style = MaterialTheme.typography.bodyMedium) }
        Spacer(Modifier.size(4.dp))
        OutlinedTextField(
            value, onChange, Modifier.fillMaxWidth().semantics { if (error != null) error(error) }, singleLine = singleLine,
            isError = error != null, shape = RoundedCornerShape(6.dp), keyboardOptions = KeyboardOptions(keyboardType = keyboard),
            minLines = if (singleLine) 1 else 3,
        )
        error?.let { Text(it, color = C.Error, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium) }
    }
}

@Composable
fun Chip(text: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected, onClick, { Text(text) },
        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = C.Selected, selectedLabelColor = C.Petrol, containerColor = C.Surface),
    )
}

// A flat white surface with a quiet border.
@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().background(C.Surface, RoundedCornerShape(8.dp)).border(1.dp, C.Rule, RoundedCornerShape(8.dp)), content = content)
}
@Composable
fun Divider() = Box(Modifier.fillMaxWidth().background(C.Rule).size(1.dp))

// A row inside a panel: at least 48 dp tall, optionally tappable.
@Composable
fun ListRow(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 52.dp).then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp), content = content,
    )
}

@Composable
fun Eyebrow(text: String) = Text(text.uppercase(), color = C.Ink2, style = MaterialTheme.typography.labelMedium)
@Composable
fun ScreenTitle(title: String, eyebrow: String? = null) {
    Column {
        eyebrow?.let { Eyebrow(it) }
        Text(title, style = MaterialTheme.typography.headlineLarge, modifier = Modifier.semantics { heading() })
    }
}
@Composable
fun SectionTitle(text: String) = Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })

@Composable
fun KeyValue(key: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier.border(1.dp, C.Rule, RoundedCornerShape(6.dp)).padding(horizontal = 12.dp, vertical = 8.dp)) {
        Text(key, color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
fun Centered(content: @Composable ColumnScope.() -> Unit) =
    Column(Modifier.fillMaxSize().padding(24.dp), Arrangement.Center, Alignment.CenterHorizontally, content = content)

// Loads data for a screen with native loading, offline and retry states.
@Composable
fun <T> Loader(key: Any?, load: suspend () -> T, content: @Composable (T, () -> Unit) -> Unit) {
    var data by remember(key) { mutableStateOf<T?>(null) }
    var error by remember(key) { mutableStateOf<ApiException?>(null) }
    var attempt by remember(key) { mutableIntStateOf(0) }
    LaunchedEffect(key, attempt) {
        try {
            data = load()
            error = null
        } catch (e: ApiException) {
            error = e
        }
    }
    val current = data
    when {
        current != null -> content(current) { attempt++ }
        error != null -> Centered {
            Text(if (error!!.offline) "You are offline" else "Could not load", style = MaterialTheme.typography.headlineSmall)
            Text(error!!.message.orEmpty(), color = C.Ink2)
            Spacer(Modifier.size(16.dp))
            SecondaryButton("Try again") { error = null; attempt++ }
        }
        else -> Centered { CircularProgressIndicator(color = C.Petrol) }
    }
}
