// Design tokens and shared components. The colours are the brief's exact tokens, the same
// ones the web app (styles.css) and the Android app (Theme.kt) use.
import SwiftUI

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
    static let canvas = Color(hex: 0xF4F5F7)
    static let surface = Color(hex: 0xFFFFFF)
    static let ink = Color(hex: 0x231F20)
    static let ink2 = Color(hex: 0x5A5F6B)
    // BrainADZ Live red, used for actions; navy is the wordmark colour.
    static let petrol = Color(hex: 0xC82026)
    static let navy = Color(hex: 0x233E85)
    static let selectedFill = Color(hex: 0xFBE9EA)
    static let rule = Color(hex: 0xE1E3E8)
    static let control = Color(hex: 0x7C818C)
    static let okText = Color(hex: 0x2E6046)
    static let okFill = Color(hex: 0xE8F2EB)
    static let pendingText = Color(hex: 0x765018)
    static let pendingFill = Color(hex: 0xF8EFD9)
    static let errorText = Color(hex: 0x963D34)
    static let errorFill = Color(hex: 0xFAEDE9)
    static let neutralFill = Color(hex: 0xECEEEB)
}

// MARK: Formatting
enum Fmt {
    private static let inLocale = Locale(identifier: "en_IN")
    static func inr(_ paise: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.locale = inLocale
        f.currencyCode = "INR"
        f.maximumFractionDigits = paise % 100 == 0 ? 0 : 2
        return f.string(from: NSNumber(value: Double(paise) / 100)) ?? "₹\(paise / 100)"
    }
    private static func ymd(_ s: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Kolkata")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: s)
    }
    private static func format(_ date: Date, _ pattern: String) -> String {
        let f = DateFormatter()
        f.locale = inLocale
        f.timeZone = TimeZone(identifier: "Asia/Kolkata")
        f.dateFormat = pattern
        return f.string(from: date)
    }
    static func day(_ s: String?) -> String { s.flatMap(ymd).map { format($0, "d MMM yyyy") } ?? (s ?? "") }
    static func weekday(_ s: String) -> String { ymd(s).map { format($0, "EEEE, d MMMM") } ?? s }
    static func clock(_ iso: String?) -> String { iso.map { format(ScanRules.date($0), "HH:mm") } ?? "" }
    static func dateRange(_ from: String, _ to: String) -> String {
        guard from != to, let a = ymd(from) else { return day(from) }
        return "\(format(a, "d"))–\(day(to))"
    }
}

// MARK: Status
enum StatusTone {
    case ok, pending, error, neutral
    var fg: Color { switch self { case .ok: return .okText; case .pending: return .pendingText; case .error: return .errorText; case .neutral: return .ink } }
    var bg: Color { switch self { case .ok: return .okFill; case .pending: return .pendingFill; case .error: return .errorFill; case .neutral: return .neutralFill } }
    var icon: String? { switch self { case .ok: return "checkmark.circle"; case .pending: return "clock"; case .error: return "exclamationmark.circle"; case .neutral: return nil } }

    static func of(_ state: String) -> StatusTone {
        switch state {
        case "confirmed", "paid", "approved", "complete", "accepted", "printed", "active": return .ok
        case "pending_review", "pending", "held", "awaiting_review", "submitted", "invited", "part_paid", "open", "unverified", "queued": return .pending
        case "rejected", "cancelled", "failed", "changes_requested", "revoked": return .error
        default: return .neutral
        }
    }
    static func label(_ state: String) -> String {
        switch state {
        case "pending_review", "submitted", "awaiting_review": return "Awaiting review"
        case "changes_requested": return "Changes requested"
        case "part_paid": return "Part paid"
        case "open": return "Unpaid"
        case "todo": return "To do"
        case "accepted": return "Signed in"
        default:
            let text = state.replacingOccurrences(of: "_", with: " ")
            return text.prefix(1).uppercased() + text.dropFirst()
        }
    }
}

// A state shown as icon and words on a tinted background; never colour alone.
struct StatusChip: View {
    let text: String
    var tone: StatusTone = .neutral
    var body: some View {
        HStack(spacing: 4) {
            if let icon = tone.icon { Image(systemName: icon).imageScale(.small) }
            Text(text).font(.subheadline.weight(.semibold))
        }
        .foregroundColor(tone.fg)
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(tone.bg, in: RoundedRectangle(cornerRadius: 4))
        .accessibilityElement(children: .combine)
    }
}

struct Notice: View {
    let text: String
    var tone: StatusTone = .neutral
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if let icon = tone.icon { Image(systemName: icon) }
            Text(text).frame(maxWidth: .infinity, alignment: .leading)
        }
        .foregroundColor(tone == .neutral ? .ink : tone.fg)
        .padding(12)
        .background(tone == .neutral ? Color.selectedFill : tone.bg, in: RoundedRectangle(cornerRadius: 6))
        .accessibilityElement(children: .combine)
    }
}

