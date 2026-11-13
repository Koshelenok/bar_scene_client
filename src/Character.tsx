import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const SPEED = 5;
const AVOIDANCE_DISTANCE = 1.5;

type CharacterProps = {
  position: [number, number, number];
  obstacles: THREE.Mesh[];
  color?: string;
  onMove?: (position: [number, number, number]) => void;
};

const REPORT_INTERVAL = 0.1;

const Character = ({ position, obstacles, color = "#f3f302", onMove }: CharacterProps) => {
  const meshRef = useRef<THREE.Mesh>(null);
  // Start where the character actually is, not at a shared spawn point,
  // otherwise a joining client sees every peer walk in from the same spot.
  const initialPosition = useRef<[number, number, number]>(position);
  const reportAccumulator = useRef(0);

  const targetVec = useRef(new THREE.Vector3());
  const direction = useRef(new THREE.Vector3());
  const dir1 = useRef(new THREE.Vector3());
  const dir2 = useRef(new THREE.Vector3());
  const axisY = useRef(new THREE.Vector3(0, 1, 0));
  const rc0 = useRef(new THREE.Raycaster());
  const rc1 = useRef(new THREE.Raycaster());
  const rc2 = useRef(new THREE.Raycaster());

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    const char = meshRef.current;
    const currentPos = char.position;

    // Live position for distance-based voice volume, throttled a bit.
    reportAccumulator.current += delta;
    if (reportAccumulator.current >= REPORT_INTERVAL) {
      reportAccumulator.current = 0;
      onMove?.([currentPos.x, currentPos.y, currentPos.z]);
    }

    targetVec.current.set(position[0], position[1], position[2]);
    const distance = currentPos.distanceTo(targetVec.current);

    if (distance < 0.05) {
      currentPos.copy(targetVec.current);
      return;
    }

    direction.current.subVectors(targetVec.current, currentPos).normalize();
    dir1.current.copy(direction.current).applyAxisAngle(axisY.current, Math.PI / 5);
    dir2.current.copy(direction.current).applyAxisAngle(axisY.current, -Math.PI / 5);

    rc0.current.set(currentPos, direction.current);
    rc0.current.far = AVOIDANCE_DISTANCE;
    rc1.current.set(currentPos, dir1.current);
    rc1.current.far = AVOIDANCE_DISTANCE;
    rc2.current.set(currentPos, dir2.current);
    rc2.current.far = AVOIDANCE_DISTANCE;

    const blocked0 = rc0.current.intersectObjects(obstacles).length > 0;
    const blocked1 = rc1.current.intersectObjects(obstacles).length > 0;
    const blocked2 = rc2.current.intersectObjects(obstacles).length > 0;

    let chosenDir = direction.current;
    if (blocked0) {
      if (!blocked2) chosenDir = dir2.current;
      else if (!blocked1) chosenDir = dir1.current;
      else return;
    }

    char.position.addScaledVector(chosenDir, Math.min(SPEED * delta, distance));
    char.rotation.y = Math.atan2(chosenDir.x, chosenDir.z);
  });

  return (
    <mesh castShadow receiveShadow ref={meshRef} position={initialPosition.current}>
      <boxGeometry args={[0.7 * 1.5, 1.8 * 1.5, 0.4 * 1.5]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

export default Character;
