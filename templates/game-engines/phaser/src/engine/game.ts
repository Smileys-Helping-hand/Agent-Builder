/**
 * The game, in Phaser 3: Boot loads the pictures, Title waits for a key or tap,
 * Play is the game, Over shows the result. Build the game by growing these
 * scenes (and adding more): sprites, arcade physics, tweens, particles, cameras,
 * tilemaps, input and scaling are all Phaser's. Rules stay in src/game/rules.ts.
 *
 * Pictures: anything in public/assets/manifest.json (what the image engine draws
 * from art.json) is loaded by its name; until it exists, a shape is drawn for it,
 * so the game always runs.
 */
import Phaser from "phaser";

import { addScore, loseLife, newGame, type GameState } from "../game/rules";
import { load, save } from "./save";
import { sfx, unlock } from "./sound";

const WIDTH = 960;
const HEIGHT = 540;

/** A picture by name, or a generated shape when it has not been drawn yet. */
export function texture(scene: Phaser.Scene, name: string, color: number, size = 48): string {
  if (scene.textures.exists(name)) return name;
  const shape = scene.add.graphics();
  shape.fillStyle(color, 1);
  shape.fillRoundedRect(0, 0, size, size, size / 5);
  shape.lineStyle(3, 0xffffff, 0.8);
  shape.strokeRoundedRect(1, 1, size - 2, size - 2, size / 5);
  shape.generateTexture(name, size, size);
  shape.destroy();
  return name;
}

class Boot extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  preload() {
    this.load.on("loaderror", () => undefined);
    this.load.json("manifest", "assets/manifest.json");
  }

  create() {
    const manifest = this.cache.json.get("manifest") as { assets?: Record<string, { file?: string }> } | undefined;
    const entries = Object.entries(manifest?.assets ?? {}).filter(([, asset]) => asset.file);
    if (!entries.length) {
      this.scene.start("title");
      return;
    }
    for (const [name, asset] of entries) this.load.image(name, asset.file!);
    this.load.once("complete", () => this.scene.start("title"));
    this.load.start();
  }
}

class Title extends Phaser.Scene {
  constructor() {
    super("title");
  }

  create() {
    const best = load().best;
    this.add.text(WIDTH / 2, HEIGHT / 2 - 60, document.title, { fontFamily: "system-ui", fontSize: "56px", color: "#ffffff" }).setOrigin(0.5);
    const prompt = this.add.text(WIDTH / 2, HEIGHT / 2 + 20, "Press a key or tap to play", { fontFamily: "system-ui", fontSize: "22px", color: "#c8d0e0" }).setOrigin(0.5);
    this.tweens.add({ targets: prompt, alpha: 0.35, yoyo: true, repeat: -1, duration: 700, ease: "Sine.easeInOut" });
    if (best) this.add.text(WIDTH / 2, HEIGHT / 2 + 64, `Best: ${best}`, { fontFamily: "system-ui", fontSize: "18px", color: "#8893a8" }).setOrigin(0.5);
    const go = () => {
      unlock();
      sfx.click();
      this.scene.start("play");
    };
    this.input.once("pointerdown", go);
    this.input.keyboard?.once("keydown", go);
  }
}

class Play extends Phaser.Scene {
  private game_state: GameState = newGame();
  private player!: Phaser.Physics.Arcade.Sprite;
  private items!: Phaser.Physics.Arcade.Group;
  private hazards!: Phaser.Physics.Arcade.Group;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private hud!: Phaser.GameObjects.Text;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super("play");
  }

  create() {
    this.game_state = newGame();
    this.cameras.main.fadeIn(250);
    this.player = this.physics.add.sprite(WIDTH / 2, HEIGHT / 2, texture(this, "player", 0x4ade80));
    this.player.setCollideWorldBounds(true).setDamping(true).setDrag(0.02).setMaxVelocity(320);
    this.items = this.physics.add.group();
    this.hazards = this.physics.add.group();
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.hud = this.add.text(16, 12, "", { fontFamily: "system-ui", fontSize: "20px", color: "#ffffff" }).setScrollFactor(0).setDepth(10);
    this.burst = this.add.particles(0, 0, texture(this, "spark", 0xffffff, 8), { speed: { min: 60, max: 240 }, lifespan: 450, scale: { start: 1, end: 0 }, emitting: false });

    this.physics.add.overlap(this.player, this.items, (_player, item) => {
      (item as Phaser.Physics.Arcade.Sprite).destroy();
      this.game_state = addScore(this.game_state, 10);
      this.burst.explode(14, this.player.x, this.player.y);
      sfx.pickup();
    });
    this.physics.add.overlap(this.player, this.hazards, (_player, hazard) => {
      (hazard as Phaser.Physics.Arcade.Sprite).destroy();
      this.game_state = loseLife(this.game_state);
      this.cameras.main.shake(180, 0.012);
      this.cameras.main.flash(120, 255, 60, 60);
      sfx.hit();
      if (this.game_state.over) this.finish();
    });
    this.time.addEvent({ delay: 900, loop: true, callback: () => this.spawn() });
  }

  private spawn() {
    const item = this.items.create(Phaser.Math.Between(40, WIDTH - 40), Phaser.Math.Between(40, HEIGHT - 40), texture(this, "item", 0xfacc15, 28)) as Phaser.Physics.Arcade.Sprite;
    this.tweens.add({ targets: item, scale: { from: 0, to: 1 }, duration: 220, ease: "Back.easeOut" });
    const hazard = this.hazards.create(WIDTH + 30, Phaser.Math.Between(0, HEIGHT), texture(this, "hazard", 0xf87171, 36)) as Phaser.Physics.Arcade.Sprite;
    hazard.setVelocityX(-120 - this.game_state.level * 30);
  }

  private finish() {
    const best = Math.max(load().best, this.game_state.score);
    save({ best });
    sfx.lose();
    this.scene.start("over", { score: this.game_state.score, best });
  }

  update() {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const speed = 900;
    const pointer = this.input.activePointer;
    body.setAcceleration(0, 0);
    if (this.cursors?.left.isDown) body.setAccelerationX(-speed);
    if (this.cursors?.right.isDown) body.setAccelerationX(speed);
    if (this.cursors?.up.isDown) body.setAccelerationY(-speed);
    if (this.cursors?.down.isDown) body.setAccelerationY(speed);
    if (pointer.isDown) this.physics.accelerateTo(this.player, pointer.worldX, pointer.worldY, speed);
    this.hud.setText(`Score ${this.game_state.score}   Lives ${this.game_state.lives}   Level ${this.game_state.level}`);
  }
}

class Over extends Phaser.Scene {
  constructor() {
    super("over");
  }

  create(data: { score: number; best: number }) {
    this.add.text(WIDTH / 2, HEIGHT / 2 - 50, "Game over", { fontFamily: "system-ui", fontSize: "52px", color: "#ffffff" }).setOrigin(0.5);
    this.add.text(WIDTH / 2, HEIGHT / 2 + 14, `Score ${data.score}  ·  Best ${data.best}`, { fontFamily: "system-ui", fontSize: "22px", color: "#c8d0e0" }).setOrigin(0.5);
    const again = () => this.scene.start("play");
    this.time.delayedCall(400, () => {
      this.input.once("pointerdown", again);
      this.input.keyboard?.once("keydown", again);
    });
  }
}

/** Starts the game in an element; returns how to stop it. */
export function startGame(parent: HTMLElement): () => void {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: "#0b1020",
    physics: { default: "arcade" },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [Boot, Title, Play, Over]
  });
  return () => game.destroy(true);
}
