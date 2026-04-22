import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { ThreeEvent } from "@react-three/fiber";

type GLTFResult = {
  nodes: {
    collision: THREE.Mesh;
    furniture: THREE.Mesh;
    lamps: THREE.Mesh;
    wall: THREE.Mesh;
    floor: THREE.Mesh;
  };
};

type SceneV2Props = {
  setCharacterPosition: (position: [number, number, number]) => void;
  setObstacles: (meshes: THREE.Mesh[]) => void;
};

const CHARACTER_Y = (1.8 * 1.5) / 2;

const SceneV2 = ({ setCharacterPosition, setObstacles }: SceneV2Props) => {
  const wallRef = useRef<THREE.Mesh>(null);
  const { nodes } = useGLTF("/scene_to_glb_16.glb") as unknown as GLTFResult;

  useEffect(() => {
    if (wallRef.current) {
      setObstacles([wallRef.current]);
    }
  }, []);

  const handleGroundClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const { x, z } = event.point;
    setCharacterPosition([x, CHARACTER_Y, z]);
  };

  return (
    <group dispose={null}>
      <mesh ref={wallRef} geometry={nodes.collision.geometry}>
        <meshStandardMaterial transparent opacity={0} />
      </mesh>
      <mesh castShadow receiveShadow geometry={nodes.furniture.geometry}>
        <meshStandardMaterial color="#134513" />
      </mesh>
      <mesh receiveShadow geometry={nodes.lamps.geometry}>
        <meshStandardMaterial color="#1307b8" />
      </mesh>
      <mesh castShadow receiveShadow geometry={nodes.wall.geometry}>
        <meshStandardMaterial color="#451313" />
      </mesh>
      <mesh castShadow receiveShadow geometry={nodes.floor.geometry} onClick={handleGroundClick}>
        <meshStandardMaterial color="#131345" />
      </mesh>
    </group>
  );
};

export default SceneV2;
