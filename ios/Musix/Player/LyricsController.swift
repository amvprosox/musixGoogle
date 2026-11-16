import Combine
import Foundation
import MusixCore

enum LyricsLoad: Equatable {
    case idle
    case loading
    case found(Lyrics)
    case missing
    case failed(String)
}

@MainActor
final class LyricsController: ObservableObject {
    @Published private(set) var load: LyricsLoad = .idle

    private let engine: WebEngine
    private let player: PlayerController
    private let downloads: DownloadController
    private var cancellables = Set<AnyCancellable>()
    private var task: Task<Void, Never>?
    private var currentKey = ""
    private var visible = false

    init(engine: WebEngine, player: PlayerController, downloads: DownloadController) {
        self.engine = engine
        self.player = player
        self.downloads = downloads
        player.$state
            .receive(on: RunLoop.main)
            .sink { [weak self] state in
                self?.track(state)
            }
            .store(in: &cancellables)
    }

    func setVisible(_ visible: Bool) {
        self.visible = visible
        if visible {
            track(player.state)
        } else {
            task?.cancel()
            currentKey = ""
        }
    }

    func retry() {
        currentKey = ""
        track(player.state)
    }

    private func track(_ state: BridgeState) {
        let title = state.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard visible, !state.isAd, !state.videoId.isEmpty, !title.isEmpty, state.durationSec > 0 else {
            return
        }
        let key = [state.videoId, state.title, state.artist, String(Int(state.durationSec.rounded()))].joined(separator: "|")
        guard key != currentKey else {
            return
        }
        currentKey = key
        task?.cancel()
        if let stored = downloads.storedLyrics(for: state.videoId) {
            load = .found(stored)
            return
        }
        if player.isOfflinePlaying {
            load = .missing
            return
        }
        load = .loading
        let command = BridgeCommand.lyrics(
            videoId: state.videoId,
            title: state.title,
            artist: state.artist,
            album: state.album,
            durationSec: state.durationSec
        )
        let video = state.videoId
        let queue = engine.commandQueue
        task = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(Self.settleMilliseconds))
            guard !Task.isCancelled else {
                return
            }
            let result = await queue.send(command)
            guard let self, !Task.isCancelled, self.currentKey == key else {
                return
            }
            switch result {
            case let .lyrics(lyrics):
                if let lyrics, lyrics.videoId != video {
                    return
                }
                self.load = lyrics.map { .found($0) } ?? .missing
            case let .failed(_, message):
                self.load = .failed(message)
            case .timedOut:
                self.load = .failed("YouTube Music did not respond. Try again.")
            case .notReady:
                self.load = .failed("YouTube Music is still loading. Try again in a moment.")
            case .acknowledged, .page, .suggestions:
                self.load = .missing
            }
        }
    }

    private static let settleMilliseconds = 1200
}

@MainActor
final class SearchSuggester: ObservableObject {
    @Published private(set) var suggestions: SearchSuggestions = .empty

    private let queue: CommandQueue
    private var task: Task<Void, Never>?

    init(queue: CommandQueue) {
        self.queue = queue
    }

    func update(_ text: String) {
        task?.cancel()
        let trimmed = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        guard !trimmed.isEmpty else {
            suggestions = .empty
            return
        }
        let queue = self.queue
        task = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else {
                return
            }
            let result = await queue.send(.suggest(query: trimmed))
            guard let self, !Task.isCancelled, case let .suggestions(found) = result else {
                return
            }
            self.suggestions = found
        }
    }

    func clear() {
        task?.cancel()
        suggestions = .empty
    }
}
