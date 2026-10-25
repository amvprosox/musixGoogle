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
    private var cancellables = Set<AnyCancellable>()
    private var task: Task<Void, Never>?
    private var currentVideo = ""

    init(engine: WebEngine) {
        self.engine = engine
        engine.$state
            .receive(on: RunLoop.main)
            .sink { [weak self] state in
                self?.track(state)
            }
            .store(in: &cancellables)
    }

    func retry() {
        currentVideo = ""
        track(engine.state)
    }

    private func track(_ state: BridgeState) {
        let title = state.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !state.isAd, !state.videoId.isEmpty, !title.isEmpty, state.durationSec > 0, state.videoId != currentVideo else {
            return
        }
        let video = state.videoId
        currentVideo = video
        task?.cancel()
        load = .loading
        let command = BridgeCommand.lyrics(
            videoId: video,
            title: state.title,
            artist: state.artist,
            album: state.album,
            durationSec: state.durationSec
        )
        let queue = engine.commandQueue
        task = Task { [weak self] in
            let result = await queue.send(command)
            guard let self, !Task.isCancelled, self.currentVideo == video else {
                return
            }
            switch result {
            case let .lyrics(lyrics):
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
