// Visitor screens: Pass, Explore, Agenda, Profile, plus sign-in and registration.
package com.brainadz.events.ui

import android.Manifest
import android.app.Activity
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import java.time.format.DateTimeFormatter
import java.time.LocalTime
import java.time.LocalDate
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.draw.clip
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.Canvas
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.brainadz.events.BuildConfig
import com.brainadz.events.data.AgendaSession
import com.brainadz.events.data.Exhibitor
import com.brainadz.events.data.Guide
import com.brainadz.events.data.Pass
import com.brainadz.events.data.Registration
import com.brainadz.events.data.Repo
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await

val screenPad = Modifier.padding(horizontal = 16.dp, vertical = 16.dp)

// ---------- Pass ----------
// The pass laid out like a printed ticket: event band, holder and access, then a tear-off stub
// with a large, quiet QR code. Same design as the web app.
@Composable
fun PassCard(pass: Pass) {
    val shape = RoundedCornerShape(18.dp)
    Column(Modifier.fillMaxWidth().shadow(6.dp, shape, ambientColor = C.Ink.copy(alpha = 0.1f), spotColor = C.Ink.copy(alpha = 0.14f)).clip(shape).background(C.Surface)) {
        Row(Modifier.fillMaxWidth().background(C.Navy).padding(horizontal = 20.dp, vertical = 18.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) {
                Text(pass.event.name, color = Color.White, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Text("${dateRange(pass.validFrom, pass.validTo)} · ${pass.event.openTime}–${pass.event.closeTime}", color = Color.White.copy(alpha = 0.82f), style = MaterialTheme.typography.bodyMedium)
                pass.event.venueName?.let { Text(it, color = Color.White.copy(alpha = 0.82f), style = MaterialTheme.typography.bodyMedium) }
            }
            Text(pass.passClass.name, Modifier.background(C.Petrol, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp), color = Color.White, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge)
        }
        Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 18.dp)) {
            Text(pass.holderName, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            pass.holderCompany?.let { Text(it, color = C.Ink2) }
            Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TicketField("Enter at", pass.gates.joinToString().ifEmpty { "Any gate" }, Modifier.weight(1f))
                TicketField("Access", pass.zones.joinToString().ifEmpty { "Show floor" }, Modifier.weight(1f))
            }
        }
        // Perforation: dashed line with a half-circle notch cut from each side.
        Canvas(Modifier.fillMaxWidth().height(36.dp)) {
            val y = size.height / 2
            drawLine(C.Rule, Offset(18.dp.toPx(), y), Offset(size.width - 18.dp.toPx(), y), strokeWidth = 2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(12f, 9f)))
            drawCircle(C.Canvas, 12.dp.toPx(), Offset(0f, y))
            drawCircle(C.Canvas, 12.dp.toPx(), Offset(size.width, y))
        }
        Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            if (pass.qr != null) QrImage(pass.qr, "QR code for ${pass.holderName}'s pass", Modifier.width(210.dp))
            else Notice("This pass is no longer valid.", StatusTone.ERROR)
            pass.ref?.let { Text(it, Modifier.padding(top = 8.dp), color = C.Ink2, fontWeight = FontWeight.SemiBold, letterSpacing = 2.sp) }
            Text(pass.instructions, Modifier.padding(top = 12.dp), color = C.Ink2, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
        }
    }
}
@Composable
private fun TicketField(label: String, value: String, modifier: Modifier) {
    Column(modifier) {
        Text(label, color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
        Text(value, fontWeight = FontWeight.SemiBold)
    }
}

// Where a registration stands, and the one thing to do next.
@Composable
fun RegistrationCard(reg: Registration) {
    val context = LocalContext.current
    val action = rememberAction()
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Eyebrow("${reg.event.name} · ${reg.passClass.name}")
        when (reg.step) {
            "pass" -> {
                reg.pass?.let { PassCard(it) }
                if (reg.pass?.firstAdmittedAt != null) Notice("Admitted. Keep this pass for re-entry.", StatusTone.OK)
            }
            "payment" -> {
                Notice("Payment needed. Your ${reg.passClass.name} place is held; the pass is issued as soon as payment is confirmed.${if (reg.paymentStatus == "failed") " The last attempt did not go through." else ""}", StatusTone.PENDING)
                reg.order?.let { order ->
                    Panel {
                        order.items.forEach { ListRow { Text(it.description, Modifier.weight(1f)); Text(inr(it.amountPaise)) } }
                        Divider(); ListRow { Text("GST", Modifier.weight(1f)); Text(inr(order.gstPaise)) }
                        Divider(); ListRow { Text("Total", Modifier.weight(1f), fontWeight = FontWeight.SemiBold); Text(inr(order.balancePaise), fontWeight = FontWeight.SemiBold) }
                    }
                    // Physical event tickets are paid on the provider's hosted checkout, in a browser tab.
                    PrimaryButton("Pay ${inr(order.balancePaise)}", busy = action.busy) {
                        action.run { CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(Repo.checkoutUrl(order))) }
                    }
                    Text("You pay on a secure hosted checkout page by UPI or card. Come back here afterwards; your pass appears once payment is confirmed.", color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
                }
            }
            "review" -> Notice("Awaiting review. The organiser reviews ${reg.passClass.name} registrations and will email ${reg.email} with a decision. Reference ${reg.ref}.", StatusTone.PENDING)
            "rejected" -> Notice("Not approved. ${reg.reviewNote ?: "The organiser could not approve this registration."} Reference ${reg.ref}.", StatusTone.ERROR)
            else -> Notice("Cancelled. This registration (${reg.ref}) was cancelled and its pass no longer works.", StatusTone.ERROR)
        }
        if (reg.step == "pass" || reg.step == "payment" || reg.step == "review")
            LinkButton("Cancel registration") { action.run { Repo.cancel(reg) } }
    }
}

