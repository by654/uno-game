/* ===================================================================
   custom-cards.js —— 自定义卡牌存储 / 校验 / 牌堆构建
   全局命名空间：window.UNO
   =================================================================== */
(function (global) {
  'use strict';

  var UNO = global.UNO = global.UNO || {};

  var STORAGE_KEY = 'uno_custom_cards_v1';
  var uidSeed = 0;

  UNO.nextUid = function (prefix) {
    uidSeed += 1;
    return (prefix || 'c') + uidSeed + '_' + Math.random().toString(36).slice(2, 7);
  };

  /* ---------------------- 校验与规范化 ---------------------- */
  var VALID_COLORS = ['red', 'yellow', 'green', 'blue', 'wild'];
  var VALID_EFFECTS = (UNO.EFFECT_DEFS || []).map(function (e) { return e.key; });

  function clampInt(v, min, max, def) {
    var n = parseInt(v, 10);
    if (isNaN(n)) n = def;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  function normalizeCard(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || '自定义牌').trim().slice(0, 10) || '自定义牌';
    var color = VALID_COLORS.indexOf(raw.color) >= 0 ? raw.color : 'wild';
    var effect = VALID_EFFECTS.indexOf(raw.effect) >= 0 ? raw.effect : 'drawN';
    var icon = String(raw.icon || '✦').slice(0, 2) || '✦';
    var def = null;
    for (var i = 0; i < UNO.EFFECT_DEFS.length; i++) {
      if (UNO.EFFECT_DEFS[i].key === effect) { def = UNO.EFFECT_DEFS[i]; break; }
    }
    var amount = clampInt(raw.amount, 0, 7, def && def.defAmount != null ? def.defAmount : 0);
    if (effect === 'doublePenalty') amount = clampInt(amount, 2, 3, 2);
    if (effect === 'trimHand') amount = 0;
    if (effect === 'drawN') amount = clampInt(amount, 1, 7, 2);
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : UNO.nextUid('x'),
      name: name,
      color: color,
      effect: effect,
      amount: amount,
      icon: icon,
      count: clampInt(raw.count, 1, 8, 1),
      banColor: VALID_COLORS.indexOf(raw.banColor) >= 0 && raw.banColor !== 'wild' ? raw.banColor : 'red'
    };
  }

  /* ---------------------- 本地存储 ---------------------- */
  var CustomCards = {
    list: [],

    load: function () {
      var arr = [];
      try {
        var raw = global.localStorage ? global.localStorage.getItem(STORAGE_KEY) : null;
        if (raw) {
          var data = JSON.parse(raw);
          arr = Array.isArray(data) ? data : (data && Array.isArray(data.cards) ? data.cards : []);
        }
      } catch (e) {
        arr = [];
      }
      this.list = arr.map(normalizeCard).filter(Boolean);
      return this.list;
    },

    save: function () {
      try {
        if (global.localStorage) {
          global.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.list));
        }
      } catch (e) { /* 存储不可用时静默降级 */ }
      return this.list;
    },

    add: function (raw) {
      var card = normalizeCard(raw);
      if (!card) return null;
      card.id = UNO.nextUid('x');
      this.list.push(card);
      this.save();
      return card;
    },

    update: function (id, raw) {
      for (var i = 0; i < this.list.length; i++) {
        if (this.list[i].id === id) {
          var card = normalizeCard(raw);
          if (!card) return false;
          card.id = id;
          this.list[i] = card;
          this.save();
          return true;
        }
      }
      return false;
    },

    remove: function (id) {
      var idx = -1;
      for (var i = 0; i < this.list.length; i++) {
        if (this.list[i].id === id) { idx = i; break; }
      }
      if (idx < 0) return false;
      this.list.splice(idx, 1);
      this.save();
      return true;
    },

    clear: function () {
      this.list = [];
      this.save();
    },

    replaceAll: function (arr) {
      this.list = (Array.isArray(arr) ? arr : []).map(normalizeCard).filter(Boolean);
      this.save();
      return this.list;
    },

    find: function (id) {
      for (var i = 0; i < this.list.length; i++) {
        if (this.list[i].id === id) return this.list[i];
      }
      return null;
    },

    totalOf: function (def) {
      var n = 0;
      for (var i = 0; i < this.list.length; i++) {
        if (def && this.list[i].id !== def.id) continue;
        n += this.list[i].count;
      }
      return n;
    }
  };

  /* ---------------------- 导入导出 ---------------------- */
  CustomCards.exportJSON = function () {
    return JSON.stringify({ version: 1, cards: this.list }, null, 2);
  };

  CustomCards.importJSON = function (text) {
    var data = JSON.parse(text);
    var arr = Array.isArray(data) ? data : (data && Array.isArray(data.cards) ? data.cards : null);
    if (!arr) throw new Error('JSON 结构不正确，应为数组或 { cards: [...] }');
    var cleaned = arr.map(normalizeCard).filter(Boolean);
    if (!cleaned.length) throw new Error('未解析到有效的自定义牌');
    this.list = cleaned;
    this.save();
    return cleaned;
  };

  UNO.CustomCards = CustomCards;
  UNO.normalizeCustomCard = normalizeCard;

  /* ---------------------- 牌堆构建 ---------------------- */
  function makeCard(kind, color, value, display) {
    return {
      uid: UNO.nextUid('s'),
      kind: kind,
      color: color,
      value: value == null ? null : value,
      name: display.name,
      center: display.center,
      corner: display.corner,
      effect: null,
      amount: 0,
      banColor: null
    };
  }

  UNO.buildStandardDeck = function () {
    var deck = [];
    var colors = UNO.COLORS;
    var ci, v, copy;

    for (ci = 0; ci < colors.length; ci++) {
      var c = colors[ci];
      // 0 只有一张
      deck.push(makeCard('number', c, 0, { name: '0', center: '0', corner: '0' }));
      for (v = 1; v <= 9; v++) {
        for (copy = 0; copy < 2; copy++) {
          deck.push(makeCard('number', c, v, { name: String(v), center: String(v), corner: String(v) }));
        }
      }
      for (copy = 0; copy < 2; copy++) {
        deck.push(makeCard('skip', c, null, { name: '跳过', center: '⊘', corner: '⊘' }));
        deck.push(makeCard('reverse', c, null, { name: '反转', center: '⇄', corner: '⇄' }));
        deck.push(makeCard('draw2', c, null, { name: '+2', center: '+2', corner: '+2' }));
      }
    }
    for (copy = 0; copy < 4; copy++) {
      deck.push(makeCard('wild', 'wild', null, { name: '变色', center: '变', corner: 'W' }));
      deck.push(makeCard('wild4', 'wild', null, { name: '+4 变色', center: '+4', corner: '+4' }));
    }
    return deck;
  };

  UNO.buildCustomCards = function (list) {
    var out = [];
    (list || []).forEach(function (def) {
      for (var i = 0; i < def.count; i++) {
        out.push({
          uid: UNO.nextUid('u'),
          kind: 'custom',
          color: def.color,
          value: null,
          name: def.name,
          center: def.icon,
          corner: def.icon,
          effect: def.effect,
          amount: def.amount,
          banColor: def.banColor || 'red',
          customId: def.id
        });
      }
    });
    return out;
  };

  UNO.buildDeck = function (customList, customEnabled) {
    var deck = UNO.buildStandardDeck();
    if (customEnabled && customList && customList.length) {
      deck = deck.concat(UNO.buildCustomCards(customList));
    }
    return deck;
  };

  /* ---------------------- 展示辅助 ---------------------- */
  UNO.isNumericFace = function (card) {
    return /^(\d|\+\d)$/.test(String(card.center || ''));
  };

  UNO.cardText = function (card) {
    if (!card) return '';
    if (card.kind === 'custom') {
      return card.name + '（' + (UNO.COLOR_LABEL[card.color] || '万能') + '·' + effectLabel(card.effect) + '）';
    }
    return card.name;
  };

  function effectLabel(key) {
    for (var i = 0; i < UNO.EFFECT_DEFS.length; i++) {
      if (UNO.EFFECT_DEFS[i].key === key) return UNO.EFFECT_DEFS[i].label;
    }
    return key;
  }
  UNO.effectLabel = effectLabel;

})(window);
