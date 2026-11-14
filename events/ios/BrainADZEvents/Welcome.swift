// The first screen for anyone not signed in: sign-in over the exhibition's own background
// photo (or the BrainADZ Live navy and red when the organiser has not set one).
import SwiftUI

struct WelcomeScreen: View {
    @EnvironmentObject var repo: Repo
    let onDone: () -> Void
    let onRegister: () -> Void
    let onBrowse: () -> Void

    var body: some View {
        let event = repo.guide?.event
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Spacer(minLength: 28)
                if let e = event {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("\(Fmt.dateRange(e.startsOn, e.endsOn)) · \(e.openTime)–\(e.closeTime)")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 10).padding(.vertical, 3)
                            .background(Color.petrol, in: RoundedRectangle(cornerRadius: 4))
                        Text(e.name).font(.system(size: 38, weight: .bold)).accessibilityAddTraits(.isHeader)
                        if let tagline = e.tagline { Text(tagline).font(.body).opacity(0.9) }
                        Text([e.venueName, e.city].compactMap { $0 }.joined(separator: ", ")).font(.subheadline.weight(.medium)).opacity(0.85)
                    }
                    .foregroundColor(.white)
                    .shadow(color: .black.opacity(0.35), radius: 8)
                }
                VStack(alignment: .leading, spacing: 14) {
                    Image("BrandLogo").resizable().scaledToFit().frame(width: 132).accessibilityLabel("BrainADZ Live")
                    Text("Sign in").font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
                    Text("Visitors, exhibitors and event staff all sign in here.").font(.subheadline).foregroundColor(.ink2)
                    SignInFields(onDone: onDone)
                    Rule()
                    if let e = event { Text("New to \(e.name)?").foregroundColor(.ink2) }
                    Button("Register for a ticket", action: onRegister).buttonStyle(SecondaryButtonStyle())
                    Button("Look around without signing in", action: onBrowse).buttonStyle(LinkButtonStyle())
                }
                .padding(20)
                .background(Color.surface, in: RoundedRectangle(cornerRadius: 16))
            }
            .padding(16)
        }
        .background { WelcomeBackground(path: event?.loginImage).ignoresSafeArea() }
    }
}

// Brand gradient, the exhibition photo when there is one, a dark wash for readable text and a
// red glow.
private struct WelcomeBackground: View {
    let path: String?
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x233E85), Color(hex: 0x14244F)], startPoint: .topLeading, endPoint: .bottomTrailing)
            if let path = path, let url = URL(string: Api.baseUrl + path) {
                Color.clear.overlay(
                    AsyncImage(url: url) { phase in
                        if let image = phase.image { image.resizable().scaledToFill() } else { Color.clear }
                    }
                )
                .clipped()
            }
            LinearGradient(
                colors: [Color(hex: 0x0E1A3D).opacity(0.5), Color(hex: 0x0E1A3D).opacity(0.85), Color(hex: 0x14244F)],
                startPoint: .top, endPoint: .bottom
            )
            RadialGradient(colors: [Color.petrol.opacity(0.55), .clear], center: .topTrailing, startRadius: 0, endRadius: 420)
        }
        .accessibilityHidden(true)
    }
}
