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

struct PaletteValues: Sendable {
    let bg: UInt32
    let surface: UInt32
    let surface2: UInt32
    let border: UInt32
    let text: UInt32
    let textMuted: UInt32
    let accent: UInt32
    let accentSoft: UInt32
    let onAccent: UInt32
    let warning: UInt32
    let danger: UInt32
    let skeleton: UInt32
}

enum ThemePalette: String, CaseIterable, Identifiable, Sendable {
    case dark
    case graphite
    case slate
    case amoled
    case light

    var id: String { rawValue }

    var label: String {
        switch self {
        case .dark: return "Midnight"
        case .graphite: return "Graphite"
        case .slate: return "Slate Grey"
        case .amoled: return "AMOLED Black"
        case .light: return "Light"
        }
    }

    var isDark: Bool { self != .light }

    var values: PaletteValues {
        switch self {
        case .dark:
            return PaletteValues(
                bg: DesignTokens.Dark.bg,
                surface: DesignTokens.Dark.surface,
                surface2: DesignTokens.Dark.surface2,
                border: DesignTokens.Dark.border,
                text: DesignTokens.Dark.text,
                textMuted: DesignTokens.Dark.textMuted,
                accent: DesignTokens.Dark.accent,
                accentSoft: DesignTokens.Dark.accentSoft,
                onAccent: DesignTokens.Dark.onAccent,
                warning: DesignTokens.Dark.warning,
                danger: DesignTokens.Dark.danger,
                skeleton: DesignTokens.Dark.skeleton
            )
        case .graphite:
            return PaletteValues(
                bg: DesignTokens.Graphite.bg,
                surface: DesignTokens.Graphite.surface,
                surface2: DesignTokens.Graphite.surface2,
                border: DesignTokens.Graphite.border,
                text: DesignTokens.Graphite.text,
                textMuted: DesignTokens.Graphite.textMuted,
                accent: DesignTokens.Graphite.accent,
                accentSoft: DesignTokens.Graphite.accentSoft,
                onAccent: DesignTokens.Graphite.onAccent,
                warning: DesignTokens.Graphite.warning,
                danger: DesignTokens.Graphite.danger,
                skeleton: DesignTokens.Graphite.skeleton
            )
        case .slate:
            return PaletteValues(
                bg: DesignTokens.Slate.bg,
                surface: DesignTokens.Slate.surface,
                surface2: DesignTokens.Slate.surface2,
                border: DesignTokens.Slate.border,
                text: DesignTokens.Slate.text,
                textMuted: DesignTokens.Slate.textMuted,
                accent: DesignTokens.Slate.accent,
                accentSoft: DesignTokens.Slate.accentSoft,
                onAccent: DesignTokens.Slate.onAccent,
                warning: DesignTokens.Slate.warning,
                danger: DesignTokens.Slate.danger,
                skeleton: DesignTokens.Slate.skeleton
            )
        case .amoled:
            return PaletteValues(
                bg: DesignTokens.Amoled.bg,
                surface: DesignTokens.Amoled.surface,
                surface2: DesignTokens.Amoled.surface2,
                border: DesignTokens.Amoled.border,
                text: DesignTokens.Amoled.text,
                textMuted: DesignTokens.Amoled.textMuted,
                accent: DesignTokens.Amoled.accent,
                accentSoft: DesignTokens.Amoled.accentSoft,
                onAccent: DesignTokens.Amoled.onAccent,
                warning: DesignTokens.Amoled.warning,
                danger: DesignTokens.Amoled.danger,
                skeleton: DesignTokens.Amoled.skeleton
            )
        case .light:
            return PaletteValues(
                bg: DesignTokens.Light.bg,
                surface: DesignTokens.Light.surface,
                surface2: DesignTokens.Light.surface2,
                border: DesignTokens.Light.border,
                text: DesignTokens.Light.text,
                textMuted: DesignTokens.Light.textMuted,
                accent: DesignTokens.Light.accent,
                accentSoft: DesignTokens.Light.accentSoft,
                onAccent: DesignTokens.Light.onAccent,
                warning: DesignTokens.Light.warning,
                danger: DesignTokens.Light.danger,
                skeleton: DesignTokens.Light.skeleton
            )
        }
    }

    var webCss: String {
        guard isDark else {
            return ""
        }
        let bg = Self.hex(values.bg)
        let surface = Self.hex(values.surface)
        let surface2 = Self.hex(values.surface2)
        return "html,body,ytmusic-app,ytmusic-app-layout,#layout,ytmusic-browse-response,ytmusic-search-page,"
            + "ytmusic-tabbed-search-results-renderer,ytmusic-section-list-renderer{background-color:\(bg)!important}\n"
            + "html,ytmusic-app{--ytmusic-general-background-a:\(bg)!important;--ytmusic-general-background-b:\(bg)!important;"
            + "--ytmusic-general-background-c:\(bg)!important;--ytmusic-brand-background-solid:\(bg)!important;"
            + "--yt-spec-base-background:\(bg)!important;--yt-spec-general-background-a:\(bg)!important;"
            + "--yt-spec-general-background-b:\(surface)!important;--yt-spec-general-background-c:\(surface)!important;"
            + "--yt-spec-raised-background:\(surface)!important;--yt-spec-menu-background:\(surface2)!important;"
            + "--paper-dialog-background-color:\(surface2)!important}"
    }

    var webBackground: UIColor {
        isDark ? UIColor(rgb: values.bg) : .black
    }

    private static func hex(_ value: UInt32) -> String {
        String(format: "#%06X", value & 0xFFFFFF)
    }
}

enum ThemeStore {
    static var palette: ThemePalette = .dark
}

enum Palette {
    static var bg: Color { Color(uiColor: UIColor(rgb: ThemeStore.palette.values.bg)) }
    static var surface: Color { Color(uiColor: UIColor(rgb: ThemeStore.palette.values.surface)) }
    static var surface2: Color { Color(uiColor: UIColor(rgb: ThemeStore.palette.values.surface2)) }
    static var border: Color { Color(uiColor: UIColor(rgb: ThemeStore.palette.values.border)) }
    static var text: Color { Color(uiColor: UIColor(rgb: ThemeStore.palette.values.text)) }
    static var textMuted: Color { Color(uiColor: UIColor(rgb: ThemeStore.palette.values.textMuted)) }
    static var accent: Color { Color(uiColor: UIColor(rgb: ThemeStore.palette.values.accent)) }
    static var accentSoft: Color { Color(uiColor: UIColor(rgb: ThemeStore.palette.values.accentSoft)) }
    static var onAccent: Color { Color(uiColor: UIColor(rgb: ThemeStore.palette.values.onAccent)) }
    static var warning: Color { Color(uiColor: UIColor(rgb: ThemeStore.palette.values.warning)) }
    static var danger: Color { Color(uiColor: UIColor(rgb: ThemeStore.palette.values.danger)) }
    static var skeleton: Color { Color(uiColor: UIColor(rgb: ThemeStore.palette.values.skeleton)) }
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
