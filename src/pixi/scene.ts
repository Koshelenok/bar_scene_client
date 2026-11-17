import { Application } from "pixi.js";
import type { DisplayObject, Renderer } from "pixi.js";
import {
  Camera,
  CameraOrbitControl,
  Color,
  glTFAsset,
  Light,
  LightType,
  LightingEnvironment,
  Mesh3D,
  Model,
  Point3D,
  ShadowCastingLight,
  ShadowQuality,
  StandardMaterial,
  StandardPipeline,
} from "pixi3d/pixi7";
import { characterColor } from "../colors";
import type { Position } from "../network";
import { SceneCharacter } from "./character";
import { createCollisionTriangles } from "./collision";
import type { Triangle } from "./collision";

const MODEL_URL = "/scene_to_glb_16.glb";
export const SELF_ID = "__self__";
const CHARACTER_Y = (1.8 * 1.5) / 2;

const CAMERA_POSITION: Position = [16.6, 15.5, 15.1];
const CAMERA_TARGET: Position = [2.7, 1.6, 1.3];

const SURFACE_COLORS: Record<string, string> = {
  furniture: "#134513",
  lamps: "#1307b8",
  wall: "#451313",
  floor: "#131345",
};

type CharacterState = { position: Position; color: string };

export type BarSceneCallbacks = {
  onMove: (id: string, position: Position) => void;
  onGroundClick: (position: Position) => void;
  onReady?: () => void;
};

function createMaterial(hex: string, emissiveScale = 0.2): StandardMaterial {
  const material = new StandardMaterial();
  const base = Color.fromHex(hex);
  material.baseColor = base;
  material.emissive = new Color(
    base.r * emissiveScale,
    base.g * emissiveScale,
    base.b * emissiveScale
  );
  material.metallic = 0;
  material.roughness = 1;
  return material;
}

function findMesh(model: Model, name: string): Mesh3D | undefined {
  return model.meshes.find(mesh => mesh.parent?.name === name);
}

/** Imperative PixiJS + Pixi3D scene, driven by React only through state updates. */
export class BarScene {
  private readonly app: Application;
  private readonly camera: Camera;
  private readonly orbit: CameraOrbitControl;
  private readonly pipeline: StandardPipeline;
  private readonly characters = new Map<string, SceneCharacter>();

  private self: CharacterState | null = null;
  private peers: Record<string, Position> = {};
  private triangles: Triangle[] = [];
  private shadow: ShadowCastingLight | undefined;
  private destroyed = false;
  private pointerDown: { x: number; y: number } | null = null;

  // Pixi3D's types predate PixiJS 7's IRenderer union, but the WebGL renderer
  // it receives at runtime is the concrete Renderer it expects.
  private get renderer(): Renderer {
    return this.app.renderer as unknown as Renderer;
  }

