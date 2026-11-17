import { Color, Mesh3D, StandardMaterial } from "pixi3d/pixi7";
import type { Position } from "../network";
import { rayHitsTriangles } from "./collision";
import type { Triangle, Vec3Data } from "./collision";

const SPEED = 5;
const AVOIDANCE_DISTANCE = 1.5;
const REPORT_INTERVAL = 0.1;
const DEG_TO_RAD = Math.PI / 180;

type SceneCharacterOptions = {
  position: Position;
  color: string;
  getTriangles: () => Triangle[];
  onMove: (position: Position) => void;
};

/** A walking box, equivalent to the old R3F Character with raycast avoidance. */
export class SceneCharacter {
  readonly mesh: Mesh3D;

  private target: Position;
  private readonly getTriangles: () => Triangle[];
  private readonly onMove: (position: Position) => void;
  private reportTimer = 0;

  private readonly direction: Vec3Data = { x: 0, y: 0, z: 0 };
  private readonly left: Vec3Data = { x: 0, y: 0, z: 0 };
  private readonly right: Vec3Data = { x: 0, y: 0, z: 0 };

  constructor({ position, color, getTriangles, onMove }: SceneCharacterOptions) {
    this.target = position;
    this.getTriangles = getTriangles;
    this.onMove = onMove;

    const base = Color.fromHex(color);
    const material = new StandardMaterial();
    material.baseColor = base;
    material.emissive = new Color(base.r * 0.35, base.g * 0.35, base.b * 0.35);
    material.metallic = 0;
    material.roughness = 1;

    this.mesh = Mesh3D.createCube(material);
    // Pixi3D's cube spans -1..1 on each axis, hence the half-size scales.
    this.mesh.scale.set((0.7 * 1.5) / 2, (1.8 * 1.5) / 2, (0.4 * 1.5) / 2);
    this.mesh.position.set(position[0], position[1], position[2]);
  }

  setTarget(position: Position) {
    this.target = position;
  }

  private rotateAroundY(source: Vec3Data, angle: number, out: Vec3Data): Vec3Data {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    out.x = source.x * cosine + source.z * sine;
    out.y = source.y;
    out.z = -source.x * sine + source.z * cosine;
    return out;
  }

  update(delta: number) {
    const position = this.mesh.position;

    this.reportTimer += delta;
    if (this.reportTimer >= REPORT_INTERVAL) {
      this.reportTimer = 0;
      this.onMove([position.x, position.y, position.z]);
    }

    const dx = this.target[0] - position.x;
    const dy = this.target[1] - position.y;
    const dz = this.target[2] - position.z;
    const distance = Math.hypot(dx, dy, dz);

    if (distance < 0.05) {
      position.set(this.target[0], this.target[1], this.target[2]);
      return;
    }

    this.direction.x = dx / distance;
    this.direction.y = dy / distance;
    this.direction.z = dz / distance;
    this.rotateAroundY(this.direction, Math.PI / 5, this.left);
    this.rotateAroundY(this.direction, -Math.PI / 5, this.right);

    const triangles = this.getTriangles();
    const origin = { x: position.x, y: position.y, z: position.z };
    const blocked = rayHitsTriangles(origin, this.direction, AVOIDANCE_DISTANCE, triangles);
    const blockedLeft = rayHitsTriangles(origin, this.left, AVOIDANCE_DISTANCE, triangles);
    const blockedRight = rayHitsTriangles(origin, this.right, AVOIDANCE_DISTANCE, triangles);

    let chosen = this.direction;
    if (blocked) {
      if (!blockedRight) chosen = this.right;
      else if (!blockedLeft) chosen = this.left;
      else return;
    }

    const step = Math.min(SPEED * delta, distance);
    position.set(
      position.x + chosen.x * step,
      position.y + chosen.y * step,
      position.z + chosen.z * step
    );
    this.mesh.rotationQuaternion.setEulerAngles(
      0,
      Math.atan2(chosen.x, chosen.z) / DEG_TO_RAD,
      0
    );
  }
}
