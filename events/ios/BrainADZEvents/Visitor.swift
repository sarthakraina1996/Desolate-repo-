// Visitor screens: Pass, Explore, Agenda, Profile, plus sign-in and registration.
import SwiftUI
import UserNotifications

// MARK: Pass
// The pass laid out like a printed ticket: event band, holder and access, then a tear-off stub
// with a large, quiet QR code. Same design as the web app.
struct PassCard: View {
    let pass: Pass
    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(pass.event.name).font(.headline.weight(.bold))
                    Text("\(Fmt.dateRange(pass.validFrom, pass.validTo)) · \(pass.event.openTime)–\(pass.event.closeTime)").font(.subheadline).opacity(0.82)
                    if let venue = pass.event.venueName { Text(venue).font(.subheadline).opacity(0.82) }
                }
                Spacer(minLength: 0)
                Text(pass.passClass.name).font(.footnote.weight(.semibold))
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(Color.petrol, in: Capsule())
            }
            .foregroundColor(.white)
            .padding(.horizontal, 20).padding(.vertical, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.navy)
            VStack(alignment: .leading, spacing: 2) {
                Text(pass.holderName).font(.title2.weight(.bold))
                if let company = pass.holderCompany { Text(company).foregroundColor(.ink2) }
                HStack(alignment: .top, spacing: 12) {
                    ticketField("Enter at", pass.gates.isEmpty ? "Any gate" : pass.gates.joined(separator: ", "))
                    ticketField("Access", pass.zones.isEmpty ? "Show floor" : pass.zones.joined(separator: ", "))
                }
                .padding(.top, 12)
            }
            .padding(.horizontal, 20).padding(.top, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
            Perforation().frame(height: 36)
            VStack(spacing: 8) {
                if let qr = pass.qr {
                    QrImage(text: qr, label: "QR code for \(pass.holderName)'s pass").frame(width: 210, height: 210)
                } else {
                    Notice(text: "This pass is no longer valid.", tone: .error)
                }
                if let ref = pass.ref { Text(ref).font(.callout.weight(.semibold)).kerning(2).foregroundColor(.ink2) }
                Text(pass.instructions).font(.subheadline).foregroundColor(.ink2).multilineTextAlignment(.center).padding(.top, 4)
            }
            .padding(.horizontal, 20).padding(.bottom, 20)
        }
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .shadow(color: .black.opacity(0.1), radius: 12, y: 6)
    }
    private func ticketField(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.subheadline).foregroundColor(.ink2)
            Text(value).font(.body.weight(.semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
// Dashed tear line with a half-circle notch cut from each side.
struct Perforation: View {
    var body: some View {
        GeometryReader { g in
            let y = g.size.height / 2
            ZStack {
                Path { p in p.move(to: CGPoint(x: 18, y: y)); p.addLine(to: CGPoint(x: g.size.width - 18, y: y)) }
                    .stroke(Color.rule, style: StrokeStyle(lineWidth: 2, dash: [6, 5]))
                Circle().fill(Color.canvas).frame(width: 24, height: 24).position(x: 0, y: y)
                Circle().fill(Color.canvas).frame(width: 24, height: 24).position(x: g.size.width, y: y)
            }
        }
        .accessibilityHidden(true)
    }
}

// Where a registration stands, and the one thing to do next.
struct RegistrationCard: View {
    let reg: Registration
    @EnvironmentObject var repo: Repo
    @Environment(\.openURL) var openURL
    @StateObject var action = ActionRunner()
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow(text: "\(reg.event.name) · \(reg.passClass.name)")
            switch reg.step {
            case "pass":
                if let pass = reg.pass { PassCard(pass: pass) }
                if reg.pass?.firstAdmittedAt != nil { Notice(text: "Admitted. Keep this pass for re-entry.", tone: .ok) }
            case "payment":
                Notice(text: "Payment needed. Your \(reg.passClass.name) place is held; the pass is issued as soon as payment is confirmed.\(reg.paymentStatus == "failed" ? " The last attempt did not go through." : "")", tone: .pending)
                if let order = reg.order {
                    Panel {
                        ForEach(order.items, id: \.self) { item in
                            ListRow { Text(item.description); Spacer(); Text(Fmt.inr(item.amountPaise)).monospacedDigit() }
                            Rule()
                        }
                        ListRow { Text("GST"); Spacer(); Text(Fmt.inr(order.gstPaise)).monospacedDigit() }
                        Rule()
                        ListRow { Text("Total").bold(); Spacer(); Text(Fmt.inr(order.balancePaise)).bold().monospacedDigit() }
                    }
                    // Physical event tickets are paid on the provider's hosted checkout, in the browser.
                    Button("Pay \(Fmt.inr(order.balancePaise))") {
                        action.run {
                            let url = try await repo.checkoutUrl(order)
                            openURL(url)
                        }
                    }
                        .buttonStyle(PrimaryButtonStyle()).disabled(action.busy)
                    Text("You pay on a secure hosted checkout page by UPI or card. Come back here afterwards; your pass appears once payment is confirmed.")
                        .font(.subheadline).foregroundColor(.ink2)
                }
            case "review":
                Notice(text: "Awaiting review. The organiser reviews \(reg.passClass.name) registrations and will email \(reg.email) with a decision. Reference \(reg.ref).", tone: .pending)
            case "rejected":
                Notice(text: "Not approved. \(reg.reviewNote ?? "The organiser could not approve this registration.") Reference \(reg.ref).", tone: .error)
            default:
                Notice(text: "Cancelled. This registration (\(reg.ref)) was cancelled and its pass no longer works.", tone: .error)
            }
            if ["pass", "payment", "review"].contains(reg.step) {
                Button("Cancel registration") { action.run { try await repo.cancel(reg) } }.buttonStyle(LinkButtonStyle())
            }
        }
        .messages(action)
    }
}

