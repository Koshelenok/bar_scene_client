import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { Vector3 } from "@react-three/fiber";

const SceneV2 = ({ ...props }) => {
  const wallRef = useRef<THREE.Mesh>(null);
  const { setChatacterPosition, setObstacles } = props;
  // @ts-ignore
  const { nodes, materials } = useGLTF("/scene_to_glb_16.glb");

  useEffect(() => {
    console.log("Scene nodes =", nodes);
  }, []);

  // @ts-ignore
  const handleGroundClick = (event) => {
    event.stopPropagation();
    const worldPoint = event.point;
    console.log({ x: worldPoint.x, z: worldPoint.z });
    setChatacterPosition([worldPoint.x, (1.8 * 1.5) / 2, worldPoint.z]);
  };

  useEffect(() => {
    if (wallRef.current) {
      setObstacles([wallRef.current]);
    }
  }, []);
  // return null;
  return (
    <group {...props} dispose={null}>
      <mesh
        ref={wallRef}
        geometry={nodes.collision.geometry}
        position={[0, 0, 0]}
      >
        <meshStandardMaterial transparent opacity={0} />
      </mesh>
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.furniture.geometry}
        position={[0, 0, 0]}
      >
        <meshStandardMaterial color="#134513" />
      </mesh>
      <mesh receiveShadow geometry={nodes.lamps.geometry} position={[0, 0, 0]}>
        <meshStandardMaterial color="#1307b8" />
      </mesh>
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.wall.geometry}
        position={[0, 0, 0]}
      >
        <meshStandardMaterial color="#451313" />
      </mesh>
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.floor.geometry}
        position={[0, 0, 0]}
        onClick={handleGroundClick}
      >
        <meshStandardMaterial color="#131345" />
      </mesh>
    </group>
  );
};

export default SceneV2;
