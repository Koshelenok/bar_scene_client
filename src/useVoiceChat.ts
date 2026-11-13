import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OutgoingSignal, Position, SignalMessage } from "./network";

/**
 * Free public STUN servers. They are only used to discover the public IP/port
 * of both peers; the voice itself then flows directly peer-to-peer over WebRTC.
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:global.stun.twilio.com:3478" },
];

// Full volume while closer than NEAR_DISTANCE, silence past FAR_DISTANCE.
const NEAR_DISTANCE = 2;
const FAR_DISTANCE = 14;

/** 1 near the other character, falling quadratically to 0 with distance. */
export const volumeForDistance = (a: Position, b: Position): number => {
  const distance = Math.hypot(a[0] - b[0], a[2] - b[2]);

  if (distance <= NEAR_DISTANCE) return 1;
  if (distance >= FAR_DISTANCE) return 0;

  const falloff = (FAR_DISTANCE - distance) / (FAR_DISTANCE - NEAR_DISTANCE);
  return falloff * falloff;
};

type SendSignal = (signal: OutgoingSignal) => void;

type PeerEntry = {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  pendingCandidates: RTCIceCandidateInit[];
  hasRemoteDescription: boolean;
  makingOffer: boolean;
};

type UseVoiceChatOptions = {
  myId: string;
  sendSignal: SendSignal;
};

export type VoiceChat = {
  enabled: boolean;
  error: string | null;
  toggle: () => void;
  handlePeerSeen: (peerId: string) => void;
  handleJoin: (peerId: string) => void;
  handleSignal: (from: string, message: SignalMessage) => void;
  setPeerVolume: (peerId: string, volume: number) => void;
  removePeer: (peerId: string) => void;
};

