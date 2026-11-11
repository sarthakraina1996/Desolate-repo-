// App entry and navigation by role. Visitors get Pass, Explore, Agenda and Profile. Exhibitor
// staff get their booth workspace; gate staff get the restricted scanner. The roles come from
// the server (/me) and every action is checked there again.
import SwiftUI
import UserNotifications

enum Mode: Hashable { case visitor, exhibitor, gate }

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }
    // APNs token for this phone; registered with the server only once the person opts in.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in
            let repo = Repo.shared
            let changed = repo.pushToken != token
            repo.pushToken = token
            if changed && repo.signedIn && !repo.pushTopics.isEmpty { try? await repo.setPush(topics: repo.pushTopics) }
        }
    }
    // Show schedule and gate changes even while the app is open.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

@main
struct BrainADZEventsApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject var repo = Repo.shared
    var body: some Scene {
        WindowGroup {
            AppRoot().environmentObject(repo).preferredColorScheme(.light).tint(.petrol)
        }
    }
}

struct AppRoot: View {
    @EnvironmentObject var repo: Repo
    @Environment(\.scenePhase) var phase
    @State var tab = "pass"
    @State var chosen: Mode?
    @State var showSignIn = false
    @State var showRegister = false
    @State var linkError: String?

    // Universal Links (pass, event and sign-in links) are resolved against whoever is signed in.
    func open(_ url: URL) {
        let path = url.path
        Task {
            if path.hasPrefix("/p/") {
                do { try await repo.openPassLink(String(path.dropFirst(3))) } catch { linkError = error.localizedDescription }
                chosen = .visitor; tab = "pass"
            } else if path.hasPrefix("/e/") {
                try? await repo.loadGuide(String(path.dropFirst(3).split(separator: "/").first ?? ""))
                chosen = .visitor; tab = "explore"
            } else if path == "/signin" && !repo.signedIn {
                showSignIn = true
            }
        }
    }

    var exhibitor: ExhibitorRole? { repo.me.exhibitor?.first { $0.status == "approved" } ?? repo.me.exhibitor?.first }
    var isGate: Bool { !(repo.me.gate ?? []).isEmpty }
    var modes: [(Mode, String)] {
        var list: [(Mode, String)] = [(Mode.visitor, "Visitor: my tickets, explore, agenda")]
        if let ex = exhibitor { list.append((Mode.exhibitor, "Exhibitor: \(ex.companyName)")) }
        if isGate { list.append((Mode.gate, "Gate scanner")) }
        return list
    }
    // Staff land in their workspace; everyone can switch from Profile.
    var mode: Mode {
        if let c = chosen, modes.contains(where: { $0.0 == c }) { return c }
        return isGate ? .gate : exhibitor != nil ? .exhibitor : .visitor
    }

    // The tabs for the current workspace. Kept apart from `body` so each piece type-checks quickly.
    @ViewBuilder
    var workspaceTabs: some View {
        switch mode {
        case .visitor:
            PassScreen(onRegister: { showRegister = true }, onSignIn: signInOrRefresh)
                .tabItem { Label("Tickets", systemImage: "ticket") }.tag("pass")
            guideTab(explore: true).tabItem { Label("Explore", systemImage: "map") }.tag("explore")
            guideTab(explore: false).tabItem { Label("Agenda", systemImage: "calendar") }.tag("agenda")
        case .exhibitor:
            if let role = exhibitor {
                BoothScreen(role: role).tabItem { Label("Booth", systemImage: "building.2") }.tag("booth")
                TeamScreen(role: role).tabItem { Label("Team", systemImage: "person.text.rectangle") }.tag("team")
                LeadsScreen(role: role).tabItem { Label("Leads", systemImage: "person.2") }.tag("leads")
                LeadScanScreen(role: role).tabItem { Label("Scan", systemImage: "qrcode.viewfinder") }.tag("scan")
            }
        case .gate:
            GateScreen().tabItem { Label("Scan", systemImage: "qrcode.viewfinder") }.tag("gate")
        }
    }
    func signInOrRefresh() {
        if repo.signedIn { Task { await repo.start() } } else { showSignIn = true }
    }
    func firstTab(_ m: Mode) -> String {
        switch m {
        case .visitor: return "pass"
        case .exhibitor: return "booth"
        case .gate: return "gate"
        }
    }

    @ViewBuilder
    var content: some View {
        if !repo.ready {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.canvas)
        } else {
            TabView(selection: $tab) {
                workspaceTabs
                ProfileScreen(modes: modes, mode: mode, onMode: { chosen = $0 }, onSignIn: { showSignIn = true })
                    .tabItem { Label("Profile", systemImage: "person") }.tag("profile")
            }
        }
    }

    var body: some View {
        let linkAlert = Binding<Bool>(get: { linkError != nil }, set: { if !$0 { linkError = nil } })
        return content
            .task { await repo.start() }
            // Coming back to the app refreshes passes and uploads any queued scans.
            .onChange(of: phase) { p in
                if p == .active && repo.ready { Task { await repo.start() } }
            }
            // The first tab of the new workspace is shown after a switch.
            .onChange(of: mode) { m in tab = firstTab(m) }
            .onOpenURL(perform: open)
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                if let url = activity.webpageURL { open(url) }
            }
            .sheet(isPresented: $showSignIn) { SignInScreen { showSignIn = false }.environmentObject(repo) }
            .sheet(isPresented: $showRegister) { registerSheet }
            .alert(linkError ?? "", isPresented: linkAlert) { Button("OK", role: .cancel) {} }
    }

    @ViewBuilder
    var registerSheet: some View {
        if let guide = repo.guide {
            RegisterScreen(guide: guide) { showRegister = false; tab = "pass" }.environmentObject(repo)
        }
    }

    @ViewBuilder
    func guideTab(explore: Bool) -> some View {
        if let guide = repo.guide {
            if explore { ExploreScreen(guide: guide) } else { AgendaScreen(guide: guide) }
        } else {
            Text(repo.online ? "No event is open yet." : "You are offline and no event guide is saved on this phone yet.")
                .foregroundColor(.ink2).multilineTextAlignment(.center).padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.canvas)
        }
    }
}