struct PassScreen: View {
    @EnvironmentObject var repo: Repo
    let onRegister: () -> Void
    let onSignIn: () -> Void
    @State var brightness = UIScreen.main.brightness
    var body: some View {
        let regs = repo.passes.registrations.isEmpty ? [repo.linked].compactMap { $0 } : repo.passes.registrations
        Screen {
            ScreenTitle(title: regs.count + repo.passes.badges.count == 1 ? "My ticket" : "My tickets", eyebrow: repo.guide?.event.name)
            if !repo.online {
                Notice(text: "Offline. Showing the tickets saved on this phone\(repo.passes.syncedAt.isEmpty ? "" : ", last updated \(Fmt.clock(repo.passes.syncedAt))").", tone: .pending)
            }
            ForEach(repo.passes.badges) { PassCard(pass: $0) }
            ForEach(regs) { RegistrationCard(reg: $0) }
            if regs.isEmpty && repo.passes.badges.isEmpty {
                Text("You have no ticket yet. Register for \(repo.guide?.event.name ?? "the event"), or sign in to load a ticket you already have.").foregroundColor(.ink2)
                Button("Register", action: onRegister).buttonStyle(PrimaryButtonStyle())
                Button(repo.signedIn ? "Refresh" : "Sign in or find my ticket", action: onSignIn).buttonStyle(SecondaryButtonStyle())
            }
        }
        .refreshable { await repo.start() }
        // Full brightness while the QR is on screen makes it easier to scan at the gate.
        .onAppear { brightness = UIScreen.main.brightness; UIScreen.main.brightness = 1 }
        .onDisappear { UIScreen.main.brightness = brightness }
    }
}

// MARK: Explore
struct ExhibitorRow: View {
    let ex: Exhibitor
    var body: some View {
        ListRow {
            Monogram(name: ex.name)
            VStack(alignment: .leading, spacing: 1) {
                Text(ex.name).bold()
                Text(ex.industry ?? ex.categories.joined(separator: ", ")).font(.subheadline).foregroundColor(.ink2)
            }
            Spacer(minLength: 0)
            if let code = ex.boothCode {
                Text(code).font(.footnote.weight(.semibold)).foregroundColor(.navy)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Color(hex: 0xEEF1F9), in: RoundedRectangle(cornerRadius: 6))
            }
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundColor(Color(hex: 0xA3A8B3))
        }
    }
}

