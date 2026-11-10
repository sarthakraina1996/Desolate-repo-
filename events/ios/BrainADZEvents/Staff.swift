// Authorised workspaces: the exhibitor's booth, team and lead capture, and the gate scanner
// with manual lookup, override and badge printing. The server decides what each role may do;
// these screens only show the actions it allows.
import SwiftUI

// MARK: Exhibitor
// Leads with the booth, hall and the next required action; then checklist and order totals.
struct BoothScreen: View {
    let role: ExhibitorRole
    var body: some View {
        Loader(load: { try await Api.get("/exhibitor/\(role.exhibitorId)") as Workspace }) { ws, _ in
            Screen {
                VStack(alignment: .leading, spacing: 2) {
                    Eyebrow(text: ws.event.name)
                    HStack(spacing: 8) {
                        Text(ws.booth.map { "Booth \($0.code)" } ?? ws.exhibitor.companyName).font(.largeTitle.weight(.semibold))
                        StatusChip(text: StatusTone.label(ws.booth?.status ?? ws.exhibitor.status), tone: .of(ws.booth?.status ?? ws.exhibitor.status))
                    }
                    Text(ws.booth.map { "\($0.hall) / \(ws.exhibitor.companyName)" } ?? "Exhibitor workspace").foregroundColor(.ink2)
                }
                Notice(text: "Next: \(ws.next.text)", tone: ws.next.key == "none" ? .ok : .neutral)
                if let note = ws.exhibitor.reviewNote, ws.exhibitor.status != "approved" { Notice(text: "Organiser: \(note)", tone: .pending) }
                if !ws.checklist.isEmpty {
                    SectionTitle(text: "Setup checklist")
                    Panel {
                        ForEach(ws.checklist) { c in
                            ListRow(fill: c.status == "complete" ? .selectedFill : .surface) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(c.title).bold()
                                    Text(c.status == "complete" ? "Done" : "\(c.overdue ? "Overdue, was due" : "Due") \(Fmt.day(c.dueOn))")
                                        .font(.subheadline).foregroundColor(c.overdue ? .errorText : .ink2)
                                    if let note = c.note { Text("Organiser: \(note)").font(.subheadline).foregroundColor(.errorText) }
                                }
                                Spacer(minLength: 0)
                                if c.key == "team" && c.status != "complete" { StatusChip(text: "\(ws.team.count) of \(ws.badgeQuota) added") }
                                else { StatusChip(text: StatusTone.label(c.status), tone: .of(c.status)) }
                            }
                            Rule()
                        }
                    }
                }
                if !ws.orders.isEmpty {
                    SectionTitle(text: "Order summary")
                    Panel {
                        ForEach(ws.orders) { o in
                            ListRow { Text(o.kind == "booth" ? "Stand package" : "Services"); Spacer(); Text(Fmt.inr(o.totalPaise)).monospacedDigit() }
                            Rule()
                        }
                        ListRow { Text("Received"); Spacer(); Text(Fmt.inr(ws.totals.paidPaise)).foregroundColor(.okText).monospacedDigit() }
                        Rule()
                        ListRow { Text("Balance due").bold(); Spacer(); Text(Fmt.inr(ws.totals.balancePaise)).bold().monospacedDigit() }
                    }
                    Text("Pay orders, upload documents and order services in the exhibitor workspace on the web.").font(.subheadline).foregroundColor(.ink2)
                }
            }
        }
    }
}