// MARK: Buttons (44 pt minimum touch targets)
// The one filled button on a screen.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 50)
            .foregroundColor(.white)
            .background(configuration.isPressed ? Color(hex: 0xA3191F) : Color.petrol, in: RoundedRectangle(cornerRadius: 6))
            .opacity(enabled ? 1 : 0.55)
    }
}
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .frame(maxWidth: .infinity, minHeight: 46)
            .foregroundColor(.ink)
            .background(configuration.isPressed ? Color.selectedFill : Color.surface, in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.control, lineWidth: 1))
            .opacity(enabled ? 1 : 0.55)
    }
}
struct LinkButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.body.weight(.semibold)).foregroundColor(.petrol).frame(minHeight: 44).opacity(configuration.isPressed ? 0.6 : 1)
    }
}

// A field with its label always visible above it and the error below it.
struct LabeledField: View {
    let label: String
    @Binding var text: String
    var hint: String?
    var error: String?
    var keyboard: UIKeyboardType = .default
    var secure = false
    var multiline = false
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.body.weight(.semibold))
            if let hint = hint { Text(hint).font(.subheadline).foregroundColor(.ink2) }
            Group {
                if secure { SecureField("", text: $text) }
                else if multiline { TextField("", text: $text, axis: .vertical).lineLimit(3...6) }
                else { TextField("", text: $text).keyboardType(keyboard).textInputAutocapitalization(keyboard == .default ? .sentences : .never).autocorrectionDisabled(keyboard != .default) }
            }
            .padding(.horizontal, 12).frame(minHeight: 46)
            .background(Color.surface, in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(error == nil ? Color.control : Color.errorText, lineWidth: error == nil ? 1 : 2))
            .accessibilityLabel(label)
            .accessibilityHint([hint, error].compactMap { $0 }.joined(separator: ". "))
            if let error = error { Text(error).font(.subheadline.weight(.medium)).foregroundColor(.errorText) }
        }
    }
}

struct Chip: View {
    let text: String
    let selected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(text).font(.subheadline.weight(selected ? .semibold : .regular))
                .foregroundColor(selected ? .petrol : .ink)
                .padding(.horizontal, 14).frame(minHeight: 36)
                .background(selected ? Color.selectedFill : Color.surface, in: Capsule())
                .overlay(Capsule().stroke(selected ? Color.petrol : Color.control, lineWidth: 1))
                .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// A flat white surface with a quiet border; rows are separated by rules.
struct Panel<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(spacing: 0) { content }
            .frame(maxWidth: .infinity)
            .background(Color.surface, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.rule, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
struct Rule: View { var body: some View { Rectangle().fill(Color.rule).frame(height: 1) } }
struct ListRow<Content: View>: View {
    var fill: Color = .surface
    @ViewBuilder var content: Content
    var body: some View {
        HStack(spacing: 12) { content }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
            .background(fill)
            .contentShape(Rectangle())
    }
}

struct Eyebrow: View {
    let text: String
    var body: some View { Text(text.uppercased()).font(.footnote.weight(.medium)).kerning(1).foregroundColor(.ink2) }
}
struct ScreenTitle: View {
    let title: String
    var eyebrow: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let eyebrow = eyebrow { Eyebrow(text: eyebrow) }
            Text(title).font(.largeTitle.weight(.semibold)).accessibilityAddTraits(.isHeader)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
struct SectionTitle: View {
    let text: String
    var body: some View { Text(text).font(.headline).frame(maxWidth: .infinity, alignment: .leading).accessibilityAddTraits(.isHeader) }
}
struct KeyValue: View {
    let key: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(key).font(.subheadline).foregroundColor(.ink2)
            Text(value).font(.headline)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.rule, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

// A scrolling screen on the limestone canvas with standard padding.
struct Screen<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) { content }.padding(16)
        }
        .background(Color.canvas)
    }
}

// MARK: Running actions and loading data
// Runs async work for a button, shows its error as an alert, and reports whether it is running.
@MainActor
final class ActionRunner: ObservableObject {
    @Published var busy = false
    @Published var message: String?
    func run(_ work: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        busy = true
        Task {
            do { try await work() } catch { message = error.localizedDescription }
            busy = false
        }
    }
}
extension View {
    func messages(_ runner: ActionRunner) -> some View {
        alert(runner.message ?? "", isPresented: Binding(get: { runner.message != nil }, set: { if !$0 { runner.message = nil } })) {
            Button("OK", role: .cancel) {}
        }
    }
}

// Loads data for a screen with native loading, offline and retry states.
struct Loader<T, Content: View>: View {
    let load: () async throws -> T
    @ViewBuilder let content: (T, @escaping () -> Void) -> Content
    @State private var data: T?
    @State private var error: ApiError?
    @State private var attempt = 0
    var body: some View {
        Group {
            if let data = data { content(data) { attempt += 1 } }
            else if let error = error {
                VStack(spacing: 12) {
                    Text(error.offline ? "You are offline" : "Could not load").font(.title2.weight(.semibold))
                    Text(error.message).foregroundColor(.ink2).multilineTextAlignment(.center)
                    Button("Try again") { self.error = nil; attempt += 1 }.buttonStyle(SecondaryButtonStyle())
                }
                .padding(24).frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.canvas)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.canvas)
            }
        }
        .task(id: attempt) {
            do {
                data = try await load()
                error = nil
            } catch let e as ApiError {
                error = e
            } catch {}
        }
    }
}