// Exhibitor details in a bottom sheet.
struct ExhibitorSheet: View {
    let ex: Exhibitor
    var onShowOnPlan: (() -> Void)?
    @Environment(\.openURL) var openURL
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    Monogram(name: ex.name, size: 56)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ex.name).font(.title3.weight(.semibold))
                        Text(ex.boothCode.map { "Stall \($0)\(ex.hall.map { " · \($0)" } ?? "")" } ?? "Stall to be announced").foregroundColor(.ink2)
                    }
                }
                if let text = ex.description { Text(text) }
                if !ex.categories.isEmpty { Text(ex.categories.joined(separator: " · ")).font(.subheadline).foregroundColor(.ink2) }
                if let show = onShowOnPlan { Button("Show on floor plan", action: show).buttonStyle(PrimaryButtonStyle()) }
                ForEach((ex.website.map { [WebLink(label: "Website", url: $0)] } ?? []) + ex.catalogueLinks, id: \.self) { link in
                    if let url = URL(string: link.url) { Button(link.label) { openURL(url) }.buttonStyle(SecondaryButtonStyle()) }
                }
            }
            .padding(20).padding(.top, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

struct ExploreScreen: View {
    let guide: Guide
    @EnvironmentObject var repo: Repo
    @State var query = ""
    @State var category: String?
    @State var view = "list"
    @State var hallId: Int?
    @State var boothId: Int?
    @State var open: Exhibitor?
    var body: some View {
        let halls = guide.halls.filter { $0.cols > 0 }
        let hall = halls.first { $0.id == hallId } ?? halls.first
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let categories = Array(Set(guide.exhibitors.flatMap { $0.categories })).sorted()
        let matches = guide.exhibitors.filter { e in
            (category == nil || e.categories.contains(category!)) &&
                (q.isEmpty || ([e.name, e.boothCode ?? "", e.industry ?? ""] + e.categories).contains { $0.lowercased().contains(q) })
        }
        .sorted { $0.name.lowercased() < $1.name.lowercased() }
        Screen {
            ScreenTitle(title: "Explore")
            Segmented(options: [("Exhibitors", "list"), ("Floor plan", "map")], value: $view)
            if view == "map", let hall = hall {
                if halls.count > 1 {
                    Segmented(options: halls.map { ($0.name, $0.id) }, value: Binding(get: { hall.id }, set: { hallId = $0; boothId = nil }))
                }
                Panel { HallPlan(hall: hall, selected: boothId) { b in boothId = b.exhibitorId != nil ? b.id : nil }.padding(12) }
                if let ex = guide.exhibitors.first(where: { $0.boothId == boothId && boothId != nil }) {
                    Panel { Button { open = ex } label: { ExhibitorRow(ex: ex) }.buttonStyle(.plain) }
                } else {
                    Text("Tap a stall to see who is there. Dashed stalls are free.").font(.subheadline).foregroundColor(.ink2)
                }
                if !hall.amenities.isEmpty {
                    Panel {
                        ForEach(hall.amenities) { a in
                            ListRow { Text(a.label); Spacer(); if a.accessible { StatusChip(text: "Step-free", tone: .ok) } }
                            Rule()
                        }
                    }
                }
            } else {
                LabeledField(label: "Search exhibitors", text: $query, hint: "Company, stall or product")
                if !categories.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            Chip(text: "All", selected: category == nil) { category = nil }
                            ForEach(categories, id: \.self) { c in Chip(text: c, selected: category == c) { category = category == c ? nil : c } }
                        }
                    }
                }
                Text(matches.count == guide.exhibitors.count ? "\(matches.count) exhibitors" : "\(matches.count) of \(guide.exhibitors.count) exhibitors")
                    .font(.subheadline).foregroundColor(.ink2)
                if matches.isEmpty {
                    Text("No exhibitors match. Try a different search.").foregroundColor(.ink2)
                } else {
                    Panel {
                        ForEach(Array(matches.enumerated()), id: \.element.id) { i, e in
                            if i > 0 { Rule() }
                            Button { open = e } label: { ExhibitorRow(ex: e) }.buttonStyle(.plain)
                        }
                    }
                }
            }
            if !repo.online { Text("Offline. Showing the guide saved \(Fmt.clock(guide.savedAt)).").font(.subheadline).foregroundColor(.pendingText) }
        }
        .sheet(item: $open) { ex in
            ExhibitorSheet(ex: ex, onShowOnPlan: view == "map" || ex.boothId == nil ? nil : {
                hallId = halls.first { h in h.booths.contains { $0.id == ex.boothId } }?.id
                boothId = ex.boothId; view = "map"; open = nil
            })
        }
    }
}

