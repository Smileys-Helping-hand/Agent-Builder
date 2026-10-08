/**
 * The open-world city game itself, with no drawing and no browser: a city of
 * roads and blocks seen from above, a player who walks, takes cars and drives
 * them, traffic and pedestrians, police who chase a wanted player, and
 * delivery missions against the clock that pay cash. All of it moves forward
 * by step(), so every rule is tested without a screen.
 *
 * Positions are in tiles (fractions allowed), angles in radians (0 = east),
 * time in seconds. The city comes from a seed in the state, so the same game
 * plays the same way in a test.
 */

export type Tile = "road" | "sidewalk" | "building" | "park" | "water";

export interface GameSettings {
  /** The city is a square of this many tiles. */
  size: number;
  /** A road every this many tiles, both ways. */
  block: number;
  /** Tiles per second on foot. */
  walkSpeed: number;
  /** Car top speed and acceleration, tiles per second (and per second squared). */
  carSpeed: number;
  carAccel: number;
  /** How fast a car turns at full lock, radians per second. */
  steer: number;
  traffic: number;
  pedestrians: number;
  /** Seconds out of police sight before one wanted star drops. */
  coolDown: number;
  startCash: number;
  /** A mission's pay and time limit grow with each one done. */
  missionPay: number;
  missionSeconds: number;
  colors: { road: string; sidewalk: string; building: string; park: string; water: string };
}

export interface Car {
  id: number;
  x: number;
  y: number;
  angle: number;
  speed: number;
  kind: "car" | "police";
  /** Who drives it: the traffic, the police, the player, or nobody (parked). */
  driver: "traffic" | "police" | "player" | "none";
  color: string;
  /** Damage taken, 0 to 100; at 100 it is a wreck. */
  damage: number;
}

export interface Person {
  id: number;
  x: number;
  y: number;
  angle: number;
  hp: number;
}

export interface Mission {
  /** Where to collect the package, then where to take it. */
  pickup: [number, number];
  dropoff: [number, number];
  /** Collected and on its way. */
  carrying: boolean;
  /** Seconds left, once collected. */
  timeLeft: number;
  pay: number;
}

export interface Input {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export type Status = "playing" | "paused" | "busted" | "wasted";

export interface GameState {
  settings: GameSettings;
  map: Tile[][];
  status: Status;
  player: { x: number; y: number; angle: number; hp: number; inCar: number | null };
  cars: Car[];
  people: Person[];
  input: Input;
  cash: number;
  /** Wanted level, 0 to 5 stars. */
  wanted: number;
  /** Seconds since a police car last saw the player. */
  unseen: number;
  mission: Mission | null;
  missionsDone: number;
  score: number;
  /** Seconds left of a "busted" or "wasted" pause. */
  respawnIn: number;
  seed: number;
  nextId: number;
  log: string[];
}

export type GameEvent =
  | "entered-car"
  | "left-car"
  | "car-stolen"
  | "crash"
  | "ran-over"
  | "wanted-up"
  | "wanted-down"
  | "busted"
  | "wasted"
  | "picked-up"
  | "delivered"
  | "mission-failed";

export const DEFAULT_SETTINGS: GameSettings = {
  size: 48,
  block: 8,
  walkSpeed: 3,
  carSpeed: 9,
  carAccel: 6,
  steer: 2.6,
  traffic: 10,
  pedestrians: 18,
  coolDown: 8,
  startCash: 100,
  missionPay: 250,
  missionSeconds: 60,
  colors: { road: "#374151", sidewalk: "#9ca3af", building: "#1f2937", park: "#166534", water: "#1e3a8a" }
};

const CAR_COLORS = ["#ef4444", "#3b82f6", "#f59e0b", "#10b981", "#e5e7eb", "#a855f7", "#f97316"];

/** A small, seeded random generator: the same seed gives the same numbers. */
export function random(state: { seed: number }): number {
  state.seed = (state.seed * 1664525 + 1013904223) % 4294967296;
  return state.seed / 4294967296;
}

function note(state: GameState, line: string): void {
  state.log.push(line);
  if (state.log.length > 20) state.log.splice(0, state.log.length - 20);
}

/** The city's tiles: a road every `block` tiles each way, sidewalks beside them, blocks of buildings and parks, water at the edge. */
export function makeMap(settings: GameSettings, state: { seed: number }): Tile[][] {
  const { size, block } = settings;
  const map: Tile[][] = [];
  for (let y = 0; y < size; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < size; x++) {
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) row.push("water");
      else if (x % block === 1 || y % block === 1 || x % block === 2 || y % block === 2) row.push("road");
      else if (x % block === 3 || y % block === 3 || x % block === 0 || y % block === 0) row.push("sidewalk");
      else row.push("building");
    }
    map.push(row);
  }
  // Some blocks are parks: open ground to cut across.
  for (let by = 0; by * block < size; by++) {
    for (let bx = 0; bx * block < size; bx++) {
      if (random(state) < 0.2) {
        for (let y = by * block + 4; y < by * block + block && y < size - 1; y++) {
          for (let x = bx * block + 4; x < bx * block + block && x < size - 1; x++) if (map[y][x] === "building") map[y][x] = "park";
        }
      }
    }
  }
  return map;
}