struct TeamScreen: View {
    let role: ExhibitorRole
    @State var adding = false
    @State var name = ""
    @State var email = ""
    @StateObject var action = ActionRunner()
    var body: some View {
        Loader(load: { try await Api.get("/exhibitor/\(role.exhibitorId)") as Workspace }) { ws, reload in
            Screen {
                ScreenTitle(title: "Team badges", eyebrow: ws.exhibitor.companyName)
                Text("\(ws.team.count) of \(ws.badgeQuota) badges used. Each person signs in with their own email.").foregroundColor(.ink2)
                Panel {
                    ForEach(ws.team) { t in
                        ListRow {
                            VStack(alignment: .leading) {
                                Text(t.name).bold()
                                Text("\(t.email) · \(t.role == "exhibitor_admin" ? "Admin" : "Booth staff")").font(.subheadline).foregroundColor(.ink2)
                            }
                            Spacer(minLength: 0)
                            StatusChip(text: StatusTone.label(t.status), tone: .of(t.status))
                        }
                        Rule()
                    }
                }
                if role.perms.contains("x.team") {
                    if ws.team.count >= ws.badgeQuota { Notice(text: "All badges are in use. Ask the organiser for a larger quota.", tone: .pending) }
                    else { Button("Invite staff") { adding = true }.buttonStyle(PrimaryButtonStyle()) }
                }
            }
            .sheet(isPresented: $adding) {
                Screen {
                    SectionTitle(text: "Invite booth staff")
                    LabeledField(label: "Name on badge", text: $name)
                    LabeledField(label: "Email", text: $email, keyboard: .emailAddress)
                    Button("Send invitation") {
                        action.run {
                            try await Api.raw("POST", "/exhibitor/\(role.exhibitorId)/team", ["name": name, "email": email, "role": "booth_staff"])
                            adding = false; name = ""; email = ""
                            reload()
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle()).disabled(action.busy || name.isEmpty || !email.contains("@"))
                    Button("Cancel") { adding = false }.buttonStyle(LinkButtonStyle())
                }
                .messages(action)
                .presentationDetents([.medium])
            }
        }
    }
}

struct LeadsScreen: View {
    let role: ExhibitorRole
    @State var query = ""
    var body: some View {
        Loader(load: { try await Api.get("/exhibitor/\(role.exhibitorId)/leads") as [Lead] }) { leads, _ in
            let q = query.trimmingCharacters(in: .whitespaces).lowercased()
            let rows = leads.filter { l in q.isEmpty || ([l.name, l.company, l.notes].compactMap { $0 } + l.tags).contains { $0.lowercased().contains(q) } }
            Screen {
                ScreenTitle(title: "Leads", eyebrow: role.companyName)
                LabeledField(label: "Search leads", text: $query, hint: "Name, company, interest or notes")
                Text("\(rows.count) of \(leads.count) leads. Each visitor appears once.").font(.subheadline).foregroundColor(.ink2)
                Panel {
                    ForEach(rows) { l in
                        ListRow {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(l.name ?? "").bold()
                                Text([l.jobTitle, l.company].compactMap { $0 }.joined(separator: ", ")).font(.subheadline).foregroundColor(.ink2)
                                if !l.tags.isEmpty { Text(l.tags.joined(separator: " · ")).font(.subheadline) }
                                if let notes = l.notes { Text(notes).font(.subheadline).foregroundColor(.ink2) }
                            }
                            Spacer(minLength: 0)
                            if let r = l.rating { StatusChip(text: r.capitalized, tone: r == "hot" ? .error : r == "warm" ? .pending : .neutral) }
                        }
                        Rule()
                    }
                    if rows.isEmpty { Text("No leads yet. Scan a visitor's badge to capture one.").foregroundColor(.ink2).padding(24) }
                }
                Text("Lead export is for exhibitor admins, in the web workspace. Exports are logged.").font(.subheadline).foregroundColor(.ink2)
            }
        }
    }
}

// One-handed scan-and-qualify: scan, tap a rating and tags, save, scan the next badge.
struct LeadScanScreen: View {
    let role: ExhibitorRole
    @State var out: LeadScanOut?
    @State var error: String?
    @State var rating = ""
    @State var tags: [String] = []
    @State var notes = ""
    @State var typed = ""
    @StateObject var action = ActionRunner()

    func scan(_ qr: String) {
        action.run {
            do {
                let r: LeadScanOut = try await Api.post("/exhibitor/\(role.exhibitorId)/leads/scan", ["qr": qr])
                out = r; error = nil; rating = r.lead.rating ?? ""; tags = r.lead.tags; notes = r.lead.notes ?? ""
            } catch let e as ApiError {
                error = e.message
            }
        }
    }
    var body: some View {
        Loader(load: { try await Api.get("/exhibitor/\(role.exhibitorId)") as Workspace }) { ws, _ in
            VStack(spacing: 0) {
                Screen {
                    ScreenTitle(title: "Scan a badge", eyebrow: ws.booth.map { "Booth \($0.code)" } ?? ws.exhibitor.companyName)
                    if let current = out {
                        ResultPanel(tone: .ok, title: current.duplicate ? "Already a lead" : "Lead saved", hint: current.duplicate ? "Scanned \(current.lead.scanCount) times. Details updated." : "Add what you learned.")
                        VStack(alignment: .leading) {
                            Text(current.lead.name ?? "").font(.title2.weight(.semibold))
                            Text([current.lead.jobTitle, current.lead.company].compactMap { $0 }.joined(separator: ", ")).foregroundColor(.ink2)
                        }
                        Text("How interested?").bold()
                        HStack(spacing: 8) { ForEach(["hot", "warm", "cold"], id: \.self) { r in Chip(text: r.capitalized, selected: rating == r) { rating = rating == r ? "" : r } } }
                        Text("Interested in").bold()
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(Array(Set(ws.interestTags + tags)).sorted(), id: \.self) { t in
                                    Chip(text: t, selected: tags.contains(t)) { if tags.contains(t) { tags.removeAll { $0 == t } } else { tags.append(t) } }
                                }
                            }
                        }
                        LabeledField(label: "Notes (optional)", text: $notes, multiline: true)
                    } else {
                        QrScanner { scan($0) }
                        if let error = error { Notice(text: error, tone: .error) }
                        else { Text("Point the camera at the QR on a visitor's badge. Ask before you scan.").foregroundColor(.ink2) }
                        LabeledField(label: "Or type the code", text: $typed, keyboard: .asciiCapable)
                        if !typed.isEmpty { Button("Add") { scan(typed); typed = "" }.buttonStyle(SecondaryButtonStyle()) }
                    }
                }
                if let current = out {
                    Button("Save and scan next") {
                        action.run {
                            try await Api.raw("PUT", "/exhibitor/\(role.exhibitorId)/leads/\(current.lead.id)", ["rating": rating.isEmpty ? nil : rating, "tags": tags, "notes": notes])
                            out = nil
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle()).disabled(action.busy).padding(16).background(Color.surface)
                }
            }
        }
        .messages(action)
    }
}

