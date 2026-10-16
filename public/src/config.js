// 瞳击 EYE ROYALE — 全局常量与道具定义
export const MAP_HALF = 600;          // 地图半宽（米），整张图 1200m × 1200m
export const GRID = 160;              // 地形网格分段
export const WATER_LEVEL = 0;
export const PLANE_ALT = 330;
export const HP_MAX = 100;
export const GRAVITY = 22;

// 读码伤害
export const DMG_HEAD = 100;
export const DMG_BODY = 50;

// 防具：减伤比例 / 耐久
export const ARMOR_REDUCE = [0, 0.30, 0.40, 0.55];
export const ARMOR_DURA = [0, 80, 150, 230];
// 背包容量（重量单位）
export const BAG_CAP = [24, 44, 64, 84];

// 裸眼可读距离（机器人用；玩家完全靠自己的眼睛）
export const READ_RANGE_BODY = 24;
export const READ_RANGE_HEAD = 9;
export const SCAN_RANGE = 14;
export const SCAN_TIME = 4;
export const REVEAL_TIME = 8;

export const ITEM_DEFS = {
  helmet1: { name: '一级头', cat: 'helmet', level: 1, color: 0x8d9a6a },
  helmet2: { name: '二级头', cat: 'helmet', level: 2, color: 0x4f7fb0 },
  helmet3: { name: '三级头', cat: 'helmet', level: 3, color: 0x9b5cff },
  armor1:  { name: '一级甲', cat: 'armor',  level: 1, color: 0x8d9a6a },
  armor2:  { name: '二级甲', cat: 'armor',  level: 2, color: 0x4f7fb0 },
  armor3:  { name: '三级甲', cat: 'armor',  level: 3, color: 0x9b5cff },
  bag1:    { name: '一级包', cat: 'bag',    level: 1, color: 0x8d9a6a },
  bag2:    { name: '二级包', cat: 'bag',    level: 2, color: 0x4f7fb0 },
  bag3:    { name: '三级包', cat: 'bag',    level: 3, color: 0x9b5cff },
  scope2:  { name: '2倍镜', cat: 'scope', zoom: 2, color: 0x2a2a2a },
  scope4:  { name: '4倍镜', cat: 'scope', zoom: 4, color: 0x2a2a2a },
  scope8:  { name: '8倍镜', cat: 'scope', zoom: 8, color: 0x2a2a2a },
  scanner: { name: '扫描器', cat: 'scanner', color: 0x22d3ee },
  bandage: { name: '绷带',   cat: 'heal',  weight: 1, use: 3, heal: 15, cap: 75,  key: 'Z', stack: 5, color: 0xf1f1f1 },
  firstaid:{ name: '急救包', cat: 'heal',  weight: 3, use: 6, heal: 75, cap: 75,  key: 'X', stack: 1, color: 0xe8e8e8 },
  medkit:  { name: '医疗箱', cat: 'heal',  weight: 6, use: 8, heal: 100, cap: 100, key: 'V', stack: 1, color: 0xff4d4d },
  drink:   { name: '能量饮料', cat: 'boost', weight: 2, use: 4, boost: 40, key: 'B', stack: 1, color: 0xffc928 },
  flash:   { name: '闪光弹', cat: 'throw', weight: 3, key: 'Q', stack: 1, color: 0xdedede },
  smoke:   { name: '烟雾弹', cat: 'throw', weight: 3, key: 'E', stack: 1, color: 0x6b8f71 },
  camo:    { name: '干扰涂层', cat: 'camo', weight: 2, use: 2, key: 'T', stack: 1, color: 0xc06cff },
};

export const CONSUMABLES = ['bandage', 'firstaid', 'medkit', 'drink', 'flash', 'smoke', 'camo'];

export const LOOT_TABLE = [
  ['bandage', 14], ['firstaid', 7], ['medkit', 2], ['drink', 8],
  ['flash', 6], ['smoke', 6], ['camo', 3],
  ['helmet1', 7], ['helmet2', 4], ['helmet3', 1],
  ['armor1', 7], ['armor2', 4], ['armor3', 1],
  ['bag1', 6], ['bag2', 3], ['bag3', 1],
  ['scope2', 5], ['scope4', 3], ['scope8', 1.5],
  ['scanner', 2.5],
];

// 缩圈阶段：等待秒数 / 收缩秒数 / 目标半径 / 圈外每秒伤害
export const ZONE_PHASES = [
  { wait: 95, shrink: 60, r: 400, dps: 1 },
  { wait: 60, shrink: 45, r: 240, dps: 2 },
  { wait: 50, shrink: 40, r: 140, dps: 4 },
  { wait: 40, shrink: 30, r: 75,  dps: 6 },
  { wait: 30, shrink: 25, r: 36,  dps: 9 },
  { wait: 25, shrink: 20, r: 12,  dps: 12 },
  { wait: 20, shrink: 25, r: 0,   dps: 18 },
];
export const ZONE_R0 = 640;

export const TOWN_NAMES = ['晶石镇', '灯塔湾', '老钢厂', '风车村', '雾谷', '旧学校', '军事基地', '渔港', '山顶哨所', '废弃医院', '采石场', '红砖区'];

export const BOT_NAMES = [
  '鹰眼老王', '快手小李', '不眨眼', '读心者', '零零七', '瞳孔地震', '老花眼', '八倍镜战神', '背对大师', '闪光侠',
  '烟雾专家', '数字猎人', '一眼万年', '手速一百八', '近视八百度', '盯着你', '看穿一切', '眼疾手快', '默背小能手', '小眼睛',
  '火眼金睛', '千里眼', '扫描仪本仪', '九九乘法表', '密码破译员', '四位数', '心算达人', '夜猫子', '读码机器', '偷窥狂魔',
  '不回头', '转身就跑', '蹲草侠', '跳伞大王', '毒圈边缘人', '平底锅', '吃鸡专业户', '萌新求带', '瞄得准', '眼神杀',
];

export const DIFFICULTY = [
  { name: '简单', readMul: 1.55, acc: -0.08 },
  { name: '普通', readMul: 1.0, acc: 0 },
  { name: '困难', readMul: 0.68, acc: 0.04 },
];
