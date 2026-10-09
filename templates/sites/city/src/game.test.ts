import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, action, makeMap, nearestCar, newGame, playerAt, setInput, step, tileAt, togglePause, walkable, type GameState } from "./game";

const fresh = (): GameState => newGame(DEFAULT_SETTINGS);
const run = (state: GameState, seconds: number) => {
  const events = [];
  for (let t = 0; t < seconds; t += 0.05) events.push(...step(state, 0.05));
  return events;
};
/** Put the player on foot beside a car of a given driver, on the road. */
const besideCar = (state: GameState, driver: "traffic" | "none" | "police") => {
  const car = state.cars.find((c) => c.driver === driver) ?? state.cars[0];
  car.driver = driver;
  car.speed = 0;
  state.player.inCar = null;
  state.player.x = car.x;
  state.player.y = car.y;
  return car;
};

describe("the city", () => {
  it("has water round the edge, roads every block, sidewalks and buildings", () => {
    const map = makeMap(DEFAULT_SETTINGS, { seed: 1 });
    expect(map).toHaveLength(DEFAULT_SETTINGS.size);
    expect(map[0][5]).toBe("water");
    expect(map[1 + DEFAULT_SETTINGS.block][5]).toBe("road");
    const tiles = new Set(map.flat());
    for (const tile of ["road", "sidewalk", "building", "water"]) expect(tiles.has(tile as never)).toBe(true);
  });

  it("starts the player on a sidewalk with traffic, people, a parked car near and a job", () => {
    const state = fresh();
    expect(tileAt(state, state.player.x, state.player.y)).toBe("sidewalk");
    expect(state.cars.filter((c) => c.driver === "traffic")).toHaveLength(DEFAULT_SETTINGS.traffic);
    const parked = state.cars.find((c) => c.driver === "none")!;
    expect(nearestCar(state)?.id).toBe(parked.id);
    expect(state.people.length).toBe(DEFAULT_SETTINGS.pedestrians);
    expect(state.mission).not.toBeNull();
    expect(state.cash).toBe(DEFAULT_SETTINGS.startCash);
  });

  it("is the same city for the same seed", () => {
    expect(newGame(DEFAULT_SETTINGS, 5).map).toEqual(newGame(DEFAULT_SETTINGS, 5).map);
  });
});

describe("on foot", () => {
  it("walks with the arrow keys and stops at buildings", () => {
    const state = fresh();
    state.people = [];
    state.cars = [];
    const start = { ...state.player };
    setInput(state, { right: true });
    run(state, 0.5);
    expect(state.player.x).not.toBe(start.x);
    setInput(state, { right: false, up: true });
    run(state, 30);
    expect(walkable(state, state.player.x, state.player.y)).toBe(true);
  });
});

describe("cars", () => {
  it("getting into a parked car is not a crime; driving it moves it", () => {
    const state = fresh();
    const car = besideCar(state, "none");
    expect(action(state)).toEqual(["entered-car"]);
    expect(state.wanted).toBe(0);
    const before = { x: car.x, y: car.y };
    setInput(state, { up: true });
    run(state, 1);
    expect(Math.hypot(car.x - before.x, car.y - before.y)).toBeGreaterThan(0.5);
    expect(playerAt(state).x).toBe(car.x);
  });

  it("taking a car from traffic is a crime and brings the police", () => {
    const state = fresh();
    besideCar(state, "traffic");
    const events = action(state);
    expect(events).toContain("car-stolen");
    expect(events).toContain("wanted-up");
    expect(state.wanted).toBe(1);
    expect(state.cars.filter((c) => c.kind === "police")).toHaveLength(1);
  });

  it("getting out leaves the car parked beside the player", () => {
    const state = fresh();
    const car = besideCar(state, "none");
    action(state);
    expect(action(state)).toEqual(["left-car"]);
    expect(state.player.inCar).toBeNull();
    expect(car.driver).toBe("none");
    expect(nearestCar(state)?.id).toBe(car.id);
  });

  it("a fast crash into a building damages the car", () => {
    const state = fresh();
    const car = besideCar(state, "none");
    action(state);
    car.angle = 0;
    setInput(state, { up: true });
    const events = run(state, 12);
    expect(events).toContain("crash");
    expect(car.damage).toBeGreaterThan(0);
  });

  it("traffic keeps to the roads", () => {
    const state = fresh();
    run(state, 20);
    for (const car of state.cars.filter((c) => c.driver === "traffic")) expect(walkable(state, car.x, car.y)).toBe(true);
  });
});

describe("the police", () => {
  it("catch a wanted player on foot: busted, cash lost, back on the street", () => {
    const state = fresh();
    state.wanted = 1;
    state.cash = 400;
    const police = state.cars[0];
    police.kind = "police";
    police.driver = "police";
    police.x = state.player.x + 0.3;
    police.y = state.player.y;
    const events = run(state, 0.1);
    expect(events).toContain("busted");
    expect(state.status).toBe("busted");
    expect(state.cash).toBe(300);
    run(state, 4);
    expect(state.status).toBe("playing");
    expect(state.wanted).toBe(0);
  });

  it("lose a player out of sight long enough", () => {
    const state = fresh();
    state.wanted = 1;
    state.cars = state.cars.filter((c) => c.kind !== "police");
    const events = run(state, DEFAULT_SETTINGS.coolDown + 0.5);
    expect(events).toContain("wanted-down");
    expect(state.wanted).toBe(0);
  });
});

describe("missions", () => {
  it("collect the package, deliver it in time, get paid and a new job", () => {
    const state = fresh();
    const job = state.mission!;
    state.player.x = job.pickup[0];
    state.player.y = job.pickup[1];
    expect(step(state, 0.05)).toContain("picked-up");
    state.player.x = job.dropoff[0];
    state.player.y = job.dropoff[1];
    expect(step(state, 0.05)).toContain("delivered");
    expect(state.cash).toBe(DEFAULT_SETTINGS.startCash + job.pay);
    expect(state.missionsDone).toBe(1);
    expect(state.mission).not.toBe(job);
    expect(state.mission!.pay).toBeGreaterThan(job.pay);
    expect(state.score).toBe(state.cash + 200);
  });

  it("run out of time and the job is lost", () => {
    const state = fresh();
    const job = state.mission!;
    state.player.x = job.pickup[0];
    state.player.y = job.pickup[1];
    step(state, 0.05);
    state.player.x = job.pickup[0];
    const events = run(state, job.timeLeft + 1);
    expect(events).toContain("mission-failed");
    expect(state.missionsDone).toBe(0);
  });
});

it("pauses and carries on", () => {
  const state = fresh();
  togglePause(state);
  expect(state.status).toBe("paused");
  const before = state.cars.map((c) => c.x);
  run(state, 1);
  expect(state.cars.map((c) => c.x)).toEqual(before);
  togglePause(state);
  expect(state.status).toBe("playing");
});