// MARK: Agenda
struct SessionRow: View {
    let s: AgendaSession
    let colour: Color
    let live: Bool
    let marked: Bool
    var onToggle: (() -> Void)?
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading) {
                Text(s.startTime).bold().monospacedDigit()
                Text(s.endTime).font(.subheadline).foregroundColor(.ink2).monospacedDigit()
            }
            .frame(width: 52, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                if live {
                    Text("On now").font(.caption.weight(.bold)).foregroundColor(.white)
                        .padding(.horizontal, 8).padding(.vertical, 1).background(Color.petrol, in: Capsule())
                }
                Text(s.title).bold()
                Text([s.room, s.track].compactMap { $0 }.joined(separator: " · ")).font(.subheadline).foregroundColor(.ink2)
                if !s.speakers.isEmpty {
                    Text(s.speakers.map { p in p.title.map { "\(p.name), \($0)" } ?? p.name }.joined(separator: "; ")).font(.subheadline)
                }
                if s.full { StatusChip(text: "Full", tone: .pending) }
            }
            Spacer(minLength: 0)
            if let toggle = onToggle {
                Button(action: toggle) {
                    Image(systemName: marked ? "bookmark.fill" : "bookmark").foregroundColor(marked ? .petrol : .control).frame(width: 44, height: 44)
                }
                .accessibilityLabel(marked ? "Remove bookmark for \(s.title)" : "Bookmark \(s.title)")
            }
        }
        .padding(.leading, 14).padding(.trailing, 8).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .leading) { TrackBar().fill(colour).frame(width: 4) }
    }
}
// The coloured track bar at the left edge of a session row.
struct TrackBar: Shape {
    func path(in rect: CGRect) -> Path { Path(roundedRect: rect, cornerSize: CGSize(width: 2, height: 2)) }
}

struct AgendaScreen: View {
    let guide: Guide
    @EnvironmentObject var repo: Repo
    @State var day = ""
    @State var track: Int?
    @State var mine = false
    @StateObject var action = ActionRunner()
    var body: some View {
        let days = Array(Set(guide.agenda.sessions.filter { $0.status == "scheduled" }.map { $0.day })).sorted()
        let today = Fmt.today()
        let now = Fmt.now()
        let shown = days.contains(day) ? day : (days.contains(today) ? today : days.first ?? "")
        let sessions = guide.agenda.sessions.filter {
            $0.status == "scheduled" && $0.day == shown && (track == nil || $0.trackId == track) && (!mine || repo.bookmarks.contains($0.id))
        }
        Screen {
            ScreenTitle(title: "Agenda")
            if days.count > 1 {
                Segmented(options: days.map { (Fmt.shortDay($0), $0) }, value: Binding(get: { shown }, set: { day = $0 }))
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Chip(text: "All", selected: track == nil && !mine) { track = nil; mine = false }
                    ForEach(guide.agenda.tracks) { t in Chip(text: t.name, selected: track == t.id) { track = t.id; mine = false } }
                    if repo.signedIn { Chip(text: "Saved", selected: mine) { mine.toggle(); track = nil } }
                }
            }
            if !repo.signedIn { Text("Sign in from Profile to save sessions to your plan.").font(.subheadline).foregroundColor(.ink2) }
            if sessions.isEmpty {
                Text(mine ? "You have not saved any sessions for this day." : "No sessions to show.").foregroundColor(.ink2)
            } else {
                Panel {
                    ForEach(Array(sessions.enumerated()), id: \.element.id) { i, s in
                        if i > 0 { Rule() }
                        SessionRow(
                            s: s, colour: trackColour(guide.agenda.tracks, s.trackId),
                            live: s.day == today && s.startTime <= now && now < s.endTime,
                            marked: repo.bookmarks.contains(s.id),
                            onToggle: repo.signedIn ? { action.run { try await repo.toggleBookmark(s.id) } } : nil
                        )
                    }
                }
            }
        }
        .messages(action)
    }
}

// MARK: Profile
struct ProfileScreen: View {
    @EnvironmentObject var repo: Repo
    let modes: [(Mode, String)]
    let mode: Mode
    let onMode: (Mode) -> Void
    let onSignIn: () -> Void
    @StateObject var action = ActionRunner()

    // Turning a notification on asks for permission first, then registers this phone's APNs
    // token with the chosen topics. Nothing is sent until the person opts in.
    func toggle(_ topic: String, _ on: Bool) {
        let next = on ? repo.pushTopics + [topic] : repo.pushTopics.filter { $0 != topic }
        action.run {
            if on {
                let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
                guard granted else { throw ApiError(status: 403, message: "Notifications are blocked. Allow them in Settings.") }
                UIApplication.shared.registerForRemoteNotifications()
                // The token arrives through the app delegate a moment later.
                for _ in 0..<20 where repo.pushToken == nil { try await Task.sleep(nanoseconds: 250_000_000) }
            }
            try await repo.setPush(topics: next)
        }
    }

