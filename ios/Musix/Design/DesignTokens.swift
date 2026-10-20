import Foundation

enum DesignTokens {
    static let fontHeading = "Sora"
    static let fontBody = "Manrope"
    static let lineHeightBody: Double = 1.5
    static let lineHeightHeading: Double = 1.25
    static let minimumTextSize: Double = 14
    static let text14: Double = 14
    static let text16: Double = 16
    static let text18: Double = 18
    static let text20: Double = 20
    static let text24: Double = 24
    static let text30: Double = 30
    static let text36: Double = 36
    static let space4: Double = 4
    static let space8: Double = 8
    static let space12: Double = 12
    static let space16: Double = 16
    static let space24: Double = 24
    static let space32: Double = 32
    static let space48: Double = 48
    static let radiusControl: Double = 8
    static let radiusCard: Double = 12
    static let controlHeight: Double = 40
    static let iconButton: Double = 40
    static let miniPlayerHeight: Double = 64
    static let scrollbarSize: Double = 10
    static let motionHover: Double = 0.15
    static let motionScrollbarIn: Double = 0.15
    static let motionScrollbarOut: Double = 0.8

    enum Dark {
        static let bg: UInt32 = 0x0F1420
        static let surface: UInt32 = 0x161C2A
        static let surface2: UInt32 = 0x1C2333
        static let surfaceHover: UInt32 = 0x242C3F
        static let border: UInt32 = 0x2A3247
        static let text: UInt32 = 0xE8EBF3
        static let textMuted: UInt32 = 0xA3ABBF
        static let accent: UInt32 = 0x8B90FF
        static let accentHover: UInt32 = 0xA2A6FF
        static let accentSoft: UInt32 = 0x23284A
        static let onAccent: UInt32 = 0x0B0F1D
        static let success: UInt32 = 0x4ADE80
        static let warning: UInt32 = 0xFBBF24
        static let danger: UInt32 = 0xF87171
        static let focusRing: UInt32 = 0xA2A6FF
        static let skeleton: UInt32 = 0x222A3C
        static let scrollbarThumb: UInt32 = 0x3A4560
        static let scrollbarThumbHover: UInt32 = 0x56627F
    }

    enum Light {
        static let bg: UInt32 = 0xF5F6FA
        static let surface: UInt32 = 0xFFFFFF
        static let surface2: UInt32 = 0xF0F2F8
        static let surfaceHover: UInt32 = 0xE7EAF3
        static let border: UInt32 = 0xDDE1EB
        static let text: UInt32 = 0x111727
        static let textMuted: UInt32 = 0x525C74
        static let accent: UInt32 = 0x4F46E5
        static let accentHover: UInt32 = 0x4338CA
        static let accentSoft: UInt32 = 0xEBE9FE
        static let onAccent: UInt32 = 0xFFFFFF
        static let success: UInt32 = 0x15803D
        static let warning: UInt32 = 0xA15C07
        static let danger: UInt32 = 0xC81E1E
        static let focusRing: UInt32 = 0x4F46E5
        static let skeleton: UInt32 = 0xE6E9F1
        static let scrollbarThumb: UInt32 = 0xC3C9D6
        static let scrollbarThumbHover: UInt32 = 0x9AA3B8
    }
}