@Composable
fun PassScreen(onRegister: () -> Unit, onSignIn: () -> Unit) {
    val activity = LocalContext.current as? Activity
    // Full brightness while the QR is on screen makes it easier to scan at the gate.
    DisposableEffect(Unit) {
        val window = activity?.window
        val before = window?.attributes?.screenBrightness
        window?.attributes = window?.attributes?.apply { screenBrightness = 1f }
        onDispose { window?.attributes = window?.attributes?.apply { screenBrightness = before ?: -1f } }
    }
    val regs = Repo.passes.registrations.ifEmpty { listOfNotNull(Repo.linked) }
    Column(screenPad.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ScreenTitle(if (regs.size + Repo.passes.badges.size == 1) "My ticket" else "My tickets", Repo.guide?.event?.name)
        if (!Repo.online) Notice("Offline. Showing the tickets saved on this phone${Repo.passes.syncedAt.let { if (it.isNotEmpty()) ", last updated ${clock(it)}" else "" }}.", StatusTone.PENDING)
        Repo.passes.badges.forEach { PassCard(it) }
        regs.forEach { RegistrationCard(it) }
        if (regs.isEmpty() && Repo.passes.badges.isEmpty()) {
            Text("You have no ticket yet. Register for ${Repo.guide?.event?.name ?: "the event"}, or sign in to load a ticket you already have.", color = C.Ink2)
            PrimaryButton("Register", onClick = onRegister)
            SecondaryButton(if (Repo.signedIn) "Refresh" else "Sign in or find my ticket", onClick = onSignIn)
        }
    }
}