export const tileAt = (state: GameState, x: number, y: number): Tile => state.map[Math.floor(y)]?.[Math.floor(x)] ?? "water";

/** Whether something can stand here: buildings and water stop people and cars. */
export const walkable = (state: GameState, x: number, y: number): boolean => {
  const tile = tileAt(state, x, y);
  return tile !== "building" && tile !== "water";
};

/** A random tile of one kind, for placing things. */
function randomTile(state: GameState, kind: Tile): [number, number] {
  for (let tries = 0; tries < 2000; tries++) {
    const x = 1 + Math.floor(random(state) * (state.settings.size - 2));
    const y = 1 + Math.floor(random(state) * (state.settings.size - 2));
    if (state.map[y][x] === kind) return [x + 0.5, y + 0.5];
  }
  return [state.settings.size / 2, state.settings.size / 2];
}

/** The direction a road runs at a tile: along x, along y, or a crossing. */
const roadAxis = (state: GameState, x: number, y: number): "x" | "y" | "cross" => {
  const b = state.settings.block;
  const cx = Math.floor(x) % b;
  const cy = Math.floor(y) % b;
  const onX = cy === 1 || cy === 2;
  const onY = cx === 1 || cx === 2;
  return onX && onY ? "cross" : onX ? "x" : "y";
};

function spawnCar(state: GameState, driver: Car["driver"], kind: Car["kind"] = "car", near?: [number, number]): Car {
  let [x, y] = randomTile(state, "road");
  if (near) {
    for (let tries = 0; tries < 400; tries++) {
      const [cx, cy] = randomTile(state, "road");
      const d = Math.hypot(cx - near[0], cy - near[1]);
      if (d > 8 && d < 16) {
        [x, y] = [cx, cy];
        break;
      }
    }
  }
  const axis = roadAxis(state, x, y);
  const angle = axis === "y" ? (random(state) < 0.5 ? Math.PI / 2 : -Math.PI / 2) : random(state) < 0.5 ? 0 : Math.PI;
  const car: Car = { id: state.nextId++, x, y, angle, speed: driver === "none" ? 0 : 2, kind, driver, color: kind === "police" ? "#1e40af" : CAR_COLORS[Math.floor(random(state) * CAR_COLORS.length)], damage: 0 };
  state.cars.push(car);
  return car;
}

function newMission(state: GameState): Mission {
  const pickup = randomTile(state, "sidewalk");
  let dropoff = randomTile(state, "sidewalk");
  for (let tries = 0; tries < 50 && Math.hypot(dropoff[0] - pickup[0], dropoff[1] - pickup[1]) < state.settings.size / 3; tries++) dropoff = randomTile(state, "sidewalk");
  return { pickup, dropoff, carrying: false, timeLeft: state.settings.missionSeconds + state.missionsDone * 5, pay: state.settings.missionPay + state.missionsDone * 100 };
}

const recalcScore = (state: GameState) => {
  state.score = Math.max(0, Math.round(state.cash + state.missionsDone * 200));
};