// MARK: Gate
// One large result, readable at arm's length: colour, icon and words together.
struct ResultPanel: View {
    let tone: Tone
    let title: String
    let hint: String
    var body: some View {
        let style: (Color, Color, String) = tone == .ok ? (.okText, .okFill, "checkmark.circle") : tone == .warn ? (.pendingText, .pendingFill, "exclamationmark.circle") : (.errorText, .errorFill, "xmark.circle")
        HStack(spacing: 16) {
            Image(systemName: style.2).font(.system(size: 52))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.title.weight(.semibold))
                if !hint.isEmpty { Text(hint) }
            }
            Spacer(minLength: 0)
        }
        .foregroundColor(style.0).padding(20)
        .background(style.1, in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .combine)
        .onAppear {
            UIAccessibility.post(notification: .announcement, argument: "\(title). \(hint)")
            UINotificationFeedbackGenerator().notificationOccurred(tone == .ok ? .success : tone == .warn ? .warning : .error)
        }
    }
}

struct GateScreen: View {
    @EnvironmentObject var repo: Repo
    @StateObject var action = ActionRunner()
    var body: some View {
        Loader(load: { try await Api.get("/gate/context") as [GateContext] }) { contexts, _ in
            let ctx = contexts.first { $0.event.id == repo.device?.eventId }
            if let ctx = ctx, let gate = ctx.gates.first(where: { $0.id == repo.device?.gateId }) {
                GateScanner(ctx: ctx, gate: gate)
            } else {
                Screen {
                    ScreenTitle(title: "Gate scanner")
                    if contexts.isEmpty { Notice(text: "You are not assigned to a gate. Ask the organiser to add you as gate staff.", tone: .error) }
                    ForEach(contexts) { c in
                        SectionTitle(text: c.event.name)
                        Text("Choose the gate you are working at. This phone is then enrolled for that gate.").foregroundColor(.ink2)
                        Panel {
                            ForEach(c.gates) { g in
                                Button { action.run { try await repo.enrol(c, g) } } label: {
                                    ListRow {
                                        VStack(alignment: .leading) { Text(g.name).bold(); Text("Opens into \(g.zoneName)").font(.subheadline).foregroundColor(.ink2) }
                                        Spacer(minLength: 0)
                                        if g.restricted { StatusChip(text: "Online only", tone: .pending) }
                                    }
                                }
                                .buttonStyle(.plain)
                                Rule()
                            }
                        }
                    }
                }
                .messages(action)
            }
        }
    }
}

struct GateScanner: View {
    let ctx: GateContext
    let gate: Gate
    @EnvironmentObject var repo: Repo
    @State var result: ScanResult?
    @State var job: PrintJob?
    @State var lookup = false
    @State var reasonFor: String? // "override" or "reprint"
    @State var reason = ""
    @State var leaving = false
    @StateObject var action = ActionRunner()

