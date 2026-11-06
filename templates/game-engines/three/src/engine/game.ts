/**
 * The game, in three.js: a lit world with shadows and fog, a player moved with
 * the keyboard or by touch, a following camera, a fixed-step loop and a HUD. Build
 * the game by growing this: meshes and materials made in code, animation, levels.
 * Rules stay in src/game/rules.ts.
 */
import * as THREE from "three";

import { addScore, loseLife, newGame, type GameState } from "../game/rules";
import { load, save } from "./save";
import { sfx, unlock } from "./sound";

const STEP = 1 / 60;

/** Starts the game in an element; returns how to stop it. */
export function startGame(parent: HTMLElement): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  parent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a7c7);
  scene.fog = new THREE.Fog(0x87a7c7, 30, 90);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  const resize = () => {
    renderer.setSize(parent.clientWidth, parent.clientHeight);
    camera.aspect = parent.clientWidth / Math.max(1, parent.clientHeight);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.9));
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
  sun.position.set(20, 40, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40 });
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x4d7a4d, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const player = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 6, 16), new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 0.4 }));
  player.position.y = 1;
  player.castShadow = true;
  scene.add(player);

  let state: GameState = newGame();
  const items: THREE.Mesh[] = [];
  const hazards: THREE.Mesh[] = [];
  const spawn = (list: THREE.Mesh[], color: number, geometry: THREE.BufferGeometry) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.2 }));
    mesh.position.set((Math.random() - 0.5) * 40, 1, (Math.random() - 0.5) * 40);
    mesh.castShadow = true;
    scene.add(mesh);
    list.push(mesh);
  };
  for (let i = 0; i < 12; i++) spawn(items, 0xfacc15, new THREE.OctahedronGeometry(0.5));
  for (let i = 0; i < 6; i++) spawn(hazards, 0xf87171, new THREE.DodecahedronGeometry(0.8));

  const hud = document.createElement("div");
  hud.style.cssText = "position:absolute;left:14px;top:10px;color:#fff;font:600 18px system-ui;text-shadow:0 1px 3px #000;pointer-events:none";
  parent.style.position = "relative";
  parent.appendChild(hud);

  const keys = new Set<string>();
  let pointer: { x: number; y: number } | null = null;
  const down = (event: KeyboardEvent) => {
    unlock();
    keys.add(event.code);
  };
  const up = (event: KeyboardEvent) => keys.delete(event.code);
  const press = (event: PointerEvent) => {
    unlock();
    pointer = { x: event.clientX / window.innerWidth - 0.5, y: event.clientY / window.innerHeight - 0.5 };
  };
  const release = () => {
    pointer = null;
  };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("pointerdown", press);
  window.addEventListener("pointerup", release);

  const velocity = new THREE.Vector3();
  const update = (dt: number) => {
    const move = new THREE.Vector3((keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0), 0, (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0) - (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0));
    if (pointer) move.set(pointer.x, 0, pointer.y);
    if (move.lengthSq()) move.normalize();
    velocity.lerp(move.multiplyScalar(11), 1 - Math.exp(-10 * dt));
    player.position.addScaledVector(velocity, dt);
    if (velocity.lengthSq() > 0.1) player.rotation.y = Math.atan2(velocity.x, velocity.z);

    for (const item of [...items]) {
      item.rotation.y += dt * 2;
      item.position.y = 1 + Math.sin(performance.now() / 400 + item.id) * 0.2;
      if (item.position.distanceTo(player.position) < 1.2) {
        scene.remove(item);
        items.splice(items.indexOf(item), 1);
        state = addScore(state, 10);
        sfx.pickup();
        spawn(items, 0xfacc15, new THREE.OctahedronGeometry(0.5));
      }
    }
    for (const hazard of hazards) {
      hazard.position.x += Math.sin(performance.now() / 700 + hazard.id) * dt * state.level * 2;
      hazard.rotation.x += dt;
      if (hazard.position.distanceTo(player.position) < 1.4) {
        hazard.position.set((Math.random() - 0.5) * 40, 1, (Math.random() - 0.5) * 40);
        state = loseLife(state);
        sfx.hit();
      }
    }
    if (state.over) {
      save({ best: Math.max(load().best, state.score) });
      sfx.lose();
      state = newGame();
    }
  };

  let last = performance.now();
  let spare = 0;
  let frame = 0;
  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    spare += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (spare >= STEP) {
      update(STEP);
      spare -= STEP;
    }
    camera.position.lerp(new THREE.Vector3(player.position.x, 12, player.position.z + 14), 0.08);
    camera.lookAt(player.position);
    hud.textContent = `Score ${state.score}   Lives ${state.lives}   Level ${state.level}   Best ${load().best}`;
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("pointerdown", press);
    window.removeEventListener("pointerup", release);
    hud.remove();
    renderer.domElement.remove();
    renderer.dispose();
  };
}
