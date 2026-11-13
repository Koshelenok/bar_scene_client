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
import { createUuid, resolveRoomId } from "./room";
import { characterColor } from "./colors";
import { PROTOCOL_VERSION, parseRoomMessage } from "./network";
import type { Position, RoomMessageKind } from "./network";

const SPAWN_POSITION: Position = [0.7, 1.8 * 1.5, 0.4];

// How often we re-broadcast our position so peers can keep us "alive".
const POSITION_HEARTBEAT_MS = 10_000;
// A peer we have not heard from for this long is considered gone.
const PEER_TTL_MS = 30_000;
// Joining clients poll the room for peers, retrying in case somebody was
// reconnecting when the first poll went out.
const PRESENCE_RETRY_MS = 2_000;
const PRESENCE_MAX_ATTEMPTS = 3;

type Peer = {
  position: Position;
  lastSeen: number;
};

export default function App() {
  const roomId = useMemo(resolveRoomId, []);
  const myId = useMemo(createUuid, []);
  const myColor = useMemo(() => characterColor(myId), [myId]);

  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [characterPosition, setCharacterPosition] = useState<Position>(SPAWN_POSITION);
  const [obstacles, setObstacles] = useState<THREE.Mesh[]>([]);
  const [linkCopied, setLinkCopied] = useState(false);

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
      void send('position', position);
    },
    [send]
  );

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
    if (!connection || !isConnected) return;

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
  }, [connection, isConnected, send]);

  // Keep our position fresh for other clients and drop peers that went silent.
  useEffect(() => {
    if (!connection || !isConnected) return;

    const heartbeat = window.setInterval(() => {
      void send('position', characterPositionRef.current);
    }, POSITION_HEARTBEAT_MS);

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
      window.clearInterval(heartbeat);
      window.clearInterval(prune);
    };
  }, [connection, isConnected, send]);

  const copyRoomLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2_000);
    } catch (e) {
      console.error(e);
    }
  }, []);

  return (
    <>
      <div className="hud">
        <span className={`hud__status ${isConnected ? 'hud__status--online' : ''}`}>
          {isConnected ? 'online' : 'offline'}
        </span>
        <span className="hud__label">room</span>
        <code className="hud__room">{roomId}</code>
        <span className="hud__players">{Object.keys(peers).length + 1} in room</span>
        <button className="hud__button" onClick={copyRoomLink}>
          {linkCopied ? 'copied' : 'copy link'}
        </button>
      </div>

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
        <Character position={characterPosition} obstacles={obstacles} color={myColor} />
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
    </>
  );
}
