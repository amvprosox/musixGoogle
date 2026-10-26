import Foundation
import SwiftUI
import UIKit

@MainActor
final class PlaybackLog: ObservableObject {
    static let shared = PlaybackLog()

    @Published private(set) var entries: [String] = []

    private let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()

    private static let limit = 300

    func add(_ text: String) {
        entries.append("\(formatter.string(from: Date())) \(text)")
        if entries.count > Self.limit {
            entries.removeFirst(entries.count - Self.limit)
        }
    }

    func clear() {
        entries.removeAll()
    }

    var text: String {
        entries.joined(separator: "\n")
    }
}

struct PlaybackLogView: View {
    @ObservedObject var log: PlaybackLog

    var body: some View {
        Group {
            if log.entries.isEmpty {
                StateMessage(icon: "list_music", title: "Nothing logged yet", detail: "Play some music. Every play, pause and stall shows up here with its cause.")
                    .frame(maxHeight: .infinity)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: DesignTokens.space4) {
                            ForEach(Array(log.entries.enumerated()), id: \.offset) { index, entry in
                                Text(entry)
                                    .font(.system(size: 13, design: .monospaced))
                                    .foregroundStyle(Palette.text)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .textSelection(.enabled)
                                    .id(index)
                            }
                        }
                        .padding(DesignTokens.space16)
                    }
                    .onAppear {
                        proxy.scrollTo(log.entries.count - 1, anchor: .bottom)
                    }
                }
            }
        }
        .background(Palette.bg)
        .navigationTitle("Playback log")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Copy") {
                    UIPasteboard.general.string = log.text
                }
                .disabled(log.entries.isEmpty)
            }
            ToolbarItem(placement: .secondaryAction) {
                Button("Clear", role: .destructive) {
                    log.clear()
                }
            }
        }
    }
}
