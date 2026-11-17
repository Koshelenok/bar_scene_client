import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./styles.css";
import * as signalR from '@microsoft/signalr';
import PixiScene from "./PixiScene";
import { useSignalR } from "./useSignalR";
import { resolveClientId, resolveRoomId } from "./room";
import { characterColor } from "./colors";
import { loadRoomPosition, pruneStaleRooms, saveRoomPosition } from "./roomStorage";
import { isSignalMessage, parseRoomMessage, PROTOCOL_VERSION } from "./network";
import type { OutgoingSignal, Position, PresenceKind, RoomMessage } from "./network";
import { useVoiceChat, volumeForDistance } from "./useVoiceChat";

const CHARACTER_Y = (1.8 * 1.5) / 2;
const SPAWN_POSITION: Position = [0.7, CHARACTER_Y, 0.4];

// Every client polls the room every 30s: it broadcasts `hello`, other clients
// answer with `presence` and their current position, so we can verify that
// everybody we see is still there.
const PRESENCE_POLL_MS = 30_000;
// A peer that missed three polls in a row is considered gone. Three (not two)
// gives hidden/backgrounded tabs, whose timers browsers throttle, time to answer.
const PEER_TTL_MS = 95_000;
// Joining clients poll the room for peers, retrying in case somebody was
// reconnecting when the first poll went out.
const PRESENCE_RETRY_MS = 2_000;
const PRESENCE_MAX_ATTEMPTS = 3;
// Saved room positions are cleaned up both on start and while the page is open.
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
// How often voice volume is recalculated from the characters' live positions.
const VOLUME_INTERVAL_MS = 100;

type Peer = {
  position: Position;
  lastSeen: number;
};