    var body: some View {
        Screen {
            ScreenTitle(title: "Profile")
            Panel {
                if repo.signedIn {
                    ListRow { VStack(alignment: .leading) { Text(repo.me.user?.name ?? "Signed in").bold(); Text(repo.me.user?.email ?? "").foregroundColor(.ink2) } }
                    Rule()
                    Button { action.run { await repo.signOut() } } label: { ListRow { Text("Sign out and clear this phone").foregroundColor(.errorText) } }.buttonStyle(.plain)
                } else {
                    Button(action: onSignIn) { ListRow { Text("Sign in").bold().foregroundColor(.petrol) } }.buttonStyle(.plain)
                }
            }
            if modes.count > 1 {
                SectionTitle(text: "Workspaces")
                Panel {
                    ForEach(modes, id: \.0) { m, label in
                        Button { onMode(m) } label: {
                            ListRow {
                                Image(systemName: m == mode ? "largecircle.fill.circle" : "circle").foregroundColor(.petrol)
                                Text(label)
                            }
                        }
                        .buttonStyle(.plain).accessibilityAddTraits(m == mode ? .isSelected : [])
                        Rule()
                    }
                }
            }
            if repo.signedIn {
                SectionTitle(text: "Notifications")
                Panel {
                    ForEach([("schedule", "Schedule changes"), ("gate", "Gate changes")], id: \.0) { topic, label in
                        Toggle(label, isOn: Binding(get: { repo.pushTopics.contains(topic) }, set: { toggle(topic, $0) }))
                            .tint(.petrol).padding(.horizontal, 16).frame(minHeight: 50)
                        Rule()
                    }
                }
                Text("Off until you turn them on. You can change this at any time.").font(.subheadline).foregroundColor(.ink2)
            }
            if let guide = repo.guide {
                SectionTitle(text: guide.event.name)
                Panel {
                    ListRow {
                        VStack(alignment: .leading) {
                            Text("\(Fmt.dateRange(guide.event.startsOn, guide.event.endsOn)) · \(guide.event.openTime)–\(guide.event.closeTime)").bold()
                            Text([guide.event.venueName, guide.event.venueAddress].compactMap { $0 }.joined(separator: ", ")).foregroundColor(.ink2)
                        }
                    }
                    if let text = guide.accessibility {
                        Rule()
                        ListRow { VStack(alignment: .leading) { Text("Accessibility").bold(); Text(text).foregroundColor(.ink2) } }
                    }
                    ForEach(guide.faqs, id: \.self) { f in
                        Rule()
                        ListRow { VStack(alignment: .leading) { Text(f.q).bold(); Text(f.a).foregroundColor(.ink2) } }
                    }
                }
            }
            Text("BrainADZ Events \(Foundation.Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") · \(repo.serverUrl)")
                .font(.subheadline).foregroundColor(.ink2)
        }
        .messages(action)
    }
}

// MARK: Sign in
struct SignInScreen: View {
    let onDone: () -> Void
    var body: some View {
        Screen {
            ScreenTitle(title: "Sign in", eyebrow: "BrainADZ Events")
            SignInFields(onDone: onDone)
        }
    }
}

