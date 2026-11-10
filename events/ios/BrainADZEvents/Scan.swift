// QR rendering for passes, the camera scanner (AVFoundation) with permission-denied recovery,
// and the 2D hall plan.
import AVFoundation
import CoreImage.CIFilterBuiltins
import SwiftUI

// The pass QR: black on white, drawn on the device from the opaque reference so it works offline.
struct QrImage: View {
    let text: String
    let label: String
    var body: some View {
        Group {
            if let image = Self.make(text) {
                Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
            } else {
                Color.neutralFill
            }
        }
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isImage)
    }
    private static func make(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cg = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

// Live camera scanner. Reports each QR once every three seconds while it stays in view.
struct QrScanner: View {
    let onCode: (String) -> Void
    @State private var status = AVCaptureDevice.authorizationStatus(for: .video)
    var body: some View {
        Group {
            switch status {
            case .authorized:
                CameraView(onCode: onCode)
                    .aspectRatio(4 / 3, contentMode: .fit)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.white, lineWidth: 3).padding(48).allowsHitTesting(false))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityLabel("Camera view. Hold the QR code inside the frame.")
            case .notDetermined:
                ProgressView().frame(maxWidth: .infinity, minHeight: 200)
                    .task { _ = await AVCaptureDevice.requestAccess(for: .video); status = AVCaptureDevice.authorizationStatus(for: .video) }
            default:
                // Denied: say why the camera is needed and offer the way back.
                VStack(alignment: .leading, spacing: 8) {
                    Text("Camera access is off").font(.headline)
                    Text("The camera is used only to read QR codes. Allow it in Settings to scan, or type the code instead.")
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                .foregroundColor(.errorText).padding(16)
                .background(Color.errorFill, in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            status = AVCaptureDevice.authorizationStatus(for: .video)
        }
    }
}

private struct CameraView: UIViewControllerRepresentable {
    let onCode: (String) -> Void
    func makeUIViewController(context: Context) -> CameraController {
        let controller = CameraController()
        controller.onCode = onCode
        return controller
    }
    func updateUIViewController(_ controller: CameraController, context: Context) { controller.onCode = onCode }
}

final class CameraController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCode: ((String) -> Void)?
    private let session = AVCaptureSession()
    private var preview: AVCaptureVideoPreviewLayer?
    private var last = ("", Date.distantPast)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard let camera = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: camera), session.canAddInput(input) else { return }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(layer)
        preview = layer
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        let session = self.session
        DispatchQueue.global(qos: .userInitiated).async { if !session.isRunning { session.startRunning() } }
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        let session = self.session
        DispatchQueue.global(qos: .userInitiated).async { if session.isRunning { session.stopRunning() } }
    }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let value = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
        if value != last.0 || Date().timeIntervalSince(last.1) > 3 {
            last = (value, Date())
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onCode?(value)
        }
    }
}

// The 2D plan of one hall on a grid. Every booth is a real button, so VoiceOver users can
// move through the plan; the screens also offer a list view of the same information.
struct HallPlan: View {
    let hall: Hall
    let selected: Int?
    let onSelect: (Booth) -> Void
    var body: some View {
        GeometryReader { geo in
            let cell = geo.size.width / CGFloat(max(hall.cols, 1))
            let wallHeight = cell * CGFloat(hall.rows)
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 6).stroke(Color.control, lineWidth: 3).frame(width: geo.size.width, height: wallHeight)
                ForEach(hall.booths) { b in
                    let taken = b.exhibitor != nil
                    let isSelected = b.id == selected
                    Button { onSelect(b) } label: {
                        Text(b.code).font(.footnote.weight(taken ? .semibold : .regular))
                            .foregroundColor(isSelected ? .white : taken ? .ink : .ink2)
                            .frame(width: CGFloat(b.w) * cell - 8, height: CGFloat(b.h) * cell - 8)
                            .background(isSelected ? Color.petrol : Color.surface, in: RoundedRectangle(cornerRadius: 4))
                            .overlay(RoundedRectangle(cornerRadius: 4).stroke(isSelected ? Color.petrol : taken ? Color.ink : Color.control, style: StrokeStyle(lineWidth: taken ? 2 : 1, dash: taken ? [] : [5, 4])))
                    }
                    .buttonStyle(.plain)
                    .position(x: (CGFloat(b.x) + CGFloat(b.w) / 2) * cell, y: (CGFloat(b.y) + CGFloat(b.h) / 2) * cell)
                    .accessibilityLabel(taken ? "Booth \(b.code), \(b.exhibitor ?? "")" : "Booth \(b.code), not allocated")
                    .accessibilityAddTraits(isSelected ? .isSelected : [])
                }
                ForEach(hall.amenities) { a in
                    Text(a.label).font(.caption2).foregroundColor(.ink2).fixedSize()
                        .position(x: min(max(CGFloat(a.x) * cell, 50), geo.size.width - 50), y: CGFloat(a.y) * cell)
                }
                ForEach(hall.gates.filter { $0.x != nil }) { g in
                    VStack(spacing: 0) {
                        Rectangle().fill(Color.surface).frame(width: cell * 1.2, height: 5)
                        Text("↑ \(g.name) entry").font(.caption.weight(.semibold)).foregroundColor(.ink).padding(.top, 4)
                    }
                    .position(x: CGFloat(g.x ?? 0) * cell, y: wallHeight + 10)
                    .accessibilityLabel("\(g.name) entry")
                }
            }
        }
        .aspectRatio(CGFloat(max(hall.cols, 1)) / (CGFloat(hall.rows) + 0.9), contentMode: .fit)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Plan of \(hall.name)")
    }
}