export default function App() {
  const roomId = useMemo(resolveRoomId, []);
  const myId = useMemo(() => resolveClientId(roomId), [roomId]);
  const myColor = useMemo(() => characterColor(myId), [myId]);

  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const peerPositions = useMemo(
    () => Object.fromEntries(Object.entries(peers).map(([id, peer]) => [id, peer.position])),
    [peers]
  );
  const [characterPosition, setCharacterPosition] = useState<Position>(SPAWN_POSITION);
  // True once IndexedDB has been checked, so the join poll and our character
  // use the restored position instead of the default spawn one.
  const [positionReady, setPositionReady] = useState(false);

  // Mirrors of the state that message handlers need without re-subscribing.
  const peersRef = useRef<Record<string, Peer>>({});
  const characterPositionRef = useRef<Position>(SPAWN_POSITION);
  // Live (animated) positions of all characters, updated by the scene at ~10 Hz.
  const livePositionsRef = useRef<Record<string, Position>>({});

  const { connection, isConnected } = useSignalR();

  const publish = useCallback(
    async (message: RoomMessage) => {
      if (!connection || connection.state !== signalR.HubConnectionState.Connected) return;
      try {
        await connection.invoke('SendMessage', myId, JSON.stringify(message));
      } catch (e) {
        console.error(e);
      }
    },
    [connection, myId]
  );

  const send = useCallback(
    (kind: PresenceKind, position: Position) => {
      void publish({ v: PROTOCOL_VERSION, room: roomId, kind, position });
    },
    [publish, roomId]
  );

  const sendSignal = useCallback(
    (signal: OutgoingSignal) => {
      void publish({ v: PROTOCOL_VERSION, room: roomId, ...signal });
    },
    [publish, roomId]
  );

  const voice = useVoiceChat({ myId, sendSignal });

  const upsertPeer = useCallback((id: string, position: Position) => {
    const next = { ...peersRef.current, [id]: { position, lastSeen: Date.now() } };
    peersRef.current = next;
    setPeers(next);
  }, []);

  const handleCharacterMove = useCallback((id: string, position: Position) => {
    livePositionsRef.current[id] = position;
  }, []);

  const setCharacterPositionAndSend = useCallback(
    (position: Position) => {
      characterPositionRef.current = position;
      setCharacterPosition(position);
      void saveRoomPosition(roomId, position);
      send('position', position);
    },
    [roomId, send]
  );

  // Restore the last position of this user in this room and remove saved rooms
  // that were added more than an hour ago.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const savedPosition = await loadRoomPosition(roomId);
      if (cancelled) return;

      if (savedPosition) {
        characterPositionRef.current = savedPosition;
        setCharacterPosition(savedPosition);
      }
      setPositionReady(true);
      void saveRoomPosition(roomId, characterPositionRef.current);
    })();

    void pruneStaleRooms();
    const prune = window.setInterval(() => void pruneStaleRooms(), PRUNE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(prune);
    };
  }, [roomId]);

  const onMessageReceive = useCallback(
    (user: string, raw: string) => {
      if (user === myId) return;

      const message = parseRoomMessage(raw);
      if (!message || message.room !== roomId) return;

      if (isSignalMessage(message)) {
        voice.handleSignal(user, message);
        return;
      }

      upsertPeer(user, message.position);

      // A `join` means the peer (re)entered the room, so any old WebRTC
      // connection to it is dead; other kinds only announce presence.
      if (message.kind === 'join') voice.handleJoin(user);
      else voice.handlePeerSeen(user);

      // Somebody just entered or polled the room: answer with our location.
      if (message.kind === 'join' || message.kind === 'hello') {
        send('presence', characterPositionRef.current);
      }
    },
    [myId, roomId, send, upsertPeer, voice]
  );

  useEffect(() => {
    if (!connection) return;
    connection.on('ReceiveMessage', onMessageReceive);
    return () => connection.off('ReceiveMessage', onMessageReceive);
  }, [connection, onMessageReceive]);

  // On join (and reconnect) poll the room: announce ourselves and ask the
  // other clients to reply with their positions.
  useEffect(() => {
    if (!connection || !isConnected || !positionReady) return;

    let cancelled = false;
    let timer = 0;
    let attempt = 0;

    const poll = (initial: boolean) => {
      if (cancelled) return;
      send(initial ? 'join' : 'hello', characterPositionRef.current);
      attempt += 1;

      const alone = Object.keys(peersRef.current).length === 0;
      if (alone && attempt < PRESENCE_MAX_ATTEMPTS) {
        timer = window.setTimeout(() => poll(false), PRESENCE_RETRY_MS);
      }
    };

    poll(true);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connection, isConnected, positionReady, send]);

  // Every 30s ask the room to confirm positions, and drop peers that missed
  // several polls in a row.
  useEffect(() => {
    if (!connection || !isConnected) return;

    const poll = window.setInterval(() => {
      send('hello', characterPositionRef.current);
    }, PRESENCE_POLL_MS);

    const prune = window.setInterval(() => {
      const now = Date.now();
      const alive = Object.entries(peersRef.current).filter(
        ([, peer]) => now - peer.lastSeen <= PEER_TTL_MS
      );

      if (alive.length === Object.keys(peersRef.current).length) return;

      const next = Object.fromEntries(alive);
      const removed = Object.keys(peersRef.current).filter(id => !(id in next));

      peersRef.current = next;
      setPeers(next);
      removed.forEach(id => {
        voice.removePeer(id);
        delete livePositionsRef.current[id];
      });
    }, PEER_TTL_MS / 2);

    return () => {
      window.clearInterval(poll);
      window.clearInterval(prune);
    };
  }, [connection, isConnected, send, voice]);

  // Attenuate each peer's voice by the distance between the animated characters.
  useEffect(() => {
    const applyVolumes = () => {
      const self = livePositionsRef.current[myId];
      if (!self) return;

      for (const [id, position] of Object.entries(livePositionsRef.current)) {
        if (id === myId) continue;
        voice.setPeerVolume(id, volumeForDistance(self, position));
      }
    };

    const timer = window.setInterval(applyVolumes, VOLUME_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [myId, voice]);

  return (
    <>
      <button
        className={`voice-toggle${voice.enabled ? ' voice-toggle--on' : ''}`}
        onClick={voice.toggle}
        title={voice.error ?? 'Передать голос участникам комнаты'}
      >
        {voice.enabled ? 'Выключить микрофон' : 'Включить микрофон'}
      </button>
      {voice.error && <div className="voice-error">{voice.error}</div>}

      <PixiScene
        myId={myId}
        selfPosition={characterPosition}
        selfColor={myColor}
        peers={peerPositions}
        positionReady={positionReady}
        onMove={handleCharacterMove}
        onGroundClick={setCharacterPositionAndSend}
      />
    </>
  );
}