// Email-code or password sign-in, plus the ticket-link and server-address options. Used on the
// welcome screen and the sign-in sheet.
struct SignInFields: View {
    @EnvironmentObject var repo: Repo
    let onDone: () -> Void
    @State var email = ""
    @State var secret = ""
    @State var usePassword = false
    @State var sent = false
    @State var demoCode: String?
    @State var server = ""
    @State var showServer = false
    @State var findPass = false
    @StateObject var action = ActionRunner()
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            LabeledField(label: "Email", text: $email, keyboard: .emailAddress)
                .onChange(of: email) { _ in sent = false }
            if usePassword { LabeledField(label: "Password", text: $secret, secure: true) }
            if !usePassword && sent {
                if let code = demoCode { Notice(text: "Demo: the local email adapter sends nothing. Your code is \(code).", tone: .pending) }
                LabeledField(label: "6-digit code", text: $secret, hint: "Sent to \(email)", keyboard: .numberPad)
            }
            Button(usePassword || sent ? "Sign in" : "Email me a code") {
                action.run {
                    if usePassword { try await repo.signIn(email: email, password: secret); onDone() }
                    else if !sent { demoCode = try await repo.requestCode(email: email).demoCode; sent = true; secret = "" }
                    else { try await repo.verifyCode(email: email, code: secret); onDone() }
                }
            }
            .buttonStyle(PrimaryButtonStyle()).disabled(action.busy || !email.contains("@"))
            Button(usePassword ? "Email me a code instead" : "Use a password instead") { usePassword.toggle(); secret = ""; sent = false }.buttonStyle(LinkButtonStyle())
            if repo.slug != nil {
                Button("Registered without an account? Email my ticket link") { findPass = true }.buttonStyle(LinkButtonStyle())
            }
            if findPass {
                Notice(text: "Enter the email you registered with above, then tap Send. The link opens your ticket in this app.")
                Button("Send my ticket link") {
                    action.run { try await repo.passLink(email: email); action.message = "If that email is registered, a new ticket link is on its way." }
                }
                .buttonStyle(SecondaryButtonStyle()).disabled(!email.contains("@"))
            }
            Button("Server address") { server = repo.serverUrl; showServer.toggle() }.buttonStyle(LinkButtonStyle())
            if showServer {
                LabeledField(label: "Server address", text: $server, hint: "For pilots and venue networks, for example http://192.168.1.20:3100", keyboard: .URL)
                Button("Use this server") { repo.serverUrl = server; action.run { await repo.start() } }.buttonStyle(SecondaryButtonStyle())
            }
        }
        .messages(action)
    }
}

// MARK: Register
// Single-column form, persistent labels, inline errors, visible privacy notice, then a code
// step that proves the email address.
struct RegisterScreen: View {
    let guide: Guide
    let onDone: () -> Void
    @EnvironmentObject var repo: Repo
    @State var passClass = ""
    @State var name = ""
    @State var email = ""
    @State var phone = ""
    @State var company = ""
    @State var jobTitle = ""
    @State var invite = ""
    @State var texts: [String: String] = [:]
    @State var ticks: [String: Bool] = [:]
    @State var consent = false
    @State var optOut = false
    @State var errors: [String: String] = [:]
    @State var pending: RegisterOut?
    @State var code = ""
    @StateObject var action = ActionRunner()

