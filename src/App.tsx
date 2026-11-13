import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./styles.css";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import SceneV2 from "./SceneV2";
import Character from "./Character";
import Lamp from "./Lamp";
import * as signalR from '@microsoft/signalr';
import * as THREE from "three";
import { useSignalR } from "./useSignalR";
import { resolveClientId, resolveRoomId } from "./room";
import { characterColor } from "./colors";
import { loadRoomPosition, pruneStaleRooms, saveRoomPosition } from "./roomStorage";
import { PROTOCOL_VERSION, parseRoomMessage } from "./network";
import type { Position, RoomMessageKind } from "./network";

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

type Peer = {
  position: Position;
  lastSeen: number;
};

export default function App() {
  const roomId = useMemo(resolveRoomId, []);
  const myId = useMemo(() => resolveClientId(roomId), [roomId]);
  const myColor = useMemo(() => characterColor(myId), [myId]);

  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [characterPosition, setCharacterPosition] = useState<Position>(SPAWN_POSITION);
  const [obstacles, setObstacles] = useState<THREE.Mesh[]>([]);
  // True once IndexedDB has been checked, so the join poll and our character
  // use the restored position instead of the default spawn one.
  const [positionReady, setPositionReady] = useState(false);

  // Mirrors of the state that message handlers need without re-subscribing.
  const peersRef = useRef<Record<string, Peer>>({});
  const characterPositionRef = useRef<Position>(SPAWN_POSITION);

  const { connection, isConnected } = useSignalR();

  const upsertPeer = useCallback((id: string, position: Position) => {
    const next = { ...peersRef.current, [id]: { position, lastSeen: Date.now() } };
    peersRef.current = next;
    setPeers(next);
  }, []);

  const send = useCallback(
    async (kind: RoomMessageKind, position: Position) => {
      if (!connection || connection.state !== signalR.HubConnectionState.Connected) return;
      try {
        const payload = JSON.stringify({ v: PROTOCOL_VERSION, room: roomId, kind, position });
        await connection.invoke('SendMessage', myId, payload);
      } catch (e) {
        console.error(e);
      }
    },
    [connection, myId, roomId]
  );

  const setCharacterPositionAndSend = useCallback(
    (position: Position) => {
      characterPositionRef.current = position;
      setCharacterPosition(position);
      void saveRoomPosition(roomId, position);
      void send('position', position);
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

      upsertPeer(user, message.position);

      // Somebody just entered our room: answer with our own location.
      if (message.kind === 'hello') {
        void send('presence', characterPositionRef.current);
      }
    },
    [myId, roomId, send, upsertPeer]
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

    const poll = () => {
      if (cancelled) return;
      void send('hello', characterPositionRef.current);
      attempt += 1;

      const alone = Object.keys(peersRef.current).length === 0;
      if (alone && attempt < PRESENCE_MAX_ATTEMPTS) {
        timer = window.setTimeout(poll, PRESENCE_RETRY_MS);
      }
    };

    poll();

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
      void send('hello', characterPositionRef.current);
    }, PRESENCE_POLL_MS);

    const prune = window.setInterval(() => {
      const now = Date.now();
      const alive = Object.entries(peersRef.current).filter(
        ([, peer]) => now - peer.lastSeen <= PEER_TTL_MS
      );

      if (alive.length === Object.keys(peersRef.current).length) return;

      const next = Object.fromEntries(alive);
      peersRef.current = next;
      setPeers(next);
    }, PEER_TTL_MS / 2);

    return () => {
      window.clearInterval(poll);
      window.clearInterval(prune);
    };
  }, [connection, isConnected, send]);

  return (
    <Canvas
      shadows
      gl={{ antialias: false }}
      camera={{ position: [16.6, 15.5, 15.1], fov: 50, near: 0.1, far: 100 }}
    >
      <hemisphereLight intensity={1} color="#0e084d" groundColor="#301d1b" />
      <directionalLight
        castShadow
        color="#cfa315"
        intensity={5}
        position={[10, 10, 10]}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0001}
        shadow-camera-near={1}
        shadow-camera-far={50}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
      <Lamp position={[3, 5.0497, 0.7]} />
      <Lamp position={[-2.35, 5.0497, 0.7]} />
      <ambientLight intensity={0.2} />
      <SceneV2 setCharacterPosition={setCharacterPositionAndSend} setObstacles={setObstacles} />
      {positionReady && (
        <Character position={characterPosition} obstacles={obstacles} color={myColor} />
      )}
      {Object.entries(peers).map(([id, peer]) => (
        <Character
          position={peer.position}
          key={id}
          obstacles={obstacles}
          color={characterColor(id)}
        />
      ))}
      <OrbitControls target={[2.7, 1.6, 1.3]} enableZoom={true} />
    </Canvas>
  );
}