export function newGame(settings: GameSettings, seed = 41): GameState {
  const state: GameState = {
    settings,
    map: [],
    status: "playing",
    player: { x: 0, y: 0, angle: 0, hp: 100, inCar: null },
    cars: [],
    people: [],
    input: { up: false, down: false, left: false, right: false },
    cash: settings.startCash,
    wanted: 0,
    unseen: 0,
    mission: null,
    missionsDone: 0,
    score: 0,
    respawnIn: 0,
    seed,
    nextId: 1,
    log: []
  };
  state.map = makeMap(settings, state);
  // The player starts on a sidewalk beside a parked car: E gets straight in.
  let road: [number, number] | null = null;
  for (let tries = 0; tries < 500 && !road; tries++) {
    [state.player.x, state.player.y] = randomTile(state, "sidewalk");
    const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).find(([dx, dy]) => tileAt(state, state.player.x + dx, state.player.y + dy) === "road");
    if (next) road = [state.player.x + next[0], state.player.y + next[1]];
  }
  for (let i = 0; i < settings.traffic; i++) spawnCar(state, "traffic");
  const parked = spawnCar(state, "none");
  if (road) {
    [parked.x, parked.y] = road;
    parked.angle = roadAxis(state, road[0], road[1]) === "y" ? Math.PI / 2 : 0;
  }
  for (let i = 0; i < settings.pedestrians; i++) {
    const [x, y] = randomTile(state, "sidewalk");
    state.people.push({ id: state.nextId++, x, y, angle: random(state) * Math.PI * 2, hp: 1 });
  }
  state.mission = newMission(state);
  recalcScore(state);
  note(state, "Welcome to the city. Get to the green marker to start a delivery.");
  return state;
}

export function setInput(state: GameState, input: Partial<Input>): void {
  state.input = { ...state.input, ...input };
}

/** The player's position, in a car or on foot. */
export const playerAt = (state: GameState): { x: number; y: number; angle: number } => {
  const car = state.cars.find((c) => c.id === state.player.inCar);
  return car ? { x: car.x, y: car.y, angle: car.angle } : state.player;
};

/** The car the player could get into: the closest within reach. */
export const nearestCar = (state: GameState, reach = 1.6): Car | null =>
  state.cars
    .filter((car) => car.damage < 100 && Math.hypot(car.x - state.player.x, car.y - state.player.y) <= reach)
    .sort((a, b) => Math.hypot(a.x - state.player.x, a.y - state.player.y) - Math.hypot(b.x - state.player.x, b.y - state.player.y))[0] ?? null;

const raiseWanted = (state: GameState, events: GameEvent[], by = 1) => {
  const before = state.wanted;
  state.wanted = Math.min(5, state.wanted + by);
  state.unseen = 0;
  if (state.wanted > before) {
    events.push("wanted-up");
    // More stars, more police.
    const police = state.cars.filter((c) => c.kind === "police" && c.damage < 100).length;
    for (let i = police; i < state.wanted; i++) spawnCar(state, "police", "police", [state.player.x, state.player.y]);
  }
};

/** Get into the nearest car, or out of the one the player drives. Taking someone's car is a crime. */
export function action(state: GameState): GameEvent[] {
  if (state.status !== "playing") return [];
  const events: GameEvent[] = [];
  const driving = state.cars.find((c) => c.id === state.player.inCar);
  if (driving) {
    // Out on the side of the car, where there is room.
    const sides: [number, number][] = [
      [Math.cos(driving.angle + Math.PI / 2), Math.sin(driving.angle + Math.PI / 2)],
      [Math.cos(driving.angle - Math.PI / 2), Math.sin(driving.angle - Math.PI / 2)]
    ];
    const side = sides.find(([dx, dy]) => walkable(state, driving.x + dx, driving.y + dy)) ?? [0, 0];
    state.player.x = driving.x + side[0];
    state.player.y = driving.y + side[1];
    driving.driver = "none";
    driving.speed = 0;
    state.player.inCar = null;
    events.push("left-car");
    return events;
  }
  const car = nearestCar(state);
  if (!car) return [];
  if (car.driver === "traffic" || car.driver === "police") {
    events.push("car-stolen");
    raiseWanted(state, events, car.kind === "police" ? 2 : 1);
    note(state, car.kind === "police" ? "You took a police car!" : "Car stolen.");
  }
  car.driver = "player";
  state.player.inCar = car.id;
  events.push("entered-car");
  return events;
}