// ---------- Explore ----------
@Composable
fun ExhibitorRow(e: Exhibitor, onClick: () -> Unit) {
    ListRow(onClick = onClick) {
        Monogram(e.name)
        Column(Modifier.weight(1f)) {
            Text(e.name, fontWeight = FontWeight.SemiBold)
            Text(e.industry ?: e.categories.joinToString(), color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
        }
        e.boothCode?.let {
            Text(it, Modifier.background(Color(0xFFEEF1F9), RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 3.dp), color = C.Navy, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge)
        }
        Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = Color(0xFFA3A8B3))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExhibitorSheet(ex: Exhibitor, onDismiss: () -> Unit, onShowOnPlan: (() -> Unit)?) {
    val context = LocalContext.current
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = C.Surface) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Monogram(ex.name, 56.dp)
                Column(Modifier.weight(1f)) {
                    Text(ex.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Text(ex.boothCode?.let { "Stall $it${ex.hall?.let { h -> " · $h" } ?: ""}" } ?: "Stall to be announced", color = C.Ink2)
                }
            }
            ex.description?.let { Text(it) }
            if (ex.categories.isNotEmpty()) Text(ex.categories.joinToString(" · "), color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
            if (onShowOnPlan != null) PrimaryButton("Show on floor plan", onClick = onShowOnPlan)
            (listOfNotNull(ex.website?.let { "Website" to it }) + ex.catalogueLinks.map { it.label to it.url }).forEach { (label, url) ->
                SecondaryButton(label) { runCatching { CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(url)) } }
            }
        }
    }
}