  constructor(private readonly container: HTMLElement, private readonly callbacks: BarSceneCallbacks) {
    this.app = new Application({
      resizeTo: window,
      backgroundColor: 0x202030,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    container.appendChild(this.app.view as HTMLCanvasElement);

    // A fresh camera per scene keeps React StrictMode's mount/unmount/mount
    // cycle from reusing a camera whose renderer has already been destroyed.
    this.camera = new Camera(this.renderer);
    Camera.main = this.camera;
    this.camera.fieldOfView = 50;
    this.camera.near = 0.1;
    this.camera.far = 100;
    this.pipeline = this.app.renderer.plugins.pipeline as unknown as StandardPipeline;

    this.orbit = new CameraOrbitControl(this.app.view as HTMLCanvasElement, this.camera);
    this.orbit.target = {
      x: CAMERA_TARGET[0],
      y: CAMERA_TARGET[1],
      z: CAMERA_TARGET[2],
    };
    // CameraOrbitControl orbits with elevation/azimuth angles (in degrees).
    // Its offset from the target is (-cos(e)*sin(a), sin(e), -cos(e)*cos(a)).
    const offsetX = CAMERA_POSITION[0] - CAMERA_TARGET[0];
    const offsetY = CAMERA_POSITION[1] - CAMERA_TARGET[1];
    const offsetZ = CAMERA_POSITION[2] - CAMERA_TARGET[2];
    const distance = Math.hypot(offsetX, offsetY, offsetZ);
    const elevation = Math.asin(offsetY / distance) * (180 / Math.PI);
    const azimuth = Math.atan2(-offsetX, -offsetZ) * (180 / Math.PI);
    this.orbit.distance = distance;
    this.orbit.angles.set(elevation, azimuth);
    this.orbit.updateCamera();

    this.setupLights();
    this.app.ticker.add(this.tick);
    void this.loadScene();
  }

  private setupLights() {
    const environment = LightingEnvironment.main;

    const sky = new Light();
    sky.type = LightType.directional;
    sky.color = Color.fromHex("#0e084d");
    sky.intensity = 1.3;
    sky.rotationQuaternion.setEulerAngles(90, 0, 0);

    const ground = new Light();
    ground.type = LightType.directional;
    ground.color = Color.fromHex("#301d1b");
    ground.intensity = 0.9;
    ground.rotationQuaternion.setEulerAngles(-90, 0, 0);

    const fill = new Light();
    fill.type = LightType.directional;
    fill.color = Color.fromHex("#ffffff");
    fill.intensity = 0.2;
    fill.rotationQuaternion.setEulerAngles(45, 30, 0);

    const sun = new Light();
    sun.type = LightType.directional;
    sun.color = Color.fromHex("#cfa315");
    sun.intensity = 5;
    sun.position.set(10, 10, 10);
    sun.transform.updateTransform();
    sun.transform.lookAt(new Point3D(0, 0, 0));

    const lamps = [
      { position: [3, 5.0497, 0.7], target: [3, 0, 0.7] },
      { position: [-2.35, 5.0497, 0.7], target: [-2.35, 0, 0.7] },
    ].map(({ position, target }) => {
      const lamp = new Light();
      lamp.type = LightType.spot;
      lamp.color = Color.fromHex("#f2f200");
      lamp.intensity = 5.2;
      lamp.range = 15;
      lamp.outerConeAngle = 45;
      // Three.js penumbra 0.2 -> inner cone roughly 80% of the outer one.
      lamp.innerConeAngle = 36;
      lamp.position.set(position[0], position[1], position[2]);
      lamp.transform.updateTransform();
      lamp.transform.lookAt(new Point3D(target[0], target[1], target[2]));
      return lamp;
    });

    environment.lights.push(sky, ground, fill, sun, ...lamps);

    this.shadow = new ShadowCastingLight(this.renderer, sun, {
      shadowTextureSize: 1024,
      quality: ShadowQuality.medium,
    });
    this.shadow.shadowArea = 20;
    this.shadow.softness = 1;
  }

  private async loadScene() {
    const asset = await glTFAsset.fromURL(MODEL_URL);
    if (this.destroyed) return;

    const model = Model.from(asset);
    this.app.stage.addChild(model as unknown as DisplayObject);
    // Bake collision triangles from up-to-date world transforms, not local ones.
    model.updateTransform();

    for (const [name, color] of Object.entries(SURFACE_COLORS)) {
      const mesh = findMesh(model, name);
      if (!mesh) continue;
      mesh.material = createMaterial(color);
      this.pipeline.enableShadows(mesh, this.shadow);
    }

    const collision = findMesh(model, "collision");
    if (collision) {
      collision.renderable = false;
      this.triangles = createCollisionTriangles(collision);
    }

    this.enableGroundClick();

    this.syncCharacters();
    this.callbacks.onReady?.();
  }

  private enableGroundClick() {
    const canvas = this.app.view as HTMLCanvasElement;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
  }

  private toCanvasPoint(event: PointerEvent) {
    const rect = (this.app.view as HTMLCanvasElement).getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.pointerDown = this.toCanvasPoint(event);
  };

  private onPointerUp = (event: PointerEvent) => {
    if (event.button !== 0 || !this.pointerDown) return;

    const point = this.toCanvasPoint(event);
    const moved = Math.hypot(point.x - this.pointerDown.x, point.y - this.pointerDown.y);
    this.pointerDown = null;
    // A camera drag ends with a pointerup too; only treat a real click as a move.
    if (moved > 5) return;

    const ray = this.camera.screenToRay(point.x, point.y);
    if (!ray || Math.abs(ray.direction.y) < 0.01) return;
    const distance = -ray.origin.y / ray.direction.y;
    if (distance <= 0) return;

    this.callbacks.onGroundClick([
      ray.origin.x + ray.direction.x * distance,
      CHARACTER_Y,
      ray.origin.z + ray.direction.z * distance,
    ]);
  };

  private onPointerCancel = () => {
    this.pointerDown = null;
  };

  /** Called by React whenever the target positions or colors change. */
  setState(self: CharacterState | null, peers: Record<string, Position>) {
    this.self = self;
    this.peers = peers;
    this.syncCharacters();
  }

  private syncCharacters() {
    const active = new Set<string>();

    if (this.self) {
      active.add(SELF_ID);
      this.ensureCharacter(SELF_ID, this.self.position, this.self.color);
    }
    for (const [id, position] of Object.entries(this.peers)) {
      active.add(id);
      this.ensureCharacter(id, position, characterColor(id));
    }

    for (const [id, character] of this.characters) {
      if (active.has(id)) continue;
      this.pipeline.disableShadows(character.mesh);
      this.app.stage.removeChild(character.mesh as unknown as DisplayObject);
      character.mesh.destroy(true);
      this.characters.delete(id);
    }
  }

  private ensureCharacter(id: string, position: Position, color: string) {
    const existing = this.characters.get(id);
    if (existing) {
      existing.setTarget(position);
      return;
    }

    const character = new SceneCharacter({
      position,
      color,
      getTriangles: () => this.triangles,
      onMove: moved => this.callbacks.onMove(id, moved),
    });
    this.characters.set(id, character);
    this.app.stage.addChild(character.mesh as unknown as DisplayObject);
    this.pipeline.enableShadows(character.mesh, this.shadow);
  }

  private tick = () => {
    const delta = Math.min(this.app.ticker.deltaMS / 1000, 0.1);
    for (const character of this.characters.values()) character.update(delta);
  };

  destroy() {
    this.destroyed = true;
    this.app.ticker.remove(this.tick);
    this.orbit.destroy();

    const canvas = this.app.view as HTMLCanvasElement;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerCancel);

    for (const character of this.characters.values()) {
      this.pipeline.disableShadows(character.mesh);
      character.mesh.destroy(true);
    }
    this.characters.clear();

    this.shadow?.destroy();
    LightingEnvironment.main?.lights.splice(0);
    (LightingEnvironment as unknown as { main?: LightingEnvironment }).main = undefined;
    this.camera.destroy();
    this.app.destroy(true, { children: true, texture: true, baseTexture: true });
    // PixiJS normally removes the view with `removeView`; guard just in case.
    if (canvas.parentElement === this.container) this.container.removeChild(canvas);
  }
}