export function useVoiceChat({ myId, sendSignal }: UseVoiceChatOptions): VoiceChat {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const peersRef = useRef(new Map<string, PeerEntry>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const enabledRef = useRef(false);
  const myIdRef = useRef(myId);
  const sendSignalRef = useRef(sendSignal);

  myIdRef.current = myId;
  sendSignalRef.current = sendSignal;

  const closePeer = useCallback((peerId: string) => {
    const entry = peersRef.current.get(peerId);
    if (!entry) return;

    peersRef.current.delete(peerId);
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.onconnectionstatechange = null;
    entry.pc.close();
    entry.audio.pause();
    entry.audio.srcObject = null;
    entry.audio.remove();
  }, []);

  const flushCandidates = useCallback(async (entry: PeerEntry) => {
    const candidates = entry.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch (e) {
        console.warn("Failed to add ICE candidate", e);
      }
    }
  }, []);

  /** Sends the microphone track through an already negotiated audio channel. */
  const attachLocalTrack = useCallback(async (entry: PeerEntry, track: MediaStreamTrack) => {
    const transceiver = entry.pc
      .getTransceivers()
      .find(item => item.receiver.track.kind === "audio");

    if (transceiver) {
      // An answerer that had no microphone negotiated `recvonly`; allow the
      // track to be sent once it appears.
      if (transceiver.direction === "recvonly") {
        transceiver.direction = "sendrecv";
      }
      await transceiver.sender.replaceTrack(track);
      return;
    }

    const stream = localStreamRef.current;
    if (stream) entry.pc.addTrack(track, stream);
  }, []);

  /**
   * (Re)negotiates. Only called when the connection is stable; incoming
   * offers are handled with a simplified "perfect negotiation": the peer with
   * the higher id is polite and rolls back its own offer on a collision.
   */
  const startOffer = useCallback(async (peerId: string, entry: PeerEntry) => {
    if (entry.pc.signalingState !== "stable") return;

    try {
      entry.makingOffer = true;
      const offer = await entry.pc.createOffer();
      if (entry.pc.signalingState !== "stable") return;
      await entry.pc.setLocalDescription(offer);
      sendSignalRef.current({ kind: "webrtc-offer", to: peerId, description: offer });
    } catch (e) {
      console.warn("Failed to create WebRTC offer", e);
    } finally {
      entry.makingOffer = false;
    }
  }, []);

  const createPeer = useCallback(
    (peerId: string, initiate: boolean): PeerEntry => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "true");
      audio.dataset.voicePeer = peerId;
      audio.style.display = "none";
      document.body.appendChild(audio);

      const entry: PeerEntry = {
        pc,
        audio,
        pendingCandidates: [],
        hasRemoteDescription: false,
        makingOffer: false,
      };
      peersRef.current.set(peerId, entry);

      // The offerer always needs an audio section to negotiate. The answerer
      // gets it from the incoming offer, so it must not add one beforehand.
      if (initiate) {
        const stream = localStreamRef.current;
        const track = stream?.getAudioTracks()[0];
        if (stream && track) pc.addTrack(track, stream);
        else pc.addTransceiver("audio", { direction: "sendrecv" });
      }

      pc.onicecandidate = event => {
        if (!event.candidate) return;
        sendSignalRef.current({
          kind: "webrtc-ice",
          to: peerId,
          candidate: event.candidate.toJSON(),
        });
      };

      pc.ontrack = event => {
        // A track added later with `replaceTrack` is not attached to any
        // MediaStream, so `event.streams` can be empty; wrap the track.
        const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
        entry.audio.srcObject = remoteStream;
        void entry.audio.play().catch(() => undefined);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          console.warn("WebRTC connection failed for peer", peerId);
        }
      };

      if (initiate) void startOffer(peerId, entry);
      return entry;
    },
    [startOffer]
  );

  const handlePeerSeen = useCallback(
    (peerId: string) => {
      if (peerId === myIdRef.current || peersRef.current.has(peerId)) return;
      createPeer(peerId, myIdRef.current < peerId);
    },
    [createPeer]
  );

  /** A peer entered the room (or reconnected): its old connection is dead. */
  const handleJoin = useCallback(
    (peerId: string) => {
      if (peerId === myIdRef.current) return;
      closePeer(peerId);
      createPeer(peerId, myIdRef.current < peerId);
    },
    [closePeer, createPeer]
  );

  const handleSignal = useCallback(
    (from: string, message: SignalMessage) => {
      if (message.to !== myIdRef.current) return;

      void (async () => {
        try {
          if (message.kind === "webrtc-offer") {
            const entry = peersRef.current.get(from) ?? createPeer(from, false);
            const pc = entry.pc;
            const polite = myIdRef.current > from;
            const collision = entry.makingOffer || pc.signalingState !== "stable";

            if (collision && !polite) return;

            if (collision) {
              // The other side's offer takes precedence; drop our own.
              await pc.setLocalDescription({ type: "rollback" });
            }

            await pc.setRemoteDescription(message.description);
            entry.hasRemoteDescription = true;

            const track = localStreamRef.current?.getAudioTracks()[0];
            if (track) await attachLocalTrack(entry, track);

            await flushCandidates(entry);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignalRef.current({ kind: "webrtc-answer", to: from, description: answer });
            return;
          }

          const entry = peersRef.current.get(from);
          if (!entry) return;

          if (message.kind === "webrtc-answer") {
            if (entry.pc.signalingState === "have-local-offer") {
              await entry.pc.setRemoteDescription(message.description);
              entry.hasRemoteDescription = true;
              await flushCandidates(entry);
            }
            return;
          }

          if (message.kind !== "webrtc-ice") return;

          if (entry.hasRemoteDescription) {
            await entry.pc.addIceCandidate(message.candidate);
          } else {
            entry.pendingCandidates.push(message.candidate);
          }
        } catch (e) {
          console.warn("WebRTC signaling error", e);
        }
      })();
    },
    [attachLocalTrack, createPeer, flushCandidates]
  );

  const setPeerVolume = useCallback((peerId: string, volume: number) => {
    const entry = peersRef.current.get(peerId);
    if (entry) entry.audio.volume = Math.min(1, Math.max(0, volume));
  }, []);

  const enableMicrophone = useCallback(async () => {
    if (enabledRef.current) return;

    try {
      // The browser applies echo cancellation / noise suppression by default
      // when asking for audio only.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      localStreamRef.current = stream;
      enabledRef.current = true;
      setEnabled(true);
      setError(null);

      const track = stream.getAudioTracks()[0];
      for (const [peerId, entry] of peersRef.current) {
        if (track) await attachLocalTrack(entry, track);

        // The connection may have been negotiated while we had no microphone
        // (answering with `recvonly`), so send a fresh offer that includes the
        // new track. `startOffer` is a no-op during an ongoing negotiation.
        void startOffer(peerId, entry);

        // A user gesture also unlocks playback of already received streams.
        void entry.audio.play().catch(() => undefined);
      }
    } catch (e) {
      console.warn("Microphone access failed", e);
      setError("Не удалось получить доступ к микрофону");
    }
  }, [attachLocalTrack, startOffer]);

  const disableMicrophone = useCallback(() => {
    enabledRef.current = false;
    setEnabled(false);

    const stream = localStreamRef.current;
    localStreamRef.current = null;

    for (const entry of peersRef.current.values()) {
      for (const transceiver of entry.pc.getTransceivers()) {
        if (transceiver.receiver.track.kind === "audio") {
          void transceiver.sender.replaceTrack(null);
        }
      }
    }

    stream?.getTracks().forEach(track => track.stop());
  }, []);

  const toggle = useCallback(() => {
    if (enabledRef.current) disableMicrophone();
    else void enableMicrophone();
  }, [disableMicrophone, enableMicrophone]);

  useEffect(
    () => () => {
      for (const peerId of Array.from(peersRef.current.keys())) closePeer(peerId);
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    },
    [closePeer]
  );

  return useMemo(
    () => ({
      enabled,
      error,
      toggle,
      handlePeerSeen,
      handleJoin,
      handleSignal,
      setPeerVolume,
      removePeer: closePeer,
    }),
    [
      enabled,
      error,
      toggle,
      handlePeerSeen,
      handleJoin,
      handleSignal,
      setPeerVolume,
      closePeer,
    ]
  );
}