    var cls: PassClass? { guide.passClasses.first { $0.code == passClass } }
    var cta: String {
        guard let c = cls else { return "Register" }
        if c.mode == "approval" { return "Submit for review" }
        if c.totalPaise > 0 { return "Continue to payment" }
        return "Get \(c.name.lowercased()) pass"
    }
    func submit() {
        var e: [String: String] = [:]
        if name.trimmingCharacters(in: .whitespaces).isEmpty { e["name"] = "Enter your full name" }
        if email.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) == nil { e["email"] = "Enter a work email address, like name@company.com" }
        if cls?.mode == "invited" && invite.isEmpty { e["invite"] = "Enter the code from your invitation" }
        for f in guide.formFields where f.required {
            if f.type == "checkbox" ? ticks[f.key] != true : (texts[f.key] ?? "").isEmpty { e[f.key] = f.type == "checkbox" ? "Tick this box to continue" : "Choose an answer" }
        }
        if !consent { e["consent"] = "Accept the privacy notice to register" }
        errors = e
        guard e.isEmpty else { return }
        var answers: [String: Any] = texts.filter { !$0.value.isEmpty }
        for (k, v) in ticks { answers[k] = v }
        action.run {
            pending = try await repo.register([
                "passClass": passClass, "name": name, "email": email, "phone": phone, "company": company, "jobTitle": jobTitle,
                "inviteCode": invite, "consent": true, "leadOptOut": optOut, "answers": answers,
            ])
        }
    }

    var body: some View {
        Screen {
            if let p = pending {
                ScreenTitle(title: "Check your email", eyebrow: guide.event.name)
                Text("We sent a 6-digit code to \(p.email). Enter it to confirm the address is yours.")
                if let demo = p.demoCode { Notice(text: "Demo: the local email adapter sends nothing. Your code is \(demo).", tone: .pending) }
                LabeledField(label: "6-digit code", text: $code, keyboard: .numberPad)
                Button("Confirm") { action.run { try await repo.verifyRegistration(ref: p.ref, code: code); onDone() } }
                    .buttonStyle(PrimaryButtonStyle()).disabled(action.busy || code.count != 6)
                Button("Send a new code") { action.run { pending?.demoCode = try await repo.resendCode(ref: p.ref).demoCode } }.buttonStyle(LinkButtonStyle())
            } else {
                ScreenTitle(title: "Register", eyebrow: guide.event.name)
                Text("Pass type").bold()
                Panel {
                    ForEach(guide.passClasses) { c in
                        Button { passClass = c.code } label: {
                            ListRow(fill: c.code == passClass ? .selectedFill : .surface) {
                                Image(systemName: c.code == passClass ? "largecircle.fill.circle" : "circle").foregroundColor(.petrol)
                                VStack(alignment: .leading) {
                                    Text(c.name).bold()
                                    Text(c.soldOut ? "Fully booked" : c.description ?? "").font(.subheadline).foregroundColor(.ink2)
                                }
                                Spacer(minLength: 0)
                                Text(c.mode == "invited" ? "Invitation" : c.mode == "approval" ? "Reviewed" : c.priceLabel)
                            }
                        }
                        .buttonStyle(.plain).disabled(c.soldOut)
                        .accessibilityAddTraits(c.code == passClass ? .isSelected : [])
                        Rule()
                    }
                }
                Text("Exhibitors apply for a stand on the event website. Speakers are registered by the organiser.").font(.subheadline).foregroundColor(.ink2)
                if cls?.mode == "invited" { LabeledField(label: "Invitation code", text: $invite, error: errors["invite"], keyboard: .asciiCapable) }
                LabeledField(label: "Full name", text: $name, hint: "As it should appear on your badge", error: errors["name"])
                LabeledField(label: "Work email", text: $email, hint: "We send your pass here", error: errors["email"], keyboard: .emailAddress)
                LabeledField(label: "Mobile number (optional)", text: $phone, keyboard: .phonePad)
                LabeledField(label: "Company (optional)", text: $company)
                LabeledField(label: "Job title (optional)", text: $jobTitle)
                ForEach(guide.formFields) { f in
                    if f.type == "checkbox" {
                        CheckRow(label: f.label, isOn: Binding(get: { ticks[f.key] ?? false }, set: { ticks[f.key] = $0 }), error: errors[f.key])
                    } else if f.type == "select" {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(f.label).bold()
                            Panel {
                                ForEach(f.options, id: \.self) { o in
                                    Button { texts[f.key] = o } label: {
                                        ListRow { Image(systemName: texts[f.key] == o ? "largecircle.fill.circle" : "circle").foregroundColor(.petrol); Text(o) }
                                    }
                                    .buttonStyle(.plain).accessibilityAddTraits(texts[f.key] == o ? .isSelected : [])
                                    Rule()
                                }
                            }
                            if let err = errors[f.key] { Text(err).font(.subheadline.weight(.medium)).foregroundColor(.errorText) }
                        }
                    } else {
                        LabeledField(label: f.label, text: Binding(get: { texts[f.key] ?? "" }, set: { texts[f.key] = $0 }), error: errors[f.key])
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("How we use your details").bold()
                    Text("We use them to issue your pass and run the event. \(guide.leadSharingNotice)").font(.subheadline)
                    CheckRow(label: "Do not share my details with exhibitors, even if they scan my badge", isOn: $optOut, error: nil)
                    CheckRow(label: "I accept this privacy notice", isOn: $consent, error: errors["consent"])
                }
                .padding(12).background(Color.selectedFill, in: RoundedRectangle(cornerRadius: 6))
                Button(cta, action: submit).buttonStyle(PrimaryButtonStyle()).disabled(action.busy || cls == nil)
                if !errors.isEmpty { Notice(text: "Check the highlighted answers above.", tone: .error) }
            }
        }
        .onAppear { if passClass.isEmpty { passClass = guide.passClasses.first { !$0.soldOut }?.code ?? "" } }
        .messages(action)
    }
}

struct CheckRow: View {
    let label: String
    @Binding var isOn: Bool
    let error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button { isOn.toggle() } label: {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: isOn ? "checkmark.square.fill" : "square").font(.title3).foregroundColor(.petrol)
                    Text(label).foregroundColor(.ink).multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label).accessibilityValue(isOn ? "Ticked" : "Not ticked").accessibilityAddTraits(.isButton)
            if let error = error { Text(error).font(.subheadline.weight(.medium)).foregroundColor(.errorText) }
        }
    }
}
