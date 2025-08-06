import { useRef, useState, useEffect, useCallback } from "react";
import "./styles.css";
import { Canvas, Vector3 } from "@react-three/fiber";
import { OrbitControls, Fisheye } from "@react-three/drei";
import SceneV2 from "./SceneV2";
import Character from "./Character";
import Lamp from "./Lamp";
import * as signalR from '@microsoft/signalr';
import * as THREE from "three";
import Chat from "./Chat";

const myId = String(Math.floor(Math.random() * 100000));

export default function App() {
  const [characters, setCharacters] = useState<{position: Vector3, id: string}[]>([]);
  const [,forceUpdate] = useState<number>(0);

  const [connection, setConnection] = useState(null);
  const [chatacterPosition, setChatacterPosition] = useState<Vector3>([
    0.7,
    1.8 * 1.5,
    0.4,
  ]);
  
  const setChatacterPositionAndSend = async (vector: Vector3) => {
    setChatacterPosition(vector);
    // @ts-ignore
    if (connection?.state === signalR.HubConnectionState.Connected) {
      // @ts-ignore
      try {
        
        // @ts-ignore
        await connection.invoke('SendMessage', myId, JSON.stringify(vector));
      } catch (e) {
        console.error(e);
      }
    }
  };
  const [obstacles, setObstacles] = useState<THREE.Mesh[]>([]);

  const directionaLightRef = useRef<THREE.DirectionalLight>(null);

    // @ts-ignore
    const onMessageReceive =  useCallback((user, message) => {
      // @ts-ignore
      if (user !== myId) {
        console.log('ReceiveMessage', {user, message});
        setCharacters((prev) => {
          const find = prev.find(item => item.id === user);
          if (find) {
            find.position = JSON.parse(message) as Vector3;
          } else {
            prev.push({id: user, position: JSON.parse(message) as Vector3});
          }
          return prev;
        })
        forceUpdate(prev => ++prev)
      }

    }, [characters]);
  
    // Подключение к серверу
    useEffect(() => {
      const newConnection = new signalR.HubConnectionBuilder()
        .withUrl('ws://localhost:5201/chatHub', { 
          skipNegotiation: true,
          transport: signalR.HttpTransportType.WebSockets
        })
        .withAutomaticReconnect()
        .build();
      // @ts-ignore
      setConnection(newConnection);
    }, []);
  
    useEffect(() => {
      if (connection) {
        // @ts-ignore
        connection.start()
          .then(() => {
            console.log('Connected!');
            
            // @ts-ignore
            connection.on('ReceiveMessage', onMessageReceive);
          })
          // @ts-ignore
          .catch(e => console.log('Connection failed: ', e));
      }
    }, [connection]);
    
  // return <div>
  //   <Chat /> 
  // </div>;
  return (
    <Canvas shadows gl={{ antialias: false }}>
      <hemisphereLight intensity={1} color="#0e084d" groundColor="#301d1b" />
      <directionalLight
        ref={directionaLightRef}
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
      <primitive
        object={directionaLightRef.current?.target || new THREE.Object3D()}
        position={[0, 0, 0]}
      />
      <Lamp position={[3, 5.0497, 0.7]} />
      <Lamp position={[-2.35, 5.0497, 0.7]} />

      <ambientLight intensity={0.2} />
      {/* <Scene
        setChatacterPosition={setChatacterPosition}
        setObstacles={setObstacles}
      /> */}
      <SceneV2
        setChatacterPosition={setChatacterPositionAndSend}
        setObstacles={setObstacles}
      />
      <Character position={chatacterPosition} obstacles={obstacles} />
      {
        characters.map(item => <Character position={item.position} key={item.id}  obstacles={obstacles} />)
      }
      <OrbitControls enableZoom={true} />
    </Canvas>
  );
}
