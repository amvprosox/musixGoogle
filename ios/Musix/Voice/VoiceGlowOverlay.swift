import SwiftUI

struct VoiceGlowOverlay: View {
    @ObservedObject var voice: VoiceController
    @State private var spin = false

    private var active: Bool {
        voice.state == .awake || voice.state == .thinking
    }

    private var level: Double {
        voice.levels.last ?? 0
    }

    private var gradient: AngularGradient {
        AngularGradient(
            gradient: Gradient(colors: [
                Color(red: 1, green: 0.31, blue: 0.64),
                Color(red: 0.66, green: 0.33, blue: 0.97),
                Color(red: 0.23, green: 0.51, blue: 0.96),
                Color(red: 0.13, green: 0.83, blue: 0.93),
                Color(red: 0.2, green: 0.83, blue: 0.6),
                Color(red: 0.98, green: 0.75, blue: 0.14),
                Color(red: 1, green: 0.31, blue: 0.64),
            ]),
            center: .center,
            angle: .degrees(spin ? 360 : 0)
        )
    }

    var body: some View {
        ZStack {
            if active {
                RoundedRectangle(cornerRadius: 46, style: .continuous)
                    .strokeBorder(gradient, lineWidth: 16 + level * 36)
                    .blur(radius: 24)
                    .opacity(0.85)
                RoundedRectangle(cornerRadius: 46, style: .continuous)
                    .strokeBorder(gradient, lineWidth: 5)
                    .blur(radius: 1.5)
                VStack {
                    Spacer()
                    waveform
                        .padding(.bottom, 132)
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .animation(.easeInOut(duration: 0.3), value: active)
        .onAppear {
            withAnimation(.linear(duration: voice.state == .thinking ? 1.2 : 3.2).repeatForever(autoreverses: false)) {
                spin = true
            }
        }
        .accessibilityHidden(true)
    }

    private var waveform: some View {
        VStack(spacing: 8) {
            HStack(alignment: .center, spacing: 4) {
                ForEach(Array(voice.levels.enumerated()), id: \.offset) { index, value in
                    let middle = Double(voice.levels.count - 1) / 2
                    let shape = 1 - abs(Double(index) - middle) / (middle + 2)
                    Capsule()
                        .fill(LinearGradient(
                            colors: [Color(red: 1, green: 0.31, blue: 0.64), Color(red: 0.13, green: 0.83, blue: 0.93)],
                            startPoint: .top,
                            endPoint: .bottom
                        ))
                        .frame(width: 4, height: max(3, min(30, 30 * (0.12 + value * 1.6) * (0.45 + shape * 0.55))))
                }
            }
            .frame(height: 30)
            .animation(.linear(duration: 0.09), value: voice.levels)
            Text(voice.state == .thinking ? (voice.heard.isEmpty ? "Thinking" : voice.heard) : "Listening")
                .font(.body(DesignTokens.text14, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .frame(maxWidth: 300)
        .background(Capsule().fill(Color.black.opacity(0.78)))
        .overlay(Capsule().stroke(Color.white.opacity(0.12), lineWidth: 1))
    }
}
