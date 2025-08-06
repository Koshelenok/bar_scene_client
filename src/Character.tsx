import { useEffect, useRef, useState } from "react";
import { useFrame, Vector3 } from "@react-three/fiber";
import * as THREE from "three";

const Character = (props: { position: Vector3; obstacles: THREE.Mesh[] }) => {
  const { position, obstacles } = props;

  // @ts-ignore
  const meshRef = useRef<IntrinsicElements.mesh>();

  // @ts-ignore
  const targetPosition = new THREE.Vector3(...position);

  const [currentPosision, setCurrentPosision] = useState<Vector3>([
    -1,
    (1.8 * 1.5) / 2,
    4,
  ]);

  useEffect(() => {}, []);

  useFrame((state, delta) => {
    if (meshRef.current) {
      // OPTION 1
      // let { x: cX, y: cY, z: cZ } = meshRef.current.position;
      // const [nX, nY, nZ] = position.map((item) => {
      //   return Math.floor(item.toFixed(1));
      // });
      // if (nX !== Math.floor(cX.toFixed(1))) {
      //   meshRef.current.position.x += nX > cX ? 0.1 : -0.1;
      // }
      // if (nZ !== Math.floor(cZ.toFixed(1))) {
      //   meshRef.current.position.z += nZ > cZ ? 0.1 : -0.1;
      // }

      // OPTION 2
      // const speed = 5;
      // const currentPosition = meshRef.current.position;
      // const targetVec = new THREE.Vector3(...targetPosition);
      // const distance = currentPosition.distanceTo(targetVec);
      // if (distance < 0.05) {
      //   currentPosition.copy(targetVec);
      //   return;
      // }
      // const direction = new THREE.Vector3()
      // .subVectors(targetVec, currentPosition)
      // .normalize();
      // const moveDistance = Math.min(speed * delta, distance);
      // if (moveDistance > 0.001) {
      //   const angle = Math.atan2(direction.x, direction.z);
      //   meshRef.current.rotation.y = angle;
      // }
      // currentPosition.add(direction.multiplyScalar(moveDistance));

      // OPTION 3
      // meshRef.current.position.lerp(targetPosition, 0.1);

      // OPTION 4
      // const speed = 5;
      // const avoidanceDistance = 3.5;
      // const char = meshRef.current;
      // const targetVec = new THREE.Vector3(...position);
      // const direction = new THREE.Vector3()
      //   .subVectors(targetVec, char.position)
      //   .normalize();

      // const raycaster = new THREE.Raycaster(
      //   char.position,
      //   direction,
      //   0,
      //   avoidanceDistance
      // );
      // const intersects = raycaster.intersectObjects(obstacles);
      // if (intersects.length > 0) {
      //   const avoidDirection = new THREE.Vector3()
      //     .crossVectors(direction, new THREE.Vector3(0, 1, 0))
      //     .normalize();

      //   char.position.add(avoidDirection.multiplyScalar(speed * delta * 0.5));
      // } else {
      //   const distance = char.position.distanceTo(targetVec);
      //   if (distance > 0.05) {
      //     const moveVec = direction.clone().multiplyScalar(Math.min(speed * delta, distance));
      //     char.position.add(moveVec);

      //     const angle = Math.atan2(moveVec.x, moveVec.z);
      //     char.rotation.y = angle;
      //   }
      // }

      // OPTION 5
      const char = meshRef.current;
      const currentPos = char.position;
      // @ts-ignore
      const targetVec = new THREE.Vector3(...position);
      const speed = 5;
      const direction = new THREE.Vector3()
        .subVectors(targetVec, currentPos)
        .normalize();
      const distance = currentPos.distanceTo(targetVec);

      if (distance < 0.05) {
        currentPos.copy(targetVec);
        return;
      }

      const avoidanceDistance = 1.5;

      const directions = [
        direction.clone(),
        direction
          .clone()
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 5),
        direction
          .clone()
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 5),
      ];

      const raycasters = directions.map((dir) => {
        return new THREE.Raycaster(currentPos, dir, 0, avoidanceDistance);
      });

      const hasObstacle = raycasters.map(
        (rc) => rc.intersectObjects(obstacles).length > 0
      );
      let chosenDir = direction;

      if (hasObstacle[0]) {
        if (!hasObstacle[2]) {
          chosenDir = directions[2];
        } else if (!hasObstacle[1]) {
          chosenDir = directions[1];
        } else {
          return;
        }
      }

      const moveVec = chosenDir.multiplyScalar(
        Math.min(speed * delta, distance)
      );
      char.position.add(moveVec);

      const angle = Math.atan2(chosenDir.x, chosenDir.z);
      char.rotation.y = angle;
    }
  });

  return (
    <mesh castShadow receiveShadow ref={meshRef} position={currentPosision}>
      <boxGeometry args={[0.7 * 1.5, 1.8 * 1.5, 0.4 * 1.5]} />
      <meshStandardMaterial color="#f3f302" />
    </mesh>
  );
};

export default Character;
