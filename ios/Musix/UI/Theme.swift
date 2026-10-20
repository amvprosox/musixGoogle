import SwiftUI
import UIKit

extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }
}

extension Color {
    static func token(dark: UInt32, light: UInt32) -> Color {
        Color(UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(rgb: dark) : UIColor(rgb: light)
        })
    }
}

enum Palette {
    static let bg = Color.token(dark: DesignTokens.Dark.bg, light: DesignTokens.Light.bg)
    static let surface = Color.token(dark: DesignTokens.Dark.surface, light: DesignTokens.Light.surface)
    static let surface2 = Color.token(dark: DesignTokens.Dark.surface2, light: DesignTokens.Light.surface2)
    static let border = Color.token(dark: DesignTokens.Dark.border, light: DesignTokens.Light.border)
    static let text = Color.token(dark: DesignTokens.Dark.text, light: DesignTokens.Light.text)
    static let textMuted = Color.token(dark: DesignTokens.Dark.textMuted, light: DesignTokens.Light.textMuted)
    static let accent = Color.token(dark: DesignTokens.Dark.accent, light: DesignTokens.Light.accent)
    static let accentSoft = Color.token(dark: DesignTokens.Dark.accentSoft, light: DesignTokens.Light.accentSoft)
    static let onAccent = Color.token(dark: DesignTokens.Dark.onAccent, light: DesignTokens.Light.onAccent)
    static let warning = Color.token(dark: DesignTokens.Dark.warning, light: DesignTokens.Light.warning)
    static let danger = Color.token(dark: DesignTokens.Dark.danger, light: DesignTokens.Light.danger)
    static let skeleton = Color.token(dark: DesignTokens.Dark.skeleton, light: DesignTokens.Light.skeleton)
}

extension Font {
    static func heading(_ size: Double, weight: Font.Weight = .semibold) -> Font {
        .custom(DesignTokens.fontHeading, size: max(size, DesignTokens.minimumTextSize)).weight(weight)
    }

    static func body(_ size: Double = DesignTokens.text16, weight: Font.Weight = .regular) -> Font {
        .custom(DesignTokens.fontBody, size: max(size, DesignTokens.minimumTextSize)).weight(weight)
    }
}

struct Icon: View {
    let name: String
    var size: Double = 24

    var body: some View {
        Image(name)
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

struct IconButton: View {
    let icon: String
    let label: String
    var size: Double = 24
    var active = false
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Icon(name: icon, size: size)
                .foregroundStyle(enabled ? (active ? Palette.accent : Palette.text) : Palette.textMuted.opacity(0.5))
                .frame(width: 48, height: 48)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(label)
    }
}

struct PrimaryButton: View {
    let title: String
    var icon: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: DesignTokens.space8) {
                if let icon {
                    Icon(name: icon, size: 20)
                }
                Text(title).font(.body(DesignTokens.text16, weight: .semibold))
            }
            .foregroundStyle(Palette.onAccent)
            .padding(.horizontal, DesignTokens.space24)
            .frame(minHeight: 48)
            .background(Palette.accent, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct SecondaryButton: View {
    let title: String
    var icon: String?
    var danger = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: DesignTokens.space8) {
                if let icon {
                    Icon(name: icon, size: 20)
                }
                Text(title).font(.body(DesignTokens.text16, weight: .semibold))
            }
            .foregroundStyle(danger ? Palette.danger : Palette.text)
            .padding(.horizontal, DesignTokens.space24)
            .frame(minHeight: 48)
            .overlay(Capsule().stroke(Palette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

struct StateMessage: View {
    let icon: String
    let title: String
    var detail: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: DesignTokens.space12) {
            Icon(name: icon, size: 40).foregroundStyle(Palette.textMuted)
            Text(title)
                .font(.heading(DesignTokens.text18))
                .foregroundStyle(Palette.text)
                .multilineTextAlignment(.center)
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.body(DesignTokens.text14))
                    .foregroundStyle(Palette.textMuted)
                    .multilineTextAlignment(.center)
            }
            if let actionTitle, let action {
                PrimaryButton(title: actionTitle, action: action).padding(.top, DesignTokens.space12)
            }
        }
        .padding(DesignTokens.space32)
        .frame(maxWidth: .infinity)
    }
}

struct Banner: View {
    let icon: String
    let text: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(spacing: DesignTokens.space12) {
            Icon(name: icon, size: 20).foregroundStyle(Palette.warning)
            Text(text)
                .font(.body(DesignTokens.text14))
                .foregroundStyle(Palette.text)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(.body(DesignTokens.text14, weight: .semibold))
                    .foregroundStyle(Palette.accent)
                    .frame(minHeight: 44)
            }
        }
        .padding(.horizontal, DesignTokens.space16)
        .padding(.vertical, DesignTokens.space12)
        .background(Palette.surface2, in: RoundedRectangle(cornerRadius: DesignTokens.radiusCard))
        .padding(.horizontal, DesignTokens.space16)
    }
}

struct ArtworkView: View {
    let address: String
    var size: Double
    var fallback = "music"
    var corner = DesignTokens.radiusControl
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Palette.surface2
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Icon(name: fallback, size: size * 0.4).foregroundStyle(Palette.textMuted)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: corner))
        .overlay(RoundedRectangle(cornerRadius: corner).stroke(Palette.border, lineWidth: 1))
        .task(id: address) {
            image = nil
            guard !address.isEmpty, let data = await ArtworkLoader.shared.data(for: address) else {
                return
            }
            image = UIImage(data: data)
        }
        .accessibilityHidden(true)
    }
}

func formatTime(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds > 0 else {
        return "0:00"
    }
    let total = Int(seconds)
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let secs = total % 60
    if hours > 0 {
        return String(format: "%d:%02d:%02d", hours, minutes, secs)
    }
    return String(format: "%d:%02d", minutes, secs)
}
