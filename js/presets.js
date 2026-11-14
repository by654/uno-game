/* ===================================================================
   presets.js —— 设置项定义、默认值、趣味预设、名字池
   全局命名空间：window.UNO
   =================================================================== */
(function (global) {
  'use strict';

  var UNO = global.UNO = global.UNO || {};

  /* ---------------------- 设置项定义 ---------------------- */
  UNO.SETTING_DEFS = [
    {
      key: 'handSize', label: '初始手牌数', type: 'range',
      min: 3, max: 15, step: 1, def: 7, unit: ' 张',
      desc: '每位玩家开局摸牌数量'
    },
    {
      key: 'targetScore', label: '目标分数', type: 'select', def: 200,
      options: [
        { v: 0, label: '单局定胜负' },
        { v: 100, label: '100 分' },
        { v: 200, label: '200 分' },
        { v: 300, label: '300 分' },
        { v: 500, label: '500 分' }
      ],
      desc: '累计积分达到该值即赢得整场比赛'
    },
    {
      key: 'turnTime', label: '回合时间限制', type: 'select', def: 20,
      options: [
        { v: 0, label: '不限时' },
        { v: 10, label: '10 秒' },
        { v: 15, label: '15 秒' },
        { v: 20, label: '20 秒' },
        { v: 30, label: '30 秒' },
        { v: 60, label: '60 秒' }
      ],
      desc: '超时自动帮你出牌或摸牌'
    },
    { key: 'stack2', label: '+2 可叠加', type: 'switch', def: true, desc: '被 +2 时可用 +2 转移惩罚' },
    { key: 'stack4', label: '+4 可叠加', type: 'switch', def: true, desc: '被 +4 / +2 时可用 +4 继续叠加' },
    { key: 'challengeWild4', label: '+4 可被质疑', type: 'switch', def: false, desc: '质疑成功出牌者摸 4 张，失败则自己摸 6 张' },
    { key: 'drawPlayable', label: '抽牌后可直接出', type: 'switch', def: true, desc: '摸到的牌若合法可以立刻打出' },
    { key: 'sevenZero', label: '7-0 换牌规则', type: 'switch', def: false, desc: '出 7 与指定玩家换手牌，出 0 全员按方向传牌' },
    { key: 'reverseAsSkip', label: '2 人局反转视为跳过', type: 'switch', def: true, desc: '仅两人对局时生效' },
    { key: 'forcePlay', label: '强制出牌', type: 'switch', def: false, desc: '手上有合法牌时必须出牌，不能摸牌' },
    { key: 'unoPenalty', label: '漏喊 UNO 罚牌', type: 'switch', def: true, desc: '剩 1 张未及时喊 UNO 罚摸 2 张' },
    { key: 'hideHands', label: '暗牌模式', type: 'switch', def: false, desc: '隐藏其他玩家的具体手牌数量' },
    { key: 'chaos', label: '混沌模式', type: 'switch', def: false, desc: '每次出牌有概率触发随机额外事件' },
    { key: 'hintHighlight', label: '高亮可出的牌', type: 'switch', def: true, desc: '新手友好提示' },
    { key: 'sfx', label: '音效', type: 'switch', def: true, desc: 'WebAudio 实时合成，无需外部资源' },
    {
      key: 'animSpeed', label: '动画速度', type: 'select', def: 1,
      options: [
        { v: 0.5, label: '慢速' },
        { v: 1, label: '标准' },
        { v: 1.5, label: '偏快' },
        { v: 2, label: '极速' }
      ],
      desc: '影响出牌 / 摸牌 / 回合切换动画时长'
    }
  ];

  UNO.DEFAULT_SETTINGS = (function () {
    var o = {};
    UNO.SETTING_DEFS.forEach(function (d) { o[d.key] = d.def; });
    return o;
  })();

  UNO.cloneSettings = function (s) {
    var o = {};
    Object.keys(UNO.DEFAULT_SETTINGS).forEach(function (k) { o[k] = UNO.DEFAULT_SETTINGS[k]; });
    if (s) Object.keys(s).forEach(function (k) { if (k in o) o[k] = s[k]; });
    return o;
  };

  /* ---------------------- 自定义牌效果定义 ---------------------- */
  UNO.EFFECT_DEFS = [
    { key: 'drawN', label: '抽 N 张', needAmount: true, amountMin: 1, amountMax: 7, defAmount: 2, desc: '下家摸 N 张牌并跳过回合，可被叠牌转移' },
    { key: 'skip', label: '跳过下家', needAmount: false, desc: '下家失去这一回合' },
    { key: 'reverse', label: '反转方向', needAmount: false, desc: '改变出牌方向，2 人局可视为跳过' },
    { key: 'banColor', label: '禁止出某色', needAmount: false, needColor: true, desc: '下家在接下来 2 个回合内不能出指定颜色' },
    { key: 'swapHands', label: '强制交换手牌', needAmount: false, desc: '与手牌最少的对手交换整副手牌' },
    { key: 'copyLast', label: '复制上一张牌效果', needAmount: false, desc: '重复弃牌堆上一张牌的效果' },
    { key: 'doublePenalty', label: '加倍下家惩罚', needAmount: true, amountMin: 2, amountMax: 3, defAmount: 2, desc: '把当前待摸惩罚乘以倍数' },
    { key: 'trimHand', label: '清零下家手牌', needAmount: true, amountMin: 0, amountMax: 1, defAmount: 0, desc: '下家手牌被全部洗回抽牌堆（保留 0 张）' }
  ];

  /* ---------------------- 预设自定义牌组 ---------------------- */
  function cc(name, color, effect, amount, icon, count, banColor) {
    return {
      id: 'x' + Math.random().toString(36).slice(2, 9),
      name: name, color: color, effect: effect, amount: amount,
      icon: icon, count: count, banColor: banColor || 'red'
    };
  }

  var DECK_BOMB = [
    cc('轰炸 +4', 'wild', 'drawN', 6, '💥', 2),
    cc('双倍还击', 'wild', 'doublePenalty', 2, '✖', 2),
    cc('连锁 +2', 'red', 'drawN', 3, '⏬', 1),
    cc('连锁 +2', 'blue', 'drawN', 3, '⏬', 1),
    cc('熄火', 'green', 'skip', 0, '⛔', 2)
  ];

  var DECK_CURSE = [
    cc('诅咒之雨', 'wild', 'drawN', 4, '🌧', 2),
    cc('瘟疫', 'wild', 'banColor', 0, '☠', 2, 'green'),
    cc('血月', 'wild', 'banColor', 0, '🌕', 2, 'blue'),
    cc('命运洗牌', 'wild', 'swapHands', 0, '🔀', 2),
    cc('回响', 'wild', 'copyLast', 0, '🕳', 2),
    cc('虚空吞噬', 'wild', 'trimHand', 0, '🕸', 1),
    cc('痛苦加倍', 'wild', 'doublePenalty', 3, '🩸', 1)
  ];

  var DECK_CHAOS = [
    cc('混沌骰', 'wild', 'copyLast', 0, '🎲', 3),
    cc('相位跳跃', 'wild', 'swapHands', 0, '🌀', 2),
    cc('量子反转', 'wild', 'reverse', 0, '⚛', 2),
    cc('惊喜礼包', 'wild', 'drawN', 2, '🎁', 3),
    cc('静默符', 'wild', 'banColor', 0, '🔇', 1, 'red')
  ];

  var DECK_LIGHT = [
    cc('闪电 +1', 'yellow', 'drawN', 1, '⚡', 2),
    cc('急停', 'wild', 'skip', 0, '🛑', 2)
  ];

  /* ---------------------- 6+ 套预设 ---------------------- */
  UNO.PRESETS = [
    {
      id: 'classic',
      name: '经典标准局',
      icon: '🎴',
      desc: '原汁原味 108 张，7 张起手，200 分制',
      settings: {
        handSize: 7, targetScore: 200, turnTime: 20,
        stack2: true, stack4: true, challengeWild4: false, drawPlayable: true,
        sevenZero: false, reverseAsSkip: true, forcePlay: false,
        unoPenalty: true, hideHands: false, chaos: false,
        hintHighlight: true, sfx: true, animSpeed: 1
      },
      customEnabled: false,
      customCards: []
    },
    {
      id: 'lightning',
      name: '极速闪电局',
      icon: '⚡',
      desc: '3 张起手、摸到就出、10 秒限时、100 分一局',
      settings: {
        handSize: 3, targetScore: 100, turnTime: 10,
        stack2: true, stack4: true, drawPlayable: true, forcePlay: true,
        animSpeed: 2, hintHighlight: true, unoPenalty: true
      },
      customEnabled: true,
      customCards: DECK_LIGHT
    },
    {
      id: 'bomb',
      name: '炸弹狂欢',
      icon: '💥',
      desc: '+2/+4 无限叠加，惩罚牌满天飞，300 分制',
      settings: {
        handSize: 7, targetScore: 300, turnTime: 30,
        stack2: true, stack4: true, challengeWild4: true,
        drawPlayable: false, forcePlay: false, animSpeed: 1.2
      },
      customEnabled: true,
      customCards: DECK_BOMB
    },
    {
      id: 'curse',
      name: '诅咒之夜',
      icon: '🕯',
      desc: '大量自定义负面效果牌，暗牌模式，随时被清零',
      settings: {
        handSize: 10, targetScore: 500, turnTime: 25,
        stack2: true, stack4: true, drawPlayable: true,
        hideHands: true, sevenZero: true, unoPenalty: true, animSpeed: 0.8
      },
      customEnabled: true,
      customCards: DECK_CURSE
    },
    {
      id: 'newbie',
      name: '新手友好',
      icon: '🌱',
      desc: '不限时、可出牌高亮提示、+4 可质疑、慢动画',
      settings: {
        handSize: 7, targetScore: 100, turnTime: 0,
        stack2: false, stack4: false, challengeWild4: true,
        drawPlayable: true, forcePlay: false, hintHighlight: true,
        unoPenalty: true, hideHands: false, animSpeed: 0.5
      },
      customEnabled: false,
      customCards: []
    },
    {
      id: 'chaos',
      name: '混沌模式',
      icon: '🌀',
      desc: '每次出牌都可能随机触发额外事件，规则随时崩坏',
      settings: {
        handSize: 7, targetScore: 300, turnTime: 15,
        stack2: true, stack4: true, drawPlayable: true,
        chaos: true, sevenZero: true, animSpeed: 1.5
      },
      customEnabled: true,
      customCards: DECK_CHAOS
    },
    {
      id: 'hardcore',
      name: '硬核 1v9 地狱',
      icon: '🔥',
      desc: '9 名困难 AI 围攻，暗牌 + 强制出牌 + 30 秒限时',
      settings: {
        handSize: 7, targetScore: 500, turnTime: 30,
        stack2: true, stack4: true, challengeWild4: true,
        drawPlayable: false, forcePlay: true, sevenZero: true,
        unoPenalty: true, hideHands: true, chaos: false, animSpeed: 2
      },
      customEnabled: true,
      customCards: DECK_BOMB,
      players: { humanCount: 1, aiCount: 9, aiLevel: 'hard' }
    }
  ];

  UNO.getPreset = function (id) {
    for (var i = 0; i < UNO.PRESETS.length; i++) {
      if (UNO.PRESETS[i].id === id) return UNO.PRESETS[i];
    }
    return null;
  };

  /* ---------------------- 名字池 ---------------------- */
  UNO.AI_NAMES = ['小马', '阿呆', '橙子', '铁蛋', 'Nova', '豆豆', 'Kyro', '雪球', '锤子'];
  UNO.HUMAN_NAMES = ['玩家 1', '玩家 2', '玩家 3', '玩家 4', '玩家 5', '玩家 6', '玩家 7', '玩家 8', '玩家 9', '玩家 10'];

  UNO.AI_LEVELS = [
    { v: 'easy', label: '简单' },
    { v: 'normal', label: '普通' },
    { v: 'hard', label: '困难' }
  ];

  /* ---------------------- 颜色常量 ---------------------- */
  UNO.COLORS = ['red', 'yellow', 'green', 'blue'];
  UNO.COLOR_LABEL = { red: '红', yellow: '黄', green: '绿', blue: '蓝', wild: '万能' };

})(window);
