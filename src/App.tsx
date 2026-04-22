import { useState, useEffect, useCallback } from "react";
import "./styles.css";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import SceneV2 from "./SceneV2";
import Character from "./Character";
import Lamp from "./Lamp";
import * as signalR from '@microsoft/signalr';
import * as THREE from "three";
import { useSignalR } from "./useSignalR";

const myId = String(Math.floor(Math.random() * 100000));

export default function App() {
  const [characters, setCharacters] = useState<{ position: [number, number, number]; id: string }[]>([]);
  const [characterPosition, setCharacterPosition] = useState<[number, number, number]>([0.7, 1.8 * 1.5, 0.4]);
  const [obstacles, setObstacles] = useState<THREE.Mesh[]>([]);

  const connection = useSignalR();

  const setCharacterPositionAndSend = async (position: [number, number, number]) => {
    setCharacterPosition(position);
    if (connection && connection.state === signalR.HubConnectionState.Connected) {
      try {
        await connection.invoke('SendMessage', myId, JSON.stringify(position));
      } catch (e) {
        console.error(e);
      }
    }
  };

  const onMessageReceive = useCallback((user: string, message: string) => {
    if (user === myId) return;
    setCharacters(prev =>
      prev.some(item => item.id === user)
        ? prev.map(item => item.id === user ? { ...item, position: JSON.parse(message) } : item)
        : [...prev, { id: user, position: JSON.parse(message) }]
    );
  }, []);

  useEffect(() => {
    if (!connection) return;
    connection.on('ReceiveMessage', onMessageReceive);
    return () => connection.off('ReceiveMessage', onMessageReceive);
  }, [connection, onMessageReceive]);

  return (
    <Canvas shadows gl={{ antialias: false }}>
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
      <Character position={characterPosition} obstacles={obstacles} />
      {characters.map(item => (
        <Character position={item.position} key={item.id} obstacles={obstacles} />
      ))}
      <OrbitControls enableZoom={true} />
    </Canvas>
  );
}
