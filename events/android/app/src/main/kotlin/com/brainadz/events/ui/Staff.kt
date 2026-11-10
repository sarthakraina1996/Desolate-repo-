// Authorised workspaces: the exhibitor's booth, team and lead capture, and the gate scanner
// with manual lookup, override and badge printing. The server decides what each role may do;
// these screens only show the actions it allows.
package com.brainadz.events.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.HighlightOff
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.brainadz.events.data.Api
import com.brainadz.events.data.ApiException
import com.brainadz.events.data.ExhibitorRole
import com.brainadz.events.data.Gate
import com.brainadz.events.data.GateContext
import com.brainadz.events.data.Lead
import com.brainadz.events.data.LeadScanOut
import com.brainadz.events.data.LookupRow
import com.brainadz.events.data.PrintJob
import com.brainadz.events.data.Repo
import com.brainadz.events.data.ScanResult
import com.brainadz.events.data.ScanRules
import com.brainadz.events.data.Tone
import com.brainadz.events.data.Workspace
import com.brainadz.events.data.body
import kotlinx.coroutines.delay

// ---------- exhibitor ----------
// Leads with the booth, hall and the next required action; then checklist and order totals.
@Composable
fun BoothScreen(role: ExhibitorRole) {
    Loader(role.exhibitorId, { Api.get<Workspace>("/exhibitor/${role.exhibitorId}") }) { ws, _ ->
        Column(screenPad.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            val b = ws.booth
            Column {
                Eyebrow(ws.event.name)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(b?.let { "Booth ${it.code}" } ?: ws.exhibitor.companyName, style = MaterialTheme.typography.headlineLarge)
                    StatusChip(labelOf(b?.status ?: ws.exhibitor.status), toneOf(b?.status ?: ws.exhibitor.status))
                }
                Text(b?.let { "${it.hall} / ${ws.exhibitor.companyName}" } ?: "Exhibitor workspace", color = C.Ink2)
            }
            Notice("Next: ${ws.next.text}", if (ws.next.key == "none") StatusTone.OK else StatusTone.NEUTRAL)
            ws.exhibitor.reviewNote?.takeIf { ws.exhibitor.status != "approved" }?.let { Notice("Organiser: $it", StatusTone.PENDING) }
            if (ws.checklist.isNotEmpty()) {
                SectionTitle("Setup checklist")
                Panel {
                    ws.checklist.forEachIndexed { i, c ->
                        if (i > 0) Divider()
                        ListRow(Modifier.background(if (c.status == "complete") C.Selected else C.Surface)) {
                            Column(Modifier.weight(1f)) {
                                Text(c.title, fontWeight = FontWeight.SemiBold)
                                Text(
                                    if (c.status == "complete") "Done" else "${if (c.overdue) "Overdue, was due" else "Due"} ${day(c.dueOn.orEmpty())}",
                                    color = if (c.overdue) C.Error else C.Ink2, style = MaterialTheme.typography.bodyMedium,
                                )
                                c.note?.let { Text("Organiser: $it", color = C.Error, style = MaterialTheme.typography.bodyMedium) }
                            }
                            if (c.key == "team" && c.status != "complete") StatusChip("${ws.team.size} of ${ws.badgeQuota} added")
                            else StatusChip(labelOf(c.status), toneOf(c.status))
                        }
                    }
                }
            }
            if (ws.orders.isNotEmpty()) {
                SectionTitle("Order summary")
                Panel {
                    ws.orders.forEach { o -> ListRow { Text(if (o.kind == "booth") "Stand package" else "Services", Modifier.weight(1f)); Text(inr(o.totalPaise)) }; Divider() }
                    ListRow { Text("Received", Modifier.weight(1f)); Text(inr(ws.totals.paidPaise), color = C.Ok) }
                    Divider()
                    ListRow { Text("Balance due", Modifier.weight(1f), fontWeight = FontWeight.SemiBold); Text(inr(ws.totals.balancePaise), fontWeight = FontWeight.SemiBold) }
                }
                Text("Pay orders, upload documents and order services in the exhibitor workspace on the web.", color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
fun TeamScreen(role: ExhibitorRole) {
    var adding by remember { mutableStateOf(false) }
    val action = rememberAction()
    Loader(role.exhibitorId, { Api.get<Workspace>("/exhibitor/${role.exhibitorId}") }) { ws, reload ->
        val canManage = "x.team" in role.perms
        Column(screenPad.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            ScreenTitle("Team badges", ws.exhibitor.companyName)
            Text("${ws.team.size} of ${ws.badgeQuota} badges used. Each person signs in with their own email.", color = C.Ink2)
            Panel {
                ws.team.forEachIndexed { i, t ->
                    if (i > 0) Divider()
                    ListRow {
                        Column(Modifier.weight(1f)) {
                            Text(t.name, fontWeight = FontWeight.SemiBold)
                            Text("${t.email} · ${if (t.role == "exhibitor_admin") "Admin" else "Booth staff"}", color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
                        }
                        StatusChip(labelOf(t.status), toneOf(t.status))
                    }
                }
            }
            if (canManage) {
                if (ws.team.size >= ws.badgeQuota) Notice("All badges are in use. Ask the organiser for a larger quota.", StatusTone.PENDING)
                else PrimaryButton("Invite staff") { adding = true }
            }
        }
        if (adding) {
            var name by remember { mutableStateOf("") }
            var email by remember { mutableStateOf("") }
            AlertDialog(
                onDismissRequest = { adding = false },
                title = { Text("Invite booth staff") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        LabeledField("Name on badge", name, { name = it })
                        LabeledField("Email", email, { email = it.trim() }, keyboard = KeyboardType.Email)
                    }
                },
                confirmButton = { LinkButton("Send invitation") { action.run { Api.raw("POST", "/exhibitor/${role.exhibitorId}/team", body("name" to name, "email" to email, "role" to "booth_staff")); adding = false; reload() } } },
                dismissButton = { LinkButton("Cancel") { adding = false } },
            )
        }
    }
}

@Composable
fun LeadsScreen(role: ExhibitorRole) {
    var query by remember { mutableStateOf("") }
    Loader(role.exhibitorId, { Api.get<List<Lead>>("/exhibitor/${role.exhibitorId}/leads") }) { leads, _ ->
        val rows = leads.filter { l -> query.isBlank() || listOfNotNull(l.name, l.company, l.notes).plus(l.tags).any { it.contains(query.trim(), ignoreCase = true) } }
        Column(screenPad.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ScreenTitle("Leads", role.companyName)
            LabeledField("Search leads", query, { query = it }, hint = "Name, company, interest or notes")
            Text("${rows.size} of ${leads.size} leads. Each visitor appears once.", color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
            Panel {
                rows.forEachIndexed { i, l ->
                    if (i > 0) Divider()
                    ListRow {
                        Column(Modifier.weight(1f)) {
                            Text(l.name.orEmpty(), fontWeight = FontWeight.SemiBold)
                            Text(listOfNotNull(l.jobTitle, l.company).joinToString(", "), color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
                            if (l.tags.isNotEmpty()) Text(l.tags.joinToString(" · "), style = MaterialTheme.typography.bodyMedium)
                            l.notes?.let { Text(it, color = C.Ink2, style = MaterialTheme.typography.bodyMedium) }
                        }
                        l.rating?.let { StatusChip(it.replaceFirstChar(Char::uppercase), if (it == "hot") StatusTone.ERROR else if (it == "warm") StatusTone.PENDING else StatusTone.NEUTRAL) }
                    }
                }
                if (rows.isEmpty()) Text("No leads yet. Scan a visitor's badge to capture one.", Modifier.padding(24.dp), color = C.Ink2)
            }
            Text("Lead export is for exhibitor admins, in the web workspace. Exports are logged.", color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

// One-handed scan-and-qualify: scan, tap a rating and tags, save, scan the next badge.
@Composable
fun LeadScanScreen(role: ExhibitorRole) {
    var out by remember { mutableStateOf<LeadScanOut?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var rating by remember { mutableStateOf("") }
    var tags by remember { mutableStateOf(listOf<String>()) }
    var notes by remember { mutableStateOf("") }
    var typed by remember { mutableStateOf("") }
    val action = rememberAction()
    Loader(role.exhibitorId, { Api.get<Workspace>("/exhibitor/${role.exhibitorId}") }) { ws, _ ->
        fun scan(qr: String) = action.run {
            try {
                val r: LeadScanOut = Api.post("/exhibitor/${role.exhibitorId}/leads/scan", body("qr" to qr))
                out = r; error = null; rating = r.lead.rating.orEmpty(); tags = r.lead.tags; notes = r.lead.notes.orEmpty()
            } catch (e: ApiException) {
                error = e.message
            }
        }
        val current = out
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                ScreenTitle("Scan a badge", ws.booth?.let { "Booth ${it.code}" } ?: ws.exhibitor.companyName)
                if (current == null) {
                    QrScanner { scan(it) }
                    error?.let { Notice(it, StatusTone.ERROR) } ?: Text("Point the camera at the QR on a visitor's badge. Ask before you scan.", color = C.Ink2)
                    LabeledField("Or type the code", typed, { typed = it })
                    if (typed.isNotBlank()) SecondaryButton("Add") { scan(typed); typed = "" }
                } else {
                    ResultPanel(Tone.OK, if (current.duplicate) "Already a lead" else "Lead saved", if (current.duplicate) "Scanned ${current.lead.scanCount} times. Details updated." else "Add what you learned.")
                    Column {
                        Text(current.lead.name.orEmpty(), style = MaterialTheme.typography.headlineSmall)
                        Text(listOfNotNull(current.lead.jobTitle, current.lead.company).joinToString(", "), color = C.Ink2)
                    }
                    Text("How interested?", fontWeight = FontWeight.SemiBold)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf("hot", "warm", "cold").forEach { r -> Chip(r.replaceFirstChar(Char::uppercase), rating == r) { rating = if (rating == r) "" else r } } }
                    Text("Interested in", fontWeight = FontWeight.SemiBold)
                    FlowChips((ws.interestTags + tags).distinct(), tags) { t -> tags = if (t in tags) tags - t else tags + t }
                    LabeledField("Notes (optional)", notes, { notes = it }, singleLine = false)
                }
            }
            if (current != null) PrimaryButton("Save and scan next", busy = action.busy) {
                action.run {
                    Api.raw("PUT", "/exhibitor/${role.exhibitorId}/leads/${current.lead.id}", body("rating" to rating.ifEmpty { null }, "tags" to tags, "notes" to notes))
                    out = null
                }
            }
        }
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun FlowChips(all: List<String>, selected: List<String>, onToggle: (String) -> Unit) {
    androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { all.forEach { t -> Chip(t, t in selected) { onToggle(t) } } }
}

// ---------- gate ----------
// One large result, readable at arm's length: colour, icon and words together.
@Composable
fun ResultPanel(tone: Tone, title: String, hint: String) {
    val (fg, bg, icon) = when (tone) {
        Tone.OK -> Triple(C.Ok, C.OkBg, Icons.Outlined.CheckCircle)
        Tone.WARN -> Triple(C.Pending, C.PendingBg, Icons.Outlined.ErrorOutline)
        Tone.DENY -> Triple(C.Error, C.ErrorBg, Icons.Outlined.HighlightOff)
    }
    Row(
        Modifier.fillMaxWidth().background(bg, RoundedCornerShape(8.dp)).padding(20.dp).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Assertive },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(icon, null, Modifier.size(56.dp), tint = fg)
        Column {
            Text(title, color = fg, fontSize = 28.sp, lineHeight = 32.sp, fontWeight = FontWeight.SemiBold)
            if (hint.isNotEmpty()) Text(hint, color = fg)
        }
    }
}

@Composable
fun GateScreen() {
    Loader("gate", { Api.get<List<GateContext>>("/gate/context") }) { contexts, _ ->
        val device = Repo.device
        val ctx = contexts.find { it.event.id == device?.eventId }
        val gate = ctx?.gates?.find { it.id == device?.gateId }
        if (ctx != null && gate != null) GateScanner(ctx, gate) else ChooseGate(contexts)
    }
}

@Composable
private fun ChooseGate(contexts: List<GateContext>) {
    val action = rememberAction()
    Column(screenPad.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ScreenTitle("Gate scanner")
        if (contexts.isEmpty()) Notice("You are not assigned to a gate. Ask the organiser to add you as gate staff.", StatusTone.ERROR)
        contexts.forEach { ctx ->
            SectionTitle(ctx.event.name)
            Text("Choose the gate you are working at. This phone is then enrolled for that gate.", color = C.Ink2)
            Panel {
                ctx.gates.forEachIndexed { i, g ->
                    if (i > 0) Divider()
                    ListRow(onClick = { action.run { Repo.enrol(ctx, g) } }) {
                        Column(Modifier.weight(1f)) { Text(g.name, fontWeight = FontWeight.SemiBold); Text("Opens into ${g.zoneName}", color = C.Ink2, style = MaterialTheme.typography.bodyMedium) }
                        if (g.restricted) StatusChip("Online only", StatusTone.PENDING)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GateScanner(ctx: GateContext, gate: Gate) {
    var result by remember { mutableStateOf<ScanResult?>(null) }
    var job by remember { mutableStateOf<PrintJob?>(null) }
    var lookup by remember { mutableStateOf(false) }
    var reasonFor by remember { mutableStateOf<String?>(null) } // "override" or "reprint"
    var leaving by remember { mutableStateOf(false) }
    val action = rememberAction()
    val toast = LocalToast.current
    // Retry in the background while there is something queued or the phone was offline.
    LaunchedEffect(gate.id) {
        while (true) {
            delay(20_000)
            if (Repo.queue.isNotEmpty() || !Repo.online) Repo.sync()
        }
    }
    fun syncNow() = action.run {
        val queued = Repo.queue.size
        val conflicts = Repo.sync()
        toast(when {
            conflicts == null -> "Still offline. ${Repo.queue.size} scans stay queued on this phone."
            conflicts > 0 -> "$conflicts queued scan(s) were also admitted on another device. Flagged for the organiser."
            queued > 0 -> "$queued queued scan(s) uploaded"
            else -> "Up to date"
        })
    }
    fun print(reason: String? = null) = action.run {
        try {
            job = Api.post("/gate/print", body("gateId" to gate.id, "passId" to result?.passId, "reason" to reason))
        } catch (e: ApiException) {
            if (e.status == 400 && ctx.canReprint && reason == null) reasonFor = "reprint"
            else throw if (e.status == 403) ApiException(403, "This badge was already printed. Ask a supervisor for a reprint.") else e
        }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        // Gate context and connection state, always visible.
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(gate.name, style = MaterialTheme.typography.headlineSmall)
                val state = if (Repo.online) (if (Repo.queue.isEmpty()) "Online · synced ${clock(Repo.bundle?.loadedAt)}" else "Online · ${Repo.queue.size} queued, uploading") else "Offline · ${Repo.queue.size} queued"
                Text(state, color = if (Repo.online && Repo.queue.isEmpty()) C.Ok else C.Pending, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                Text("${ctx.event.name} · ${gate.zoneName}", color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
            }
            IconButton({ syncNow() }, enabled = !Repo.syncing) { Icon(Icons.Outlined.Sync, "Sync now", tint = C.Petrol) }
        }
        Spacer(Modifier.size(12.dp))
        val r = result
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (r == null) {
                if (gate.restricted) Notice("Restricted area: scans here are only decided online.", StatusTone.PENDING)
                QrScanner { code ->
                    if (result == null && !lookup) action.run {
                        job = null
                        result = Repo.scan(gate, code)
                    }
                }
                Text("Hold the visitor's QR inside the frame.", color = C.Ink2)
            } else {
                val info = ScanRules.info(r.result)
                ResultPanel(info.tone, info.title, info.hint)
                r.name?.let { Column { Text(it, style = MaterialTheme.typography.headlineSmall); Text(listOfNotNull(r.passClass, r.company).joinToString(" · "), color = C.Ink2) } }
                r.earlier?.let { Text("First admitted at ${it.gate}, ${clock(it.at)}.") }
                if (r.offline) Notice(if (r.bundleExpired) "The saved eligibility data has expired. Reconnect to scan." else "Decided offline from saved data. This scan is queued and will be checked when the connection returns.", StatusTone.PENDING)
                if (r.conflict) Notice("Another device also admitted this pass. Flagged for the organiser.", StatusTone.ERROR)
                // Denied or uncertain scans get a clear way forward.
                if (info.tone != Tone.OK) {
                    SectionTitle("What to do")
                    Panel {
                        ListRow(onClick = { result = null; lookup = true }) { Icon(Icons.Outlined.Search, null); Text("Look the person up by name or reference") }
                        if (ctx.canOverride && r.passId != null) { Divider(); ListRow(onClick = { reasonFor = "override" }) { Icon(Icons.Outlined.CheckCircle, null); Text("Override and admit, with a reason") } }
                        Divider()
                        ListRow { Text("Otherwise send the visitor to the help desk${if (ctx.canOverride) "" else ". Only a supervisor can override"}.", color = C.Ink2) }
                    }
                }
                // A printer failure is separate from admission: the visitor is still in.
                job?.let { j ->
                    when (j.status) {
                        "printed" -> Notice("Badge printed on ${j.printer}.", StatusTone.OK)
                        "failed" -> {
                            Notice("Printer problem: ${j.error}. The visitor is still admitted.", StatusTone.ERROR)
                            SecondaryButton("Retry") { action.run { job = Api.post("/gate/print-jobs/${j.id}/retry") } }
                            SecondaryButton("Use spare printer") { action.run { job = Api.post("/gate/print-jobs/${j.id}/spare") } }
                        }
                        else -> Notice("Badge sent to the print station.", StatusTone.PENDING)
                    }
                }
            }
        }
        // Actions sit at the bottom, within thumb reach.
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (r == null) {
                SecondaryButton(if (Repo.online) "Manual lookup" else "Manual lookup (needs connection)", enabled = Repo.online, icon = Icons.Outlined.Search) { lookup = true }
                LinkButton("Change gate", Modifier.align(Alignment.CenterHorizontally)) { leaving = true }
            } else {
                if (ScanRules.isAdmit(r.result) && r.passId != null && ctx.canPrint && job == null) SecondaryButton("Print badge", icon = Icons.Outlined.Print) { print() }
                PrimaryButton("Scan next") { result = null; job = null }
            }
        }
    }

    if (lookup) ModalBottomSheet({ lookup = false }, containerColor = C.Surface) {
        LookupSheet(gate) { row -> lookup = false; action.run { job = null; result = Repo.scan(gate, "", row.passId) } }
    }
    reasonFor?.let { kind ->
        var reason by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { reasonFor = null },
            title = { Text(if (kind == "override") "Override and admit" else "Reprint badge") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(if (kind == "override") "Use only when you have checked the person's entitlement. Your name and the reason are recorded." else "This person already has a printed badge. Reprints are recorded.")
                    LabeledField("Reason", reason, { reason = it }, singleLine = false)
                }
            },
            confirmButton = {
                LinkButton(if (kind == "override") "Admit" else "Reprint") {
                    if (reason.isBlank()) return@LinkButton
                    reasonFor = null
                    if (kind == "reprint") print(reason)
                    else action.run { result = Api.post("/gate/override", body("gateId" to gate.id, "deviceId" to Repo.device?.deviceId, "id" to ScanRules.newScanId(), "passId" to result?.passId, "reason" to reason)) }
                }
            },
            dismissButton = { LinkButton("Cancel") { reasonFor = null } },
        )
    }
    if (leaving) AlertDialog(
        onDismissRequest = { leaving = false },
        title = { Text("Leave this gate?") },
        text = { Text(if (Repo.queue.isEmpty()) "The saved eligibility data for this gate is cleared from this phone." else "${Repo.queue.size} scans have not been uploaded and will be lost. Sync first if you can.") },
        confirmButton = { LinkButton("Leave gate") { leaving = false; Repo.leaveGate() } },
        dismissButton = { LinkButton("Stay") { leaving = false } },
    )
}

// Find a person when their QR will not scan. Shows the least needed to pick the right one.
@Composable
private fun LookupSheet(gate: Gate, onPick: (LookupRow) -> Unit) {
    var query by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf<List<LookupRow>?>(null) }
    val action = rememberAction()
    Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle("Manual lookup")
        LabeledField("Name, company, reference or email", query, { query = it })
        PrimaryButton("Search", busy = action.busy, enabled = query.trim().length >= 2) {
            action.run { rows = Api.get("/gate/lookup?gateId=${gate.id}&q=${java.net.URLEncoder.encode(query.trim(), "UTF-8")}") }
        }
        rows?.let { list ->
            Panel {
                list.forEachIndexed { i, p ->
                    if (i > 0) Divider()
                    ListRow(onClick = if (p.status == "active") ({ onPick(p) }) else null) {
                        Column(Modifier.weight(1f)) {
                            Text(p.name, fontWeight = FontWeight.SemiBold)
                            Text(listOfNotNull(p.company, p.passClass, p.ref, p.email).joinToString(" · "), color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
                        }
                        when {
                            p.status != "active" -> StatusChip("Cancelled", StatusTone.ERROR)
                            p.admittedAt != null -> StatusChip("In ${clock(p.admittedAt)}", StatusTone.OK)
                            else -> StatusChip("Not yet in")
                        }
                    }
                }
                if (list.isEmpty()) Text("No one found. Check the spelling, or send the visitor to the help desk.", Modifier.padding(24.dp), color = C.Ink2)
            }
        }
        Text("Check a photo ID before admitting someone found by lookup.", color = C.Ink2, style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.size(24.dp))
    }
}