/** Pause or carry on; after busted or wasted, nothing. */
export function togglePause(state: GameState): void {
  if (state.status === "playing") state.status = "paused";
  else if (state.status === "paused") state.status = "playing";
}

const drive = (state: GameState, car: Car, dt: number, gas: number, turn: number, events: GameEvent[]) => {
  const { carSpeed, carAccel, steer } = state.settings;
  const top = car.kind === "police" ? carSpeed * 1.05 : carSpeed;
  car.speed += gas * carAccel * dt;
  // Rolling resistance when nobody presses anything.
  if (gas === 0) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), carAccel * 0.6 * dt);
  car.speed = Math.max(-top / 3, Math.min(top, car.speed));
  // Steering works with speed, as a car does.
  car.angle += turn * steer * dt * Math.min(1, Math.abs(car.speed) / 3) * Math.sign(car.speed || 1);
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  if (walkable(state, nx, ny)) {
    car.x = nx;
    car.y = ny;
  } else {
    if (Math.abs(car.speed) > 4) {
      car.damage = Math.min(100, car.damage + Math.abs(car.speed) * 2);
      events.push("crash");
    }
    car.speed = -car.speed * 0.3;
  }
};

/** Traffic follows the road: straight on, and at a crossing it sometimes turns. */
const steerTraffic = (state: GameState, car: Car, dt: number, events: GameEvent[]) => {
  const ahead: [number, number] = [car.x + Math.cos(car.angle) * 1.2, car.y + Math.sin(car.angle) * 1.2];
  if (tileAt(state, ahead[0], ahead[1]) !== "road") {
    // The road ends ahead: turn to a direction that has road.
    const turns = [Math.PI / 2, -Math.PI / 2, Math.PI].map((t) => car.angle + t);
    const open = turns.filter((a) => tileAt(state, car.x + Math.cos(a) * 1.2, car.y + Math.sin(a) * 1.2) === "road");
    car.angle = open.length ? open[Math.floor(random(state) * open.length)] : car.angle + Math.PI;
    car.angle = Math.round(car.angle / (Math.PI / 2)) * (Math.PI / 2);
  } else if (roadAxis(state, car.x, car.y) === "cross" && random(state) < 0.01) {
    car.angle += random(state) < 0.5 ? Math.PI / 2 : -Math.PI / 2;
  }
  drive(state, car, dt, car.speed < 3 ? 1 : 0, 0, events);
};

/** Police head for the player, steering toward them. */
const steerPolice = (state: GameState, car: Car, dt: number, events: GameEvent[]) => {
  const target = playerAt(state);
  const want = Math.atan2(target.y - car.y, target.x - car.x);
  let diff = want - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  drive(state, car, dt, 1, Math.max(-1, Math.min(1, diff * 2)), events);
};

const respawn = (state: GameState) => {
  const car = state.cars.find((c) => c.id === state.player.inCar);
  if (car) car.driver = "none";
  state.player.inCar = null;
  [state.player.x, state.player.y] = randomTile(state, "sidewalk");
  state.player.hp = 100;
  state.wanted = 0;
  state.cars = state.cars.filter((c) => c.kind !== "police");
  if (state.mission?.carrying) state.mission = newMission(state);
  state.status = "playing";
};