    func syncNow() {
        action.run {
            let queued = repo.queue.count
            let conflicts = await repo.sync()
            if conflicts == nil { action.message = "Still offline. \(repo.queue.count) scans stay queued on this phone." }
            else if let c = conflicts, c > 0 { action.message = "\(c) queued scan(s) were also admitted on another device. Flagged for the organiser." }
            else if queued > 0 { action.message = "\(queued) queued scan(s) uploaded." }
        }
    }
    func printBadge(_ why: String? = nil) {
        action.run {
            do {
                job = try await Api.post("/gate/print", ["gateId": gate.id, "passId": result?.passId, "reason": why])
            } catch let e as ApiError {
                if e.status == 400 && ctx.canReprint && why == nil { reason = ""; reasonFor = "reprint" }
                else if e.status == 403 { throw ApiError(status: 403, message: "This badge was already printed. Ask a supervisor for a reprint.") }
                else { throw e }
            }
        }
    }
    func submitReason() {
        let kind = reasonFor
        let why = reason
        reasonFor = nil
        if kind == "reprint" { printBadge(why) } else {
            action.run {
                result = try await Api.post("/gate/override", ["gateId": gate.id, "deviceId": repo.device?.deviceId, "id": ScanRules.newScanId(), "passId": result?.passId, "reason": why])
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Gate context and connection state, always visible.
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(gate.name).font(.title2.weight(.semibold))
                    Text(repo.online ? (repo.queue.isEmpty ? "Online · synced \(Fmt.clock(repo.bundle?.loadedAt))" : "Online · \(repo.queue.count) queued, uploading") : "Offline · \(repo.queue.count) queued")
                        .font(.body.weight(.semibold)).foregroundColor(repo.online && repo.queue.isEmpty ? .okText : .pendingText)
                    Text("\(ctx.event.name) · \(gate.zoneName)").font(.subheadline).foregroundColor(.ink2)
                }
                Spacer()
                Button(action: syncNow) { Image(systemName: "arrow.triangle.2.circlepath").frame(width: 44, height: 44) }
                    .disabled(repo.syncing).accessibilityLabel("Sync now")
            }
            .padding(16).background(Color.surface)
            Rule()
            Screen {
                if let r = result {
                    let info = ScanRules.info(r.result)
                    ResultPanel(tone: info.tone, title: info.title, hint: info.hint)
                    if let name = r.name {
                        VStack(alignment: .leading) {
                            Text(name).font(.title2.weight(.semibold))
                            Text([r.passClass, r.company].compactMap { $0 }.joined(separator: " · ")).foregroundColor(.ink2)
                        }
                    }
                    if let e = r.earlier { Text("First admitted at \(e.gate), \(Fmt.clock(e.at)).") }
                    if r.offline == true {
                        Notice(text: r.bundleExpired == true ? "The saved eligibility data has expired. Reconnect to scan." : "Decided offline from saved data. This scan is queued and will be checked when the connection returns.", tone: .pending)
                    }
                    if r.conflict == true { Notice(text: "Another device also admitted this pass. Flagged for the organiser.", tone: .error) }
                    // Denied or uncertain scans get a clear way forward.
                    if info.tone != .ok {
                        SectionTitle(text: "What to do")
                        Panel {
                            Button { result = nil; lookup = true } label: { ListRow { Image(systemName: "magnifyingglass"); Text("Look the person up by name or reference") } }.buttonStyle(.plain)
                            if ctx.canOverride && r.passId != nil {
                                Rule()
                                Button { reason = ""; reasonFor = "override" } label: { ListRow { Image(systemName: "checkmark.circle"); Text("Override and admit, with a reason") } }.buttonStyle(.plain)
                            }
                            Rule()
                            ListRow { Text("Otherwise send the visitor to the help desk\(ctx.canOverride ? "" : ". Only a supervisor can override").").foregroundColor(.ink2) }
                        }
                    }
                    // A printer failure is separate from admission: the visitor is still in.
                    if let j = job {
                        if j.status == "printed" { Notice(text: "Badge printed on \(j.printer ?? "the printer").", tone: .ok) }
                        else if j.status == "failed" {
                            Notice(text: "Printer problem: \(j.error ?? "unknown"). The visitor is still admitted.", tone: .error)
                            Button("Retry") { action.run { job = try await Api.post("/gate/print-jobs/\(j.id)/retry") } }.buttonStyle(SecondaryButtonStyle())
                            Button("Use spare printer") { action.run { job = try await Api.post("/gate/print-jobs/\(j.id)/spare") } }.buttonStyle(SecondaryButtonStyle())
                        } else { Notice(text: "Badge sent to the print station.", tone: .pending) }
                    }
                } else {
                    if gate.restricted { Notice(text: "Restricted area: scans here are only decided online.", tone: .pending) }
                    QrScanner { code in
                        guard result == nil, !lookup, !action.busy else { return }
                        action.run { job = nil; result = try await repo.scan(gate, text: code) }
                    }
                    Text("Hold the visitor's QR inside the frame.").foregroundColor(.ink2)
                }
            }
            // Actions sit at the bottom, within thumb reach.
            VStack(spacing: 8) {
                if let r = result {
                    if ScanRules.isAdmit(r.result) && r.passId != nil && ctx.canPrint && job == nil {
                        Button { printBadge() } label: { Label("Print badge", systemImage: "printer") }.buttonStyle(SecondaryButtonStyle())
                    }
                    Button("Scan next") { result = nil; job = nil }.buttonStyle(PrimaryButtonStyle())
                } else {
                    Button { lookup = true } label: { Label(repo.online ? "Manual lookup" : "Manual lookup (needs connection)", systemImage: "magnifyingglass") }
                        .buttonStyle(SecondaryButtonStyle()).disabled(!repo.online)
                    Button("Change gate") { leaving = true }.buttonStyle(LinkButtonStyle())
                }
            }
            .padding(16).background(Color.surface)
        }
        .background(Color.canvas)
        .messages(action)
        .sheet(isPresented: $lookup) {
            LookupSheet(gate: gate) { row in
                lookup = false
                action.run { job = nil; result = try await repo.scan(gate, text: "", passId: row.passId) }
            }
        }
        .sheet(isPresented: Binding(get: { reasonFor != nil }, set: { if !$0 { reasonFor = nil } })) {
            Screen {
                SectionTitle(text: reasonFor == "override" ? "Override and admit" : "Reprint badge")
                Text(reasonFor == "override" ? "Use only when you have checked the person's entitlement. Your name and the reason are recorded." : "This person already has a printed badge. Reprints are recorded.")
                LabeledField(label: "Reason", text: $reason, multiline: true)
                Button(reasonFor == "override" ? "Admit" : "Reprint", action: submitReason).buttonStyle(PrimaryButtonStyle()).disabled(reason.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Cancel") { reasonFor = nil }.buttonStyle(LinkButtonStyle())
            }
            .presentationDetents([.medium])
        }
        .confirmationDialog(repo.queue.isEmpty ? "The saved eligibility data for this gate is cleared from this phone." : "\(repo.queue.count) scans have not been uploaded and will be lost. Sync first if you can.", isPresented: $leaving, titleVisibility: .visible) {
            Button("Leave gate", role: .destructive) { repo.leaveGate() }
        }
        // Retry in the background while there is something queued or the phone was offline.
        .task(id: gate.id) {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                if !repo.queue.isEmpty || !repo.online { await repo.sync() }
            }
        }
    }
}

