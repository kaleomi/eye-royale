// 全局共享状态（各模块通过 G 互相访问，避免循环依赖带来的初始化问题）
export const G = {
  scene: null,
  camera: null,
  renderer: null,
  maxAniso: 1,
  actors: [],
  player: null,
  mode: 'menu',          // menu | match | over
  paused: false,
  time: 0,
  matchTime: 0,
  totalPlayers: 0,
  codeBuf: '',
  dragLook: false,
  settings: { sens: 1, bots: 29, diff: 1, name: '玩家' },
  stats: { head: 0, body: 0, miss: 0, dmg: 0 },
  hooks: {},
};
