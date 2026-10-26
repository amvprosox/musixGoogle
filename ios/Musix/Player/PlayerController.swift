import AVFoundation
import Combine
import Foundation
import MediaPlayer
import MusixCore
import UIKit

struct PlaylistError: Error, Equatable {
    let message: String
}

@MainActor
final class PlayerController: ObservableObject {
    @Published private(set) var state: BridgeState = .empty
    @Published private(set) var timeline: TimelineSpec = .empty
    @Published private(set) var artwork: UIImage?
    @Published var message: String?

    private let engine: WebEngine
    private let settings: AppSettings
    private var cancellables = Set<AnyCancellable>()
    private var policy = InterruptionPolicy()
    private var artworkAddress = ""
    private var lastPublished: NowPlayingInfo?
    private var lastSavedAt = Date.distantPast
    private var lastSavedVideo = ""
    private var sessionActive = false
    private var pendingPlay: (value: Bool, until: Date)?
    private var stateAt = Date()
    private var actualPlaying = false
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var keepAlive: Task<Void, Never>?
    private var lastIncoming: BridgeState?
    private var bufferingSince: Date?

    init(engine: WebEngine, settings: AppSettings) {
        self.engine = engine
        self.settings = settings
        configureAudioSession()
        observeAudioSession()
        configureRemoteCommands()
        engine.$state
            .combineLatest(engine.$queueEntries)
            .receive(on: RunLoop.main)
            .sink { [weak self] state, queue in
                self?.update(state: state, queue: queue)
            }
            .store(in: &cancellables)
        engine.errors
            .receive(on: RunLoop.main)
            .sink { [weak self] text in
                PlaybackLog.shared.add("YouTube Music error: \(text)")
                self?.message = text
            }
            .store(in: &cancellables)
        engine.$account
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.refreshRemoteAvailability()
            }
            .store(in: &cancellables)
    }

    var hasTrack: Bool { timeline.current != nil }

    var isLiked: Bool { state.likeStatus == .like }

    var positionSec: Double { PlaybackModel.position(state) }

    func livePositionSec(at date: Date) -> Double {
        let base = positionSec
        guard state.isPlaying, !state.isBuffering, !state.isAd, pendingPlay == nil else {
            return base
        }
        let moved = base + max(0, date.timeIntervalSince(stateAt))
        return state.durationSec > 0 ? min(moved, state.durationSec) : moved
    }

    var availability: RemoteAvailability {
        PlaybackModel.availability(state: state, timeline: timeline, signedIn: engine.account == .signedIn)
    }

    func play() {
        PlaybackLog.shared.add("Play requested")
        activateSession()
        policy = InterruptionPolicy()
        expect(playing: true)
        performPlayback(.play)
    }

    func pause() {
        PlaybackLog.shared.add("Pause requested")
        policy.userPaused()
        endKeepAlive()
        expect(playing: false)
        performPlayback(.pause)
    }

    private func expect(playing: Bool) {
        pendingPlay = (playing, Date().addingTimeInterval(4))
        guard state.isPlaying != playing else {
            return
        }
        var shown = state
        shown.isPlaying = playing
        state = shown
        publishNowPlaying()
    }

    private func performPlayback(_ command: BridgeCommand) {
        Task {
            let result = await send(command)
            if result != .acknowledged {
                PlaybackLog.shared.add("\(command.typeName) did not go through: \(result)")
                pendingPlay = nil
                update(state: engine.state, queue: engine.queueEntries)
            }
        }
    }

    func togglePlay() {
        if state.isPlaying {
            pause()
        } else {
            play()
        }
    }

    func next() {
        perform(.next)
    }

    func previous() {
        switch PlaybackModel.previousAction(positionSec: positionSec) {
        case let .seekWithinTrack(seconds):
            perform(.seekTo(seconds: seconds))
        case .previousTrack, .nextTrack:
            perform(.previous)
        }
    }

    func seek(to seconds: Double) {
        perform(.seekTo(seconds: max(0, seconds)))
    }

    func toggleLike() {
        perform(.toggleLike)
    }

    func toggleShuffle() {
        perform(.setShuffle(!state.shuffle))
    }

    func cycleRepeat() {
        perform(.setRepeat(state.repeatMode.next))
    }

    func play(mediaId: String) {
        guard let ref = MediaIds.parse(mediaId) else {
            message = "This item cannot be played."
            return
        }
        activateSession()
        switch ref {
        case let .track(videoId, playlistId):
            perform(.playVideoId(videoId: videoId, playlistId: playlistId))
        case let .node(_, playlistId):
            guard let playlistId else {
                message = "This item cannot be played directly."
                return
            }
            perform(.playVideoId(videoId: "", playlistId: playlistId))
        default:
            message = "This item cannot be played."
        }
    }

    func resumeLastSession() async -> Bool {
        guard let snapshot = settings.resume else {
            return false
        }
        activateSession()
        let result = await engine.restore(snapshot, play: true)
        report(result)
        return result == .acknowledged
    }

    func playlistTargets() async -> Result<[FlatItem], PlaylistError> {
        guard let videoId = timeline.current?.videoId, BridgeCodec.isValidVideoId(videoId) else {
            return .failure(PlaylistError(message: "Play a song first."))
        }
        switch await engine.commandQueue.send(.playlistTargets(videoId: videoId)) {
        case let .page(page):
            return .success(page.items)
        case let .failed(_, text):
            return .failure(PlaylistError(message: text))
        case .notReady:
            return .failure(PlaylistError(message: "YouTube Music is still loading. Try again in a moment."))
        case .timedOut, .acknowledged, .lyrics, .suggestions:
            return .failure(PlaylistError(message: "YouTube Music did not respond. Try again."))
        }
    }

    func addCurrent(to playlistId: String, title: String) async -> Bool {
        guard let videoId = timeline.current?.videoId, BridgeCodec.isValidVideoId(videoId) else {
            message = "Play a song first."
            return false
        }
        let result = await send(.addToPlaylist(videoId: videoId, playlistId: playlistId))
        if result == .acknowledged {
            message = "Saved to \(title)"
            return true
        }
        return false
    }

    func saveCollection(playlistId: String, save: Bool, title: String) async {
        let result = await send(.savePlaylist(playlistId: playlistId, save: save))
        if result == .acknowledged {
            message = save ? "\(title) saved to your library" : "\(title) removed from your library"
        }
    }

    @discardableResult
    func send(_ command: BridgeCommand) async -> CommandResult {
        let result = await engine.commandQueue.send(command)
        report(result)
        return result
    }

    private func perform(_ command: BridgeCommand) {
        if command == .play || command == .pause {
            pendingPlay = nil
        }
        Task { await send(command) }
    }

    private func report(_ result: CommandResult) {
        switch result {
        case .acknowledged, .page, .lyrics, .suggestions:
            break
        case .notReady:
            message = "YouTube Music is still loading. Try again in a moment."
        case .timedOut:
            message = "YouTube Music did not respond. Try again."
        case let .failed(_, text):
            message = text
        }
    }

    private func update(state incoming: BridgeState, queue: [QueueEntry]) {
        let wasPlaying = state.isPlaying
        var newState = incoming
        if let pending = pendingPlay {
            if incoming.isPlaying == pending.value || Date() > pending.until {
                pendingPlay = nil
            } else {
                newState.isPlaying = pending.value
            }
        }
        stateAt = Date()
        actualPlaying = incoming.isPlaying
        logChanges(from: lastIncoming, to: incoming)
        lastIncoming = incoming
        state = newState
        let newTimeline = PlaybackModel.timeline(state: newState, queue: queue)
        if newTimeline != timeline {
            timeline = newTimeline
        }
        if newState.isPlaying, !wasPlaying {
            activateSession()
        }
        loadArtworkIfNeeded()
        publishNowPlaying()
        refreshRemoteAvailability()
        saveResume(newState)
    }

    private func saveResume(_ state: BridgeState) {
        guard let snapshot = ResumeSnapshot.from(state, now: Date()) else {
            return
        }
        let due = Date().timeIntervalSince(lastSavedAt) > 15
        if snapshot.videoId != lastSavedVideo || due || !state.isPlaying {
            settings.resume = snapshot
            lastSavedAt = Date()
            lastSavedVideo = snapshot.videoId
        }
    }

    private func loadArtworkIfNeeded() {
        let address = timeline.current?.artworkUrl ?? ""
        guard address != artworkAddress else {
            return
        }
        artworkAddress = address
        artwork = nil
        guard !address.isEmpty else {
            lastPublished = nil
            publishNowPlaying()
            return
        }
        Task {
            let data = await ArtworkLoader.shared.data(for: address)
            guard address == artworkAddress, let data, let image = UIImage(data: data) else {
                return
            }
            artwork = image
            lastPublished = nil
            publishNowPlaying()
        }
    }

    private func publishNowPlaying() {
        let center = MPNowPlayingInfoCenter.default()
        guard let info = PlaybackModel.nowPlaying(state: state, timeline: timeline) else {
            if lastPublished != nil {
                center.nowPlayingInfo = nil
                lastPublished = nil
            }
            return
        }
        if let previous = lastPublished,
           previous.title == info.title,
           previous.artist == info.artist,
           previous.album == info.album,
           previous.rate == info.rate,
           previous.durationSec == info.durationSec,
           !driftedFrom(previous, to: info) {
            return
        }
        var values: [String: Any] = [
            MPMediaItemPropertyTitle: info.title,
            MPMediaItemPropertyArtist: info.artist,
            MPMediaItemPropertyAlbumTitle: info.album,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: info.elapsedSec,
            MPNowPlayingInfoPropertyPlaybackRate: info.rate,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyPlaybackQueueIndex: info.queueIndex,
            MPNowPlayingInfoPropertyPlaybackQueueCount: info.queueCount,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
            MPNowPlayingInfoPropertyIsLiveStream: info.isLiveLike,
        ]
        if let duration = info.durationSec {
            values[MPMediaItemPropertyPlaybackDuration] = duration
        }
        if let image = artwork {
            values[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        }
        center.nowPlayingInfo = values
        lastPublished = info
        publishedAt = Date()
    }

    private var publishedAt = Date.distantPast

    private func driftedFrom(_ previous: NowPlayingInfo, to info: NowPlayingInfo) -> Bool {
        let expected = previous.elapsedSec + previous.rate * Date().timeIntervalSince(publishedAt)
        return abs(expected - info.elapsedSec) > 1.5 || previous.queueIndex != info.queueIndex || previous.queueCount != info.queueCount
    }

    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, policy: .longFormAudio)
        } catch {
            NSLog("Musix could not configure the audio session: %@", error.localizedDescription)
        }
    }

    private func activateSession() {
        guard !sessionActive else {
            return
        }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            sessionActive = true
        } catch {
            message = "Audio could not start because another app is using it."
        }
    }

    private func observeAudioSession() {
        let center = NotificationCenter.default
        center.publisher(for: AVAudioSession.interruptionNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] note in
                self?.handleInterruption(note)
            }
            .store(in: &cancellables)
        center.publisher(for: AVAudioSession.routeChangeNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] note in
                self?.handleRouteChange(note)
            }
            .store(in: &cancellables)
        center.publisher(for: UIApplication.didEnterBackgroundNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.enteredBackground()
            }
            .store(in: &cancellables)
        center.publisher(for: UIApplication.willEnterForegroundNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.endKeepAlive()
            }
            .store(in: &cancellables)
        center.publisher(for: AVAudioSession.mediaServicesWereResetNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.sessionActive = false
                self?.configureAudioSession()
            }
            .store(in: &cancellables)
    }

    private func handleInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else {
            return
        }
        switch type {
        case .began:
            sessionActive = false
            endKeepAlive()
            let action = policy.began(wasPlaying: actualPlaying)
            PlaybackLog.shared.add("Audio interrupted by a call, alarm or another app, \(action == .pause ? "pausing" : "nothing playing")")
            if action == .pause {
                perform(.pause)
            }
        case .ended:
            let optionsRaw = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let shouldResume = AVAudioSession.InterruptionOptions(rawValue: optionsRaw).contains(.shouldResume)
            let action = policy.ended(shouldResume: shouldResume)
            PlaybackLog.shared.add("Interruption ended, \(action == .resume ? "resuming" : "staying paused")")
            if action == .resume {
                activateSession()
                perform(.play)
            }
        @unknown default:
            break
        }
    }

    private func handleRouteChange(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw),
              reason == .oldDeviceUnavailable else {
            return
        }
        if policy.routeLost(wasPlaying: actualPlaying) == .pause {
            PlaybackLog.shared.add("Headphones or speaker disconnected, pausing")
            endKeepAlive()
            perform(.pause)
        }
    }

    private func enteredBackground() {
        guard actualPlaying || pendingPlay?.value == true else {
            PlaybackLog.shared.add("App went to the background while paused")
            return
        }
        PlaybackLog.shared.add("App went to the background while playing, keeping playback alive")
        endKeepAlive()
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Musix keeps playing") { [weak self] in
            Task { @MainActor in
                self?.endKeepAlive()
            }
        }
        let queue = engine.commandQueue
        keepAlive = Task { [weak self] in
            for delay in Self.backgroundResumeDelays {
                try? await Task.sleep(for: .milliseconds(delay))
                guard !Task.isCancelled else {
                    return
                }
                let result = await queue.send(.play)
                PlaybackLog.shared.add("Background keep-alive play: \(result == .acknowledged ? "ok" : "\(result)")")
            }
            self?.endKeepAlive()
        }
    }

    private func logChanges(from old: BridgeState?, to new: BridgeState) {
        let log = PlaybackLog.shared
        let at = formatTime(new.positionSec)
        if new.videoId != old?.videoId, !new.videoId.isEmpty {
            log.add("Song: \(new.title.isEmpty ? new.videoId : new.title)\(new.artist.isEmpty ? "" : " - \(new.artist)")")
        }
        if new.isAd != (old?.isAd ?? false) {
            log.add(new.isAd ? "Ad started" : "Ad ended")
        }
        let wasPlaying = old?.isPlaying ?? false
        if new.isPlaying != wasPlaying {
            log.add(new.isPlaying ? "Playing at \(at)" : "Stopped at \(at)\(new.durationSec > 0 ? " of \(formatTime(new.durationSec))" : "")")
        }
        let wasBuffering = old?.isBuffering ?? false
        if new.isBuffering, !wasBuffering {
            bufferingSince = Date()
            log.add("Waiting for audio from YouTube at \(at)")
        } else if !new.isBuffering, wasBuffering, let since = bufferingSince {
            bufferingSince = nil
            log.add("Audio arrived after \(String(format: "%.1f", Date().timeIntervalSince(since))) s")
        }
    }

    private func endKeepAlive() {
        keepAlive?.cancel()
        keepAlive = nil
        if backgroundTask != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTask)
            backgroundTask = .invalid
        }
    }

    private static let backgroundResumeDelays: [Int] = [400, 1100, 1500, 3000, 4000]

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                PlaybackLog.shared.add("Lock screen or headphones: play")
                self?.play()
            }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                PlaybackLog.shared.add("Lock screen or headphones: pause")
                self?.pause()
            }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                PlaybackLog.shared.add("Lock screen or headphones: play/pause")
                self?.togglePlay()
            }
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.next() }
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.previous() }
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            let position = event.positionTime
            Task { @MainActor in self?.seek(to: position) }
            return .success
        }
        center.likeCommand.localizedTitle = "Like"
        center.likeCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.toggleLike() }
            return .success
        }
        center.changeShuffleModeCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangeShuffleModeCommandEvent else {
                return .commandFailed
            }
            let enabled = event.shuffleType != .off
            Task { @MainActor in
                guard let self, enabled != self.state.shuffle else {
                    return
                }
                self.perform(.setShuffle(enabled))
            }
            return .success
        }
        center.changeRepeatModeCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangeRepeatModeCommandEvent else {
                return .commandFailed
            }
            let mode: RepeatMode
            switch event.repeatType {
            case .off: mode = .none
            case .one: mode = .one
            case .all: mode = .all
            @unknown default: mode = .none
            }
            Task { @MainActor in self?.perform(.setRepeat(mode)) }
            return .success
        }
        center.dislikeCommand.isEnabled = false
        center.bookmarkCommand.isEnabled = false
        center.skipForwardCommand.isEnabled = false
        center.skipBackwardCommand.isEnabled = false
        center.seekForwardCommand.isEnabled = false
        center.seekBackwardCommand.isEnabled = false
        center.changePlaybackRateCommand.isEnabled = false
        center.ratingCommand.isEnabled = false
        refreshRemoteAvailability()
    }

    private func refreshRemoteAvailability() {
        let center = MPRemoteCommandCenter.shared()
        let available = availability
        center.playCommand.isEnabled = available.playPause
        center.pauseCommand.isEnabled = available.playPause
        center.togglePlayPauseCommand.isEnabled = available.playPause
        center.nextTrackCommand.isEnabled = available.next
        center.previousTrackCommand.isEnabled = available.previous
        center.changePlaybackPositionCommand.isEnabled = available.seek
        center.likeCommand.isEnabled = available.like
        center.likeCommand.isActive = isLiked
        center.changeShuffleModeCommand.isEnabled = available.shuffle
        center.changeShuffleModeCommand.currentShuffleType = state.shuffle ? .items : .off
        center.changeRepeatModeCommand.isEnabled = available.repeatMode
        switch state.repeatMode {
        case .none: center.changeRepeatModeCommand.currentRepeatType = .off
        case .all: center.changeRepeatModeCommand.currentRepeatType = .all
        case .one: center.changeRepeatModeCommand.currentRepeatType = .one
        }
    }
}