// Find a person when their QR will not scan. Shows the least needed to pick the right one.
struct LookupSheet: View {
    let gate: Gate
    let onPick: (LookupRow) -> Void
    @State var query = ""
    @State var rows: [LookupRow]?
    @StateObject var action = ActionRunner()
    var body: some View {
        Screen {
            SectionTitle(text: "Manual lookup")
            LabeledField(label: "Name, company, reference or email", text: $query)
            Button("Search") {
                action.run {
                    let q = query.trimmingCharacters(in: .whitespaces).addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
                    rows = try await Api.get("/gate/lookup?gateId=\(gate.id)&q=\(q)")
                }
            }
            .buttonStyle(PrimaryButtonStyle()).disabled(action.busy || query.trimmingCharacters(in: .whitespaces).count < 2)
            if let rows = rows {
                Panel {
                    ForEach(rows) { p in
                        Button { onPick(p) } label: {
                            ListRow {
                                VStack(alignment: .leading) {
                                    Text(p.name).bold()
                                    Text([p.company, p.passClass, p.ref, p.email].compactMap { $0 }.joined(separator: " · ")).font(.subheadline).foregroundColor(.ink2)
                                }
                                Spacer(minLength: 0)
                                if p.status != "active" { StatusChip(text: "Cancelled", tone: .error) }
                                else if let at = p.admittedAt { StatusChip(text: "In \(Fmt.clock(at))", tone: .ok) }
                                else { StatusChip(text: "Not yet in") }
                            }
                        }
                        .buttonStyle(.plain).disabled(p.status != "active")
                        Rule()
                    }
                    if rows.isEmpty { Text("No one found. Check the spelling, or send the visitor to the help desk.").foregroundColor(.ink2).padding(24) }
                }
            }
            Text("Check a photo ID before admitting someone found by lookup.").font(.subheadline).foregroundColor(.ink2)
        }
        .messages(action)
    }
}
