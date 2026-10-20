declare module 'mpris-service' {
  import type { EventEmitter } from 'node:events';

  interface PlayerOptions {
    name: string;
    identity: string;
    supportedUriSchemes?: string[];
    supportedMimeTypes?: string[];
    supportedInterfaces?: string[];
    desktopEntry?: string;
  }

  interface MprisPlayer extends EventEmitter {
    metadata: Record<string, unknown>;
    playbackStatus: 'Playing' | 'Paused' | 'Stopped';
    loopStatus: 'None' | 'Track' | 'Playlist';
    shuffle: boolean;
    volume: number;
    canGoNext: boolean;
    canGoPrevious: boolean;
    canPlay: boolean;
    canPause: boolean;
    canSeek: boolean;
    canControl: boolean;
    canRaise: boolean;
    canQuit: boolean;
    getPosition: () => number;
    seeked(positionMicroseconds: number): void;
    objectPath(subpath: string): string;
  }

  interface PlayerConstructor {
    new (options: PlayerOptions): MprisPlayer;
    (options: PlayerOptions): MprisPlayer;
  }

  const Player: PlayerConstructor;
  export default Player;
  export type { MprisPlayer, PlayerOptions };
}
