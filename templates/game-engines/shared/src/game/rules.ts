/**
 * The game's rules, as plain functions on plain data, so they can be tested
 * without a screen (and, in a multiplayer game, run by the host). The engine
 * calls these; it does not decide them. Replace these with the game's own.
 */
export interface GameState {
  score: number;
  lives: number;
  level: number;
  over: boolean;
}

export const newGame = (): GameState => ({ score: 0, lives: 3, level: 1, over: false });

export const addScore = (state: GameState, points: number): GameState => {
  const score = state.score + points;
  return { ...state, score, level: 1 + Math.floor(score / 100) };
};

export const loseLife = (state: GameState): GameState => {
  const lives = state.lives - 1;
  return { ...state, lives, over: lives <= 0 };
};
