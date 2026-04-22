import { useRef } from "react";
import * as THREE from "three";

type LampProps = {
  position: [number, number, number];
};

const Lamp = ({ position }: LampProps) => {
  const targetRef = useRef(new THREE.Object3D());

  return (
    <>
      <spotLight
        position={position}
        angle={Math.PI / 4}
        penumbra={0.2}
        color="#f2f200"
        intensity={5.2}
        distance={15}
        castShadow
        shadow-mapSize={[2048, 2048]}
        target={targetRef.current}
      />
      <primitive object={targetRef.current} position={[position[0], 0, position[2]]} />
    </>
  );
};

export default Lamp;