/** Move the game forward by dt seconds. */
export function step(state: GameState, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  if (dt <= 0 || state.status === "paused") return events;
  if (state.status === "busted" || state.status === "wasted") {
    state.respawnIn = Math.max(0, state.respawnIn - dt);
    if (state.respawnIn === 0) respawn(state);
    return events;
  }
  const { input } = state;
  const gas = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  const turn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const mine = state.cars.find((c) => c.id === state.player.inCar);
  if (mine) {
    drive(state, mine, dt, gas, turn, events);
    state.player.x = mine.x;
    state.player.y = mine.y;
    state.player.angle = mine.angle;
  } else if (gas || turn) {
    const length = Math.hypot(turn, gas);
    const nx = state.player.x + (turn / length) * state.settings.walkSpeed * dt;
    const ny = state.player.y - (gas / length) * state.settings.walkSpeed * dt;
    if (walkable(state, nx, state.player.y)) state.player.x = nx;
    if (walkable(state, state.player.x, ny)) state.player.y = ny;
    state.player.angle = Math.atan2(-gas, turn);
  }

  for (const car of state.cars) {
    if (car.damage >= 100) continue;
    if (car.driver === "traffic") steerTraffic(state, car, dt, events);
    else if (car.driver === "police") steerPolice(state, car, dt, events);
    else if (car.driver === "none" && car.speed !== 0) drive(state, car, dt, 0, 0, events);
  }

  // People wander the sidewalks; a fast car knocks them down.
  for (const person of state.people) {
    if (person.hp <= 0) continue;
    if (random(state) < 0.02) person.angle = random(state) * Math.PI * 2;
    const nx = person.x + Math.cos(person.angle) * 1.2 * dt;
    const ny = person.y + Math.sin(person.angle) * 1.2 * dt;
    if (tileAt(state, nx, ny) === "sidewalk" || tileAt(state, nx, ny) === "park") {
      person.x = nx;
      person.y = ny;
    } else person.angle += Math.PI;
    for (const car of state.cars) {
      if (Math.abs(car.speed) > 3 && Math.hypot(car.x - person.x, car.y - person.y) < 0.6) {
        person.hp = 0;
        if (car.id === state.player.inCar) {
          events.push("ran-over");
          raiseWanted(state, events);
        }
      }
    }
  }
  state.people = state.people.filter((p) => p.hp > 0);
  while (state.people.length < state.settings.pedestrians) {
    const [x, y] = randomTile(state, "sidewalk");
    state.people.push({ id: state.nextId++, x, y, angle: random(state) * Math.PI * 2, hp: 1 });
  }

  // On foot, a passing car hurts.
  if (!mine) {
    for (const car of state.cars) {
      if (car.damage < 100 && Math.abs(car.speed) > 3 && Math.hypot(car.x - state.player.x, car.y - state.player.y) < 0.6) state.player.hp -= 40 * dt * 4;
    }
    if (state.player.hp <= 0) {
      state.status = "wasted";
      state.respawnIn = 3;
      state.cash = Math.max(0, state.cash - 100);
      events.push("wasted");
      note(state, "Wasted. The hospital patched you up for 100.");
      recalcScore(state);
      return events;
    }
  }

  // The police: catch a wanted player on foot, lose track of one out of sight.
  if (state.wanted > 0) {
    const police = state.cars.filter((c) => c.kind === "police" && c.damage < 100 && c.driver === "police");
    const me = playerAt(state);
    const seen = police.some((c) => Math.hypot(c.x - me.x, c.y - me.y) < 10);
    state.unseen = seen ? 0 : state.unseen + dt;
    if (!mine && police.some((c) => Math.hypot(c.x - me.x, c.y - me.y) < 1)) {
      state.status = "busted";
      state.respawnIn = 3;
      state.cash = Math.max(0, Math.round(state.cash * 0.75));
      events.push("busted");
      note(state, "Busted! The police took a quarter of your cash.");
      recalcScore(state);
      return events;
    }
    if (state.unseen >= state.settings.coolDown) {
      state.wanted -= 1;
      state.unseen = 0;
      events.push("wanted-down");
      if (state.wanted === 0) state.cars = state.cars.filter((c) => !(c.kind === "police" && c.driver === "police"));
    }
  }

  // Missions: reach the package, then the drop-off before time runs out.
  const mission = state.mission;
  if (mission) {
    const me = playerAt(state);
    if (!mission.carrying && Math.hypot(me.x - mission.pickup[0], me.y - mission.pickup[1]) < 1.5) {
      mission.carrying = true;
      events.push("picked-up");
      note(state, `Package collected. Deliver it within ${Math.round(mission.timeLeft)} seconds.`);
    } else if (mission.carrying) {
      mission.timeLeft = Math.max(0, mission.timeLeft - dt);
      if (Math.hypot(me.x - mission.dropoff[0], me.y - mission.dropoff[1]) < 1.5) {
        state.cash += mission.pay;
        state.missionsDone += 1;
        events.push("delivered");
        note(state, `Delivered! +${mission.pay}.`);
        state.mission = newMission(state);
      } else if (mission.timeLeft === 0) {
        events.push("mission-failed");
        note(state, "Too late. A new job is waiting at the green marker.");
        state.mission = newMission(state);
      }
    }
  }
  recalcScore(state);
  return events;
}