@Composable
fun ExploreScreen(guide: Guide) {
    var query by remember { mutableStateOf("") }
    var cat by remember { mutableStateOf<String?>(null) }
    var view by remember { mutableStateOf("list") }
    val halls = guide.halls.filter { it.cols > 0 }
    var hallId by remember { mutableStateOf(halls.firstOrNull()?.id) }
    var boothId by remember { mutableStateOf<Int?>(null) }
    var open by remember { mutableStateOf<Exhibitor?>(null) }
    val hall = halls.find { it.id == hallId }
    val cats = remember(guide) { guide.exhibitors.flatMap { it.categories }.distinct().sorted() }
    val matches = guide.exhibitors
        .filter { e -> (cat == null || cat in e.categories) && (query.isBlank() || listOfNotNull(e.name, e.boothCode, e.industry).plus(e.categories).any { it.contains(query.trim(), ignoreCase = true) }) }
        .sortedBy { it.name.lowercase() }
    Column(screenPad.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("Explore")
        Segmented(listOf("Exhibitors" to "list", "Floor plan" to "map"), view) { view = it }
        if (view == "map" && hall != null) {
            if (halls.size > 1) Segmented(halls.map { it.name to it.id }, hall.id) { hallId = it; boothId = null }
            Panel { HallPlan(hall, boothId, Modifier.padding(12.dp)) { id -> boothId = id.takeIf { hall.booths.find { b -> b.id == id }?.exhibitorId != null } } }
            val ex = boothId?.let { id -> guide.exhibitors.find { it.boothId == id } }
            if (ex != null) Panel { ExhibitorRow(ex) { open = ex } }
            else Text("Tap a stall to see who is there. Dashed stalls are free.", color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
            if (hall.amenities.isNotEmpty()) Panel { hall.amenities.forEachIndexed { i, a -> if (i > 0) Divider(); ListRow { Text(a.label, Modifier.weight(1f)); if (a.accessible) StatusChip("Step-free", StatusTone.OK) } } }
        } else {
            LabeledField("Search exhibitors", query, { query = it }, hint = "Company, stall or product")
            if (cats.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("All", cat == null) { cat = null }
                cats.forEach { c -> Chip(c, cat == c) { cat = if (cat == c) null else c } }
            }
            Text(if (matches.size == guide.exhibitors.size) "${matches.size} exhibitors" else "${matches.size} of ${guide.exhibitors.size} exhibitors", color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
            if (matches.isEmpty()) Text("No exhibitors match. Try a different search.", color = C.Ink2)
            else Panel { matches.forEachIndexed { i, e -> if (i > 0) Divider(); ExhibitorRow(e) { open = e } } }
        }
        if (!Repo.online) Text("Offline. Showing the guide saved ${clock(guide.savedAt)}.", color = C.Pending, style = MaterialTheme.typography.bodyMedium)
    }
    open?.let { ex ->
        ExhibitorSheet(ex, onDismiss = { open = null }, onShowOnPlan = ex.boothId?.let { id ->
            { halls.find { h -> h.booths.any { it.id == id } }?.let { hallId = it.id }; boothId = id; view = "map"; open = null }
        }.takeIf { view != "map" })
    }
}

// ---------- Agenda ----------
@Composable
fun SessionRow(s: AgendaSession, colour: Color, live: Boolean, marked: Boolean, onToggle: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(colour, RoundedCornerShape(topEnd = 3.dp, bottomEnd = 3.dp)))
        Row(Modifier.weight(1f).padding(start = 14.dp, end = 4.dp, top = 12.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.width(52.dp)) {
                Text(s.startTime, fontWeight = FontWeight.SemiBold)
                Text(s.endTime, color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (live) Text("On now", Modifier.background(C.Petrol, RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 1.dp), color = Color.White, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
                Text(s.title, fontWeight = FontWeight.SemiBold)
                Text(listOfNotNull(s.room, s.track).joinToString(" · "), color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
                if (s.speakers.isNotEmpty()) Text(s.speakers.joinToString("; ") { p -> p.title?.let { "${p.name}, $it" } ?: p.name }, style = MaterialTheme.typography.bodyMedium)
                if (s.full) StatusChip("Full", StatusTone.PENDING)
            }
            if (onToggle != null) IconButton(onToggle) {
                Icon(if (marked) Icons.Outlined.Bookmark else Icons.Outlined.BookmarkBorder, if (marked) "Remove bookmark for ${s.title}" else "Bookmark ${s.title}", tint = if (marked) C.Petrol else C.Control)
            }
        }
    }
}

@Composable
fun AgendaScreen(guide: Guide) {
    val days = remember(guide) { guide.agenda.sessions.filter { it.status == "scheduled" }.map { it.day }.distinct().sorted() }
    val today = LocalDate.now(IST).toString()
    val now = LocalTime.now(IST).format(DateTimeFormatter.ofPattern("HH:mm"))
    var day by remember(guide) { mutableStateOf(if (today in days) today else days.firstOrNull() ?: "") }
    var track by remember { mutableStateOf<Int?>(null) }
    var mine by remember { mutableStateOf(false) }
    val action = rememberAction()
    val sessions = guide.agenda.sessions.filter { it.status == "scheduled" && it.day == day && (track == null || it.trackId == track) && (!mine || it.id in Repo.bookmarks) }
    Column(screenPad.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("Agenda")
        if (days.size > 1) Segmented(days.map { shortDay(it) to it }, day) { day = it }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("All", track == null && !mine) { track = null; mine = false }
            guide.agenda.tracks.forEach { t -> Chip(t.name, track == t.id) { track = t.id; mine = false } }
            if (Repo.signedIn) Chip("Saved", mine) { mine = !mine; track = null }
        }
        if (!Repo.signedIn) Text("Sign in from Profile to save sessions to your plan.", color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
        if (sessions.isEmpty()) Text(if (mine) "You have not saved any sessions for this day." else "No sessions to show.", color = C.Ink2)
        else Panel {
            sessions.forEachIndexed { i, s ->
                if (i > 0) Divider()
                SessionRow(
                    s, trackColour(guide.agenda.tracks, s.trackId), s.day == today && s.startTime <= now && now < s.endTime,
                    s.id in Repo.bookmarks, if (Repo.signedIn) ({ action.run { Repo.toggleBookmark(s.id) } }) else null,
                )
            }
        }
    }
}

// ---------- Profile ----------
@Composable
fun ProfileScreen(modes: List<Pair<Mode, String>>, mode: Mode, onMode: (Mode) -> Unit, onSignIn: () -> Unit) {
    val action = rememberAction()
    val guide = Repo.guide
    var topics by remember { mutableStateOf(Repo.pushTopics) }
    val toast = LocalToast.current
    // Turning a notification on asks for permission first (Android 13+), then registers the
    // phone's FCM token with the chosen topics. Nothing is sent until the visitor opts in.
    fun apply(next: List<String>) = action.run {
        val token = Repo.pushToken ?: runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull()
        if (token == null) toast("Notifications are not set up in this build yet.")
        else {
            Repo.pushToken = token
            Repo.setPush(token, next)
            topics = next
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (!ok) toast("Notifications are blocked. Allow them in system settings.") }
    fun toggle(topic: String, on: Boolean) {
        if (on && Build.VERSION.SDK_INT >= 33) permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        apply(if (on) topics + topic else topics - topic)
    }
    Column(screenPad.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ScreenTitle("Profile")
        Panel {
            if (Repo.signedIn) {
                ListRow { Column(Modifier.weight(1f)) { Text(Repo.me.user?.name?.ifEmpty { "Signed in" } ?: "", fontWeight = FontWeight.SemiBold); Text(Repo.me.user?.email.orEmpty(), color = C.Ink2) } }
                Divider()
                ListRow(onClick = { action.run { Repo.signOut() } }) { Text("Sign out and clear this phone", color = C.Error) }
            } else ListRow(onClick = onSignIn) { Text("Sign in", color = C.Petrol, fontWeight = FontWeight.SemiBold) }
        }
        if (modes.size > 1) {
            SectionTitle("Workspaces")
            Panel {
                modes.forEachIndexed { i, (m, label) ->
                    if (i > 0) Divider()
                    Row(Modifier.fillMaxWidth().selectable(m == mode, role = Role.RadioButton) { onMode(m) }.padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(m == mode, null, Modifier.padding(8.dp))
                        Text(label)
                    }
                }
            }
        }
        if (Repo.signedIn) {
            SectionTitle("Notifications")
            Panel {
                listOf("schedule" to "Schedule changes", "gate" to "Gate changes").forEachIndexed { i, (topic, label) ->
                    if (i > 0) Divider()
                    Row(Modifier.fillMaxWidth().toggleable(topic in topics, role = Role.Switch) { toggle(topic, it) }.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(label, Modifier.weight(1f))
                        Switch(topic in topics, null)
                    }
                }
            }
            Text("Off until you turn them on. You can change this at any time.", color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
        }
        guide?.event?.let { e ->
            SectionTitle(e.name)
            Panel {
                ListRow { Column { Text("${dateRange(e.startsOn, e.endsOn)} · ${e.openTime}–${e.closeTime}", fontWeight = FontWeight.SemiBold); Text(listOfNotNull(e.venueName, e.venueAddress).joinToString(", "), color = C.Ink2) } }
                guide.accessibility?.let { Divider(); ListRow { Column { Text("Accessibility", fontWeight = FontWeight.SemiBold); Text(it, color = C.Ink2) } } }
                guide.faqs.forEach { f -> Divider(); ListRow { Column { Text(f.q, fontWeight = FontWeight.SemiBold); Text(f.a, color = C.Ink2) } } }
            }
        }
        Text("BrainADZ Events ${BuildConfig.VERSION_NAME} · ${Repo.serverUrl}", color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
    }
}

// ---------- Sign in ----------
@Composable
fun SignInScreen(onDone: () -> Unit) {
    Column(screenPad.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ScreenTitle("Sign in", "BrainADZ Events")
        SignInFields(onDone)
    }
}

// Email-code or password sign-in, plus the ticket-link and server-address options. Used on the
// welcome screen and the sign-in screen.
@Composable
fun SignInFields(onDone: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var secret by remember { mutableStateOf("") }
    var usePassword by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    var demoCode by remember { mutableStateOf<String?>(null) }
    var server by remember { mutableStateOf(Repo.serverUrl) }
    var showServer by remember { mutableStateOf(false) }
    var findEmail by remember { mutableStateOf(false) }
    val action = rememberAction()
    val toast = LocalToast.current
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        LabeledField("Email", email, { email = it.trim(); sent = false }, keyboard = KeyboardType.Email)
        if (usePassword) LabeledField("Password", secret, { secret = it }, keyboard = KeyboardType.Password)
        if (!usePassword && sent) {
            demoCode?.let { Notice("Demo: the local email adapter sends nothing. Your code is $it.", StatusTone.PENDING) }
            LabeledField("6-digit code", secret, { secret = it.filter(Char::isDigit).take(6) }, hint = "Sent to $email", keyboard = KeyboardType.NumberPassword)
        }
        PrimaryButton(if (usePassword || sent) "Sign in" else "Email me a code", busy = action.busy, enabled = email.contains("@")) {
            action.run {
                when {
                    usePassword -> { Repo.signIn(email, secret); onDone() }
                    !sent -> { demoCode = Repo.requestCode(email).demoCode; sent = true; secret = "" }
                    else -> { Repo.verifyCode(email, secret); onDone() }
                }
            }
        }
        LinkButton(if (usePassword) "Email me a code instead" else "Use a password instead") { usePassword = !usePassword; secret = ""; sent = false }
        if (Repo.slug != null) LinkButton("Registered without an account? Email my ticket link") { findEmail = true }
        if (findEmail) {
            Notice("Enter the email you registered with above, then tap Send. The link opens your ticket in this app.")
            SecondaryButton("Send my ticket link", enabled = email.contains("@")) { action.run { Repo.passLink(email); toast("If that email is registered, a new ticket link is on its way.") } }
        }
        LinkButton("Server address") { showServer = !showServer }
        if (showServer) {
            LabeledField("Server address", server, { server = it }, hint = "For pilots and venue networks, for example http://192.168.1.20:3100", keyboard = KeyboardType.Uri)
            SecondaryButton("Use this server") { Repo.serverUrl = server; action.run { Repo.start(); toast("Server set") } }
        }
    }
}

// ---------- Register ----------
// Single-column form, persistent labels, inline errors, visible privacy notice, then a code
// step that proves the email address.
@Composable
fun RegisterScreen(guide: Guide, onDone: () -> Unit) {
    val open = guide.passClasses
    var passClass by remember { mutableStateOf(open.firstOrNull { !it.soldOut }?.code.orEmpty()) }
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var company by remember { mutableStateOf("") }
    var jobTitle by remember { mutableStateOf("") }
    var invite by remember { mutableStateOf("") }
    val answers = remember { mutableStateMapOf<String, Any>() }
    var consent by remember { mutableStateOf(false) }
    var optOut by remember { mutableStateOf(false) }
    val errors = remember { mutableStateMapOf<String, String>() }
    var pending by remember { mutableStateOf<com.brainadz.events.data.RegisterOut?>(null) }
    var code by remember { mutableStateOf("") }
    val action = rememberAction()
    val cls = open.find { it.code == passClass }

    Column(screenPad.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        val p = pending
        if (p != null) {
            ScreenTitle("Check your email", guide.event?.name)
            Text("We sent a 6-digit code to ${p.email}. Enter it to confirm the address is yours.")
            p.demoCode?.let { Notice("Demo: the local email adapter sends nothing. Your code is $it.", StatusTone.PENDING) }
            LabeledField("6-digit code", code, { code = it.filter(Char::isDigit).take(6) }, keyboard = KeyboardType.NumberPassword)
            PrimaryButton("Confirm", busy = action.busy, enabled = code.length == 6) { action.run { Repo.verifyRegistration(p.ref, code); onDone() } }
            LinkButton("Send a new code") { action.run { pending = p.copy(demoCode = Repo.resendCode(p.ref).demoCode) } }
            return@Column
        }
        ScreenTitle("Register", guide.event?.name)
        Text("Pass type", fontWeight = FontWeight.SemiBold)
        Panel {
            open.forEachIndexed { i, c ->
                if (i > 0) Divider()
                Row(
                    Modifier.fillMaxWidth().background(if (c.code == passClass) C.Selected else C.Surface).selectable(c.code == passClass, enabled = !c.soldOut, role = Role.RadioButton) { passClass = c.code }.padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(c.code == passClass, null, Modifier.padding(8.dp), enabled = !c.soldOut)
                    Column(Modifier.weight(1f)) {
                        Text(c.name, fontWeight = FontWeight.SemiBold)
                        Text(if (c.soldOut) "Fully booked" else c.description.orEmpty(), color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
                    }
                    Text(when (c.mode) { "invited" -> "Invitation"; "approval" -> "Reviewed"; else -> c.priceLabel }, Modifier.padding(end = 8.dp))
                }
            }
        }
        Text("Exhibitors apply for a stand on the event website. Speakers are registered by the organiser.", color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
        if (cls?.mode == "invited") LabeledField("Invitation code", invite, { invite = it.uppercase() }, error = errors["invite"])
        LabeledField("Full name", name, { name = it }, hint = "As it should appear on your badge", error = errors["name"])
        LabeledField("Work email", email, { email = it.trim() }, hint = "We send your pass here", error = errors["email"], keyboard = KeyboardType.Email)
        LabeledField("Mobile number (optional)", phone, { phone = it }, keyboard = KeyboardType.Phone)
        LabeledField("Company (optional)", company, { company = it })
        LabeledField("Job title (optional)", jobTitle, { jobTitle = it })
        guide.formFields.forEach { f ->
            when (f.type) {
                "checkbox" -> CheckRow(f.label, answers[f.key] == true, errors[f.key]) { answers[f.key] = it }
                "select" -> Column {
                    Text(f.label, fontWeight = FontWeight.SemiBold)
                    Panel {
                        f.options.forEachIndexed { i, o ->
                            if (i > 0) Divider()
                            Row(Modifier.fillMaxWidth().selectable(answers[f.key] == o, role = Role.RadioButton) { answers[f.key] = o }.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                                RadioButton(answers[f.key] == o, null, Modifier.padding(8.dp)); Text(o)
                            }
                        }
                    }
                    errors[f.key]?.let { Text(it, color = C.Error, style = MaterialTheme.typography.bodyMedium) }
                }
                else -> LabeledField(f.label, answers[f.key] as? String ?: "", { answers[f.key] = it }, error = errors[f.key])
            }
        }
        Column(Modifier.background(C.Selected, RoundedCornerShape(6.dp)).padding(12.dp)) {
            Text("How we use your details", fontWeight = FontWeight.SemiBold)
            Text("We use them to issue your pass and run the event. ${guide.leadSharingNotice}", style = MaterialTheme.typography.bodyMedium)
            CheckRow("Do not share my details with exhibitors, even if they scan my badge", optOut, null) { optOut = it }
            CheckRow("I accept this privacy notice", consent, errors["consent"]) { consent = it }
        }
        val cta = when {
            cls == null -> "Register"
            cls.mode == "approval" -> "Submit for review"
            cls.totalPaise > 0 -> "Continue to payment"
            else -> "Get ${cls.name.lowercase()} pass"
        }
        PrimaryButton(cta, busy = action.busy, enabled = cls != null) {
            errors.clear()
            if (name.isBlank()) errors["name"] = "Enter your full name"
            if (!Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(email)) errors["email"] = "Enter a work email address, like name@company.com"
            if (cls?.mode == "invited" && invite.isBlank()) errors["invite"] = "Enter the code from your invitation"
            guide.formFields.filter { it.required && (answers[it.key] == null || answers[it.key] == false || answers[it.key] == "") }.forEach { errors[it.key] = if (it.type == "checkbox") "Tick this box to continue" else "Choose an answer" }
            if (!consent) errors["consent"] = "Accept the privacy notice to register"
            if (errors.isEmpty()) action.run {
                pending = Repo.register(mapOf(
                    "passClass" to passClass, "name" to name, "email" to email, "phone" to phone, "company" to company, "jobTitle" to jobTitle,
                    "inviteCode" to invite, "consent" to true, "leadOptOut" to optOut, "answers" to answers.toMap(),
                ))
            }
        }
        if (errors.isNotEmpty()) Notice("Check the highlighted answers above.", StatusTone.ERROR)
    }
}

@Composable
fun CheckRow(label: String, checked: Boolean, error: String?, onChange: (Boolean) -> Unit) {
    Column {
        Row(Modifier.fillMaxWidth().toggleable(checked, role = Role.Checkbox, onValueChange = onChange).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked, null, Modifier.padding(end = 12.dp).size(48.dp))
            Text(label, Modifier.weight(1f))
        }
        error?.let { Text(it, color = C.Error, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium) }
    }
}
