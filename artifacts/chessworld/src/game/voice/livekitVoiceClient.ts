import {
  Room,
  RoomEvent,
  Track,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
} from 'livekit-client';
import { getWorldRoom } from '../network/colyseusClient';

const COLYSEUS_URL = import.meta.env.VITE_COLYSEUS_URL || '';

function getHttpBaseUrl(): string {
  return COLYSEUS_URL.replace('wss://', 'https://').replace('ws://', 'http://');
}

export type VoiceStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

type StatusListener = (status: VoiceStatus, error?: string) => void;

class LiveKitVoiceClient {
  private room: Room | null = null;
  private statusListeners = new Set<StatusListener>();
  private _status: VoiceStatus = 'disconnected';
  private _error: string | null = null;
  private _micEnabled = false;

  get status(): VoiceStatus {
    return this._status;
  }

  get error(): string | null {
    return this._error;
  }

  get micEnabled(): boolean {
    return this._micEnabled;
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: VoiceStatus, error?: string) {
    this._status = status;
    this._error = error || null;
    this.statusListeners.forEach((l) => l(status, error));
  }

  async join(region: string, identity: string, username: string): Promise<void> {
    if (this.room) {
      await this.leave();
    }

    this.setStatus('connecting');
    this._micEnabled = false;

    const roomName = `voice_world_${region}`;
    const baseUrl = getHttpBaseUrl();

    let token: string;
    let url: string;

    try {
      const resp = await fetch(`${baseUrl}/voice/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, identity, name: username }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `Token request failed: ${resp.status}`);
      }

      const data = await resp.json();
      token = data.token;
      url = data.url;
    } catch (e: any) {
      this.setStatus('error', e.message || 'Failed to get voice token');
      return;
    }

    try {
      const room = new Room({
        audioCaptureDefaults: { autoGainControl: true, noiseSuppression: true, echoCancellation: true },
        publishDefaults: { audioPreset: { maxBitrate: 48_000 } },
      });

      room.on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed);
      room.on(RoomEvent.TrackUnsubscribed, this.handleTrackUnsubscribed);
      room.on(RoomEvent.Disconnected, this.handleDisconnected);

      await room.connect(url, token);

      this.room = room;
      this.setStatus('connected');

      const worldRoom = getWorldRoom();
      worldRoom?.send('voice_joined', {});
    } catch (e: any) {
      this.setStatus('error', e.message || 'Failed to connect to voice');
    }
  }

  async leave(): Promise<void> {
    if (!this.room) return;

    const worldRoom = getWorldRoom();
    worldRoom?.send('voice_left', {});

    await this.room.disconnect(true);
    this.room = null;
    this._micEnabled = false;
    this.setStatus('disconnected');
  }

  async toggleMic(): Promise<boolean> {
    if (!this.room) return false;

    const newState = !this._micEnabled;

    try {
      await this.room.localParticipant.setMicrophoneEnabled(newState);
      this._micEnabled = newState;

      const worldRoom = getWorldRoom();
      worldRoom?.send('voice_muted_changed', { muted: !newState });

      return true;
    } catch {
      this._micEnabled = false;
      return false;
    }
  }

  private handleTrackSubscribed = (
    track: RemoteTrack,
    _publication: RemoteTrackPublication,
    _participant: RemoteParticipant,
  ) => {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach();
      el.id = `voice-audio-${track.sid}`;
      document.body.appendChild(el);
    }
  };

  private handleTrackUnsubscribed = (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio) {
      track.detach().forEach((el) => el.remove());
      const existing = document.getElementById(`voice-audio-${track.sid}`);
      existing?.remove();
    }
  };

  private handleDisconnected = () => {
    this.room = null;
    this._micEnabled = false;
    this.setStatus('disconnected');

    const worldRoom = getWorldRoom();
    worldRoom?.send('voice_left', {});
  };
}

export const voiceClient = new LiveKitVoiceClient();
