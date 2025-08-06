import { Vector3 } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

type LampProps = {
  position: Vector3;
};
const Lamp = (props: LampProps) => {
  const spotLightRef = useRef<THREE.SpotLight>(null);
  const { position } = props;

  return (
    <>
      <spotLight
        ref={spotLightRef}
        position={position}
        angle={Math.PI / 4}
        penumbra={0.2}
        color="#f2f200"
        intensity={5.2}
        distance={15}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />

      <primitive
        object={spotLightRef.current?.target || new THREE.Object3D()}
      // @ts-ignore
        position={[position[0], 0, position[2]]}
      />
    </>
  );
};

export default Lamp;
