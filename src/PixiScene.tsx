import { useEffect, useRef, useState } from "react";
import type { Position } from "./network";
import { BarScene, SELF_ID } from "./pixi/scene";

type PixiSceneProps = {
  myId: string;
  selfPosition: Position;
  selfColor: string;
  peers: Record<string, Position>;
  positionReady: boolean;
  onMove: (id: string, position: Position) => void;
  onGroundClick: (position: Position) => void;
};

export default function PixiScene({
  myId,
  selfPosition,
  selfColor,
  peers,
  positionReady,
  onMove,
  onGroundClick,
}: PixiSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BarScene | null>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef({ myId, onMove, onGroundClick });
  latest.current = { myId, onMove, onGroundClick };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new BarScene(mount, {
      onMove: (id, position) =>
        latest.current.onMove(id === SELF_ID ? latest.current.myId : id, position),
      onGroundClick: position => latest.current.onGroundClick(position),
      onReady: () => setReady(true),
    });
    sceneRef.current = scene;

    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setState(
      positionReady ? { position: selfPosition, color: selfColor } : null,
      peers
    );
  }, [positionReady, selfPosition, selfColor, peers]);

  return (
    <div className="pixi-scene" ref={mountRef}>
      {!ready && <div className="scene-loading">Загрузка сцены…</div>}
    </div>
  );
}
