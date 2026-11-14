/* ===================================================================
   ui.js —— 界面渲染与交互（设置屏 / 自定义卡牌 / 游戏屏 / 结算屏）
   全局命名空间：window.UNO
   =================================================================== */
(function (global) {
  'use strict';

  var UNO = global.UNO = global.UNO || {};
  var doc = global.document;

  function $(id) { return doc.getElementById(id); }

  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  var state = {
    settings: UNO.cloneSettings(null),
    players: [],
    presetId: null,
    customEnabled: false,
    game: null,
    soundOn: true
  };

  /* ============================ 音效 ============================ */
  var AudioCtx = global.AudioContext || global.webkitAudioContext;
  var ac = null;

  function audio() {
    if (!AudioCtx) return null;
    if (!ac) {
      try { ac = new AudioCtx(); } catch (e) { ac = null; }
    }
    if (ac && ac.state === 'suspended' && ac.resume) ac.resume();
    return ac;
  }

  function tone(freq, dur, type, vol, delay) {
    if (!state.settings.sfx || !state.soundOn) return;
    var ctx = audio();
    if (!ctx) return;
    var t0 = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  var SFX = {
    play: function () { tone(520, 0.1, 'triangle', 0.1); tone(720, 0.1, 'triangle', 0.08, 0.06); },
    draw: function () { tone(300, 0.12, 'sine', 0.09); },
    skip: function () { tone(240, 0.16, 'sawtooth', 0.08); },
    reverse: function () { tone(420, 0.1, 'square', 0.06); tone(300, 0.12, 'square', 0.06, 0.08); },
    wild: function () { tone(600, 0.1, 'sine', 0.09); tone(760, 0.1, 'sine', 0.09, 0.08); tone(900, 0.12, 'sine', 0.08, 0.16); },
    penalty: function () { tone(180, 0.24, 'sawtooth', 0.1); },
    uno: function () { tone(660, 0.1, 'square', 0.09); tone(880, 0.16, 'square', 0.09, 0.1); },
    win: function () {
      [523, 659, 784, 1046].forEach(function (f, i) { tone(f, 0.18, 'triangle', 0.1, i * 0.12); });
    },
    tap: function () { tone(880, 0.05, 'sine', 0.05); }
  };

  /* ============================ 提示条 ============================ */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }

  /* ============================ 浮层 ============================ */
  function closeOverlay() {
    var ov = $('overlay');
    var card = $('overlay-card');
    if (card) clear(card);
    if (ov) ov.hidden = true;
  }

  function openOverlay(builder) {
    var ov = $('overlay');
    var card = $('overlay-card');
    if (!ov || !card) return;
    clear(card);
    builder(card);
    ov.hidden = false;
  }

  function askColor(playerIdx, cb) {
    var p = state.game && state.game.players[playerIdx];
    openOverlay(function (card) {
      card.appendChild(el('h3', null, '选择颜色'));
      card.appendChild(el('p', null, (p ? p.name : '玩家') + ' 出了万能牌，请指定接下来的颜色'));
      var wrap = el('div', 'color-picker');
      UNO.COLORS.forEach(function (c) {
        var b = el('button', 'c-' + c, UNO.COLOR_LABEL[c] + '色');
        b.type = 'button';
        b.onclick = function () { SFX.tap(); closeOverlay(); cb(c); };
        wrap.appendChild(b);
      });
      card.appendChild(wrap);
    });
  }

  function askTarget(playerIdx, list, cb) {
    var g = state.game;
    openOverlay(function (card) {
      card.appendChild(el('h3', null, '7-0 规则：选择换牌对象'));
      card.appendChild(el('p', null, '出 7 时可以与你选择的玩家交换整副手牌'));
      var wrap = el('div', 'target-list');
      list.forEach(function (i) {
        var p = g.players[i];
        var b = el('button', null, p.name);
        b.type = 'button';
        var small = el('small', null, p.hand.length + ' 张');
        b.appendChild(small);
        b.onclick = function () { SFX.tap(); closeOverlay(); cb(i); };
        wrap.appendChild(b);
      });
      card.appendChild(wrap);
    });
  }

  function askChallenge(playerIdx, cb) {
    openOverlay(function (card) {
      card.appendChild(el('h3', null, '对方打出了 +4'));
      card.appendChild(el('p', null,
        '你可以选择「质疑」：如果对方手上还有当时的颜色，他改罚摸 4 张；否则你要摸 6 张。'));
      var wrap = el('div', 'ov-actions');
      var yes = el('button', 'btn primary', '质疑');
      yes.type = 'button';
      yes.onclick = function () { SFX.tap(); closeOverlay(); cb(true); };
      var no = el('button', 'btn ghost', '接受惩罚');
      no.type = 'button';
      no.onclick = function () { SFX.tap(); closeOverlay(); cb(false); };
      wrap.appendChild(yes);
      wrap.appendChild(no);
      card.appendChild(wrap);
    });
  }

  function askReady(playerIdx, cb) {
    var g = state.game;
    var p = g && g.players[playerIdx];
    openOverlay(function (card) {
      card.appendChild(el('h3', null, '请交给下一位玩家'));
      card.appendChild(el('p', null,
        '现在是「' + (p ? p.name : '') + '」的回合，请把设备交给 TA，确认后查看手牌。'));
      var wrap = el('div', 'ov-actions');
      var ok = el('button', 'btn primary', '我准备好了');
      ok.type = 'button';
      ok.onclick = function () {
        SFX.tap();
        closeOverlay();
        cb();
      };
      wrap.appendChild(ok);
      card.appendChild(wrap);
    });
  }

  function showUnoBanner(playerIdx) {
    var g = state.game;
    var name = (g && g.players[playerIdx]) ? g.players[playerIdx].name : '玩家';
    SFX.uno();
    openOverlay(function (card) {
      card.appendChild(el('h3', null, 'UNO！'));
      card.appendChild(el('p', null, name + ' 只剩 1 张牌了'));
      var wrap = el('div', 'ov-actions');
      var ok = el('button', 'btn uno', '知道了');
      ok.type = 'button';
      ok.onclick = function () { closeOverlay(); };
      wrap.appendChild(ok);
      card.appendChild(wrap);
      setTimeout(function () {
        var o = $('overlay');
        if (o && !o.hidden) closeOverlay();
      }, 1500);
    });
  }

  /* ============================ 设置屏：玩家 ============================ */
  function defaultPlayers() {
    var list = [{ name: UNO.HUMAN_NAMES[0], isAI: false, aiLevel: 'normal' }];
    for (var i = 0; i < 3; i++) {
      list.push({ name: UNO.AI_NAMES[i % UNO.AI_NAMES.length], isAI: true, aiLevel: 'normal' });
    }
    return list;
  }

  function usedAINames() {
    var n = {};
    state.players.forEach(function (p) { if (p.isAI) n[p.name] = true; });
    return n;
  }

  function nextAIName() {
    var used = usedAINames();
    for (var i = 0; i < UNO.AI_NAMES.length; i++) {
      if (!used[UNO.AI_NAMES[i]]) return UNO.AI_NAMES[i];
    }
    return 'AI-' + (state.players.length + 1);
  }

  function nextHumanName() {
    var used = {};
    state.players.forEach(function (p) { if (!p.isAI) used[p.name] = true; });
    for (var i = 0; i < UNO.HUMAN_NAMES.length; i++) {
      if (!used[UNO.HUMAN_NAMES[i]]) return UNO.HUMAN_NAMES[i];
    }
    return '玩家 ' + (state.players.length + 1);
  }

  function renderPlayers() {
    var box = $('player-config');
    if (!box) return;
    clear(box);
    state.players.forEach(function (p, i) {
      var row = el('div', 'pc-row');
      row.appendChild(el('div', 'pc-idx', String(i + 1)));

      var name = doc.createElement('input');
      name.type = 'text';
      name.className = 'pc-name';
      name.maxLength = 8;
      name.value = p.name;
      name.oninput = function () { p.name = name.value.slice(0, 8) || ('玩家 ' + (i + 1)); };
      row.appendChild(name);

      var type = doc.createElement('select');
      [['human', '真人'], ['ai', 'AI']].forEach(function (o) {
        var opt = doc.createElement('option');
        opt.value = o[0];
        opt.textContent = o[1];
        if ((o[0] === 'ai') === p.isAI) opt.selected = true;
        type.appendChild(opt);
      });
      type.onchange = function () {
        p.isAI = type.value === 'ai';
        if (p.isAI) {
          if (UNO.AI_NAMES.indexOf(p.name) < 0) p.name = nextAIName();
        } else {
          if (UNO.AI_NAMES.indexOf(p.name) >= 0) p.name = nextHumanName();
        }
        renderPlayers();
      };
      row.appendChild(type);

      var lv = doc.createElement('select');
      UNO.AI_LEVELS.forEach(function (o) {
        var opt = doc.createElement('option');
        opt.value = o.v;
        opt.textContent = o.label;
        if (o.v === p.aiLevel) opt.selected = true;
        lv.appendChild(opt);
      });
      lv.disabled = !p.isAI;
      lv.onchange = function () { p.aiLevel = lv.value; };
      row.appendChild(lv);

      var del = el('button', 'pc-del', '✕');
      del.type = 'button';
      del.onclick = function () {
        if (state.players.length <= 2) { toast('至少保留 2 名玩家'); return; }
        state.players.splice(i, 1);
        renderPlayers();
      };
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  /* ============================ 设置屏：设置项 ============================ */
  function renderSettings() {
    var box = $('settings-form');
    if (!box) return;
    clear(box);
    UNO.SETTING_DEFS.forEach(function (def) {
      var row = el('div', 'set-row');
      var label = el('div', 'set-label', def.label);
      if (def.desc) label.appendChild(el('em', null, def.desc));
      row.appendChild(label);

      var ctrl = el('div', 'set-ctrl');
      var val = state.settings[def.key];

      if (def.type === 'range') {
        var range = doc.createElement('input');
        range.type = 'range';
        range.min = def.min;
        range.max = def.max;
        range.step = def.step;
        range.value = val;
        var show = el('span', 'range-val', val + (def.unit || ''));
        range.oninput = function () {
          state.settings[def.key] = parseFloat(range.value);
          show.textContent = range.value + (def.unit || '');
          updateDeckSummary();
        };
        ctrl.appendChild(range);
        ctrl.appendChild(show);
      } else if (def.type === 'select') {
        var sel = doc.createElement('select');
        def.options.forEach(function (o) {
          var opt = doc.createElement('option');
          opt.value = String(o.v);
          opt.textContent = o.label;
          if (Number(o.v) === Number(val)) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.onchange = function () {
          state.settings[def.key] = parseFloat(sel.value);
          updateDeckSummary();
        };
        ctrl.appendChild(sel);
      } else {
        var sw = el('div', 'switch' + (val ? ' on' : ''));
        sw.setAttribute('role', 'switch');
        sw.onclick = function () {
          var next = !state.settings[def.key];
          state.settings[def.key] = next;
          if (next) sw.classList.add('on'); else sw.classList.remove('on');
          SFX.tap();
          updateDeckSummary();
        };
        ctrl.appendChild(sw);
      }
      row.appendChild(ctrl);
      box.appendChild(row);
    });
  }

  /* ============================ 设置屏：预设 ============================ */
  function renderPresets() {
    var box = $('preset-grid');
    if (!box) return;
    clear(box);
    UNO.PRESETS.forEach(function (ps) {
      var card = el('button', 'preset-card' + (state.presetId === ps.id ? ' is-on' : ''));
      card.type = 'button';
      var name = el('div', 'p-name');
      name.appendChild(el('span', null, ps.icon || '🎴'));
      name.appendChild(el('span', null, ps.name));
      card.appendChild(name);
      card.appendChild(el('div', 'p-desc', ps.desc || ''));
      if (ps.customCards && ps.customCards.length) {
        card.appendChild(el('span', 'p-tag', '+' + ps.customCards.length + ' 牌'));
      }
      card.onclick = function () { applyPreset(ps); };
      box.appendChild(card);
    });
  }

  function applyPreset(ps) {
    SFX.tap();
    state.presetId = ps.id;
    state.settings = UNO.cloneSettings(ps.settings);
    state.customEnabled = !!ps.customEnabled;
    if (ps.customCards && ps.customCards.length) {
      UNO.CustomCards.replaceAll(ps.customCards);
    }
    if (ps.players) {
      var list = [];
      for (var h = 0; h < (ps.players.humanCount || 1); h++) {
        list.push({ name: UNO.HUMAN_NAMES[h] || ('玩家 ' + (h + 1)), isAI: false, aiLevel: 'normal' });
      }
      for (var a = 0; a < (ps.players.aiCount || 3); a++) {
        list.push({ name: UNO.AI_NAMES[a % UNO.AI_NAMES.length], isAI: true, aiLevel: ps.players.aiLevel || 'normal' });
      }
      state.players = list.slice(0, 10);
    }
    renderPresets();
    renderSettings();
    renderPlayers();
    renderCustomList();
    syncCustomControls();
    updateDeckSummary();
    toast('已应用预设：' + ps.name);
  }

  /* ============================ 设置屏：自定义卡牌 ============================ */
  function effectDef(key) {
    for (var i = 0; i < UNO.EFFECT_DEFS.length; i++) {
      if (UNO.EFFECT_DEFS[i].key === key) return UNO.EFFECT_DEFS[i];
    }
    return UNO.EFFECT_DEFS[0];
  }

  function renderCustomList() {
    var box = $('custom-list');
    if (!box) return;
    clear(box);
    var list = UNO.CustomCards.list;
    if (!list.length) {
      box.appendChild(el('div', 'cc-empty', '还没有自定义牌。展开下方「新建自定义牌」开始设计属于你的牌吧。'));
      return;
    }
    list.forEach(function (card) {
      var item = el('div', 'cc-item');
      var chip = el('div', 'cc-chip' + (card.color === 'wild' ? ' wild' : ''),
        card.icon || '✦');
      if (card.color !== 'wild') {
        chip.style.background = 'var(--c-' + card.color + ')';
      }
      item.appendChild(chip);

      var meta = el('div', 'cc-meta');
      meta.appendChild(el('div', 'cc-title', card.name + ' ×' + card.count));
      var def = effectDef(card.effect);
      var sub = (UNO.COLOR_LABEL[card.color] || '万能') + ' · ' + def.label;
      if (def.needAmount && card.amount) sub += ' ' + card.amount;
      if (card.effect === 'banColor') sub += '（' + (UNO.COLOR_LABEL[card.banColor] || '红') + '色）';
      meta.appendChild(el('div', 'cc-sub', sub));
      item.appendChild(meta);

      var btns = el('div', 'cc-btns');
      var edit = el('button', null, '✎');
      edit.type = 'button';
      edit.title = '编辑';
      edit.onclick = function () { fillCustomForm(card); };
      var rm = el('button', null, '🗑');
      rm.type = 'button';
      rm.title = '删除';
      rm.onclick = function () {
        UNO.CustomCards.remove(card.id);
        renderCustomList();
        updateDeckSummary();
        toast('已删除：' + card.name);
      };
      btns.appendChild(edit);
      btns.appendChild(rm);
      item.appendChild(btns);
      box.appendChild(item);
    });
  }

  function initCustomForm() {
    var sel = $('cc-effect');
    if (!sel) return;
    clear(sel);
    UNO.EFFECT_DEFS.forEach(function (d) {
      var opt = doc.createElement('option');
      opt.value = d.key;
      opt.textContent = d.label;
      sel.appendChild(opt);
    });
    sel.onchange = function () { syncCustomFormFields(); };
    syncCustomFormFields();

    $('custom-form').onsubmit = function (ev) {
      ev.preventDefault();
      submitCustom();
    };
    $('cc-cancel').onclick = function () { resetCustomForm(); };
  }

  function syncCustomFormFields() {
    var effect = $('cc-effect').value;
    var def = effectDef(effect);
    var amountWrap = $('cc-amount-wrap');
    var banWrap = $('cc-bancolor-wrap');
    if (amountWrap) amountWrap.hidden = !def.needAmount;
    if (banWrap) banWrap.hidden = !def.needColor;
    if (def.needAmount) {
      var amt = $('cc-amount');
      amt.min = def.amountMin != null ? def.amountMin : 1;
      amt.max = def.amountMax != null ? def.amountMax : 7;
      if (Number(amt.value) < Number(amt.min)) amt.value = def.defAmount != null ? def.defAmount : amt.min;
    }
    var desc = $('cc-effect-desc');
    if (desc) desc.textContent = def.desc || '';
  }

  function fillCustomForm(card) {
    $('cc-edit-id').value = card.id;
    $('cc-name').value = card.name;
    $('cc-color').value = card.color;
    $('cc-effect').value = card.effect;
    $('cc-amount').value = card.amount || 2;
    $('cc-bancolor').value = card.banColor || 'red';
    $('cc-icon').value = card.icon || '✦';
    $('cc-count').value = card.count || 1;
    syncCustomFormFields();
    $('cc-submit').textContent = '保存修改';
    $('cc-form-summary').textContent = '编辑：' + card.name;
    var wrap = doc.querySelector('.custom-form-wrap');
    if (wrap) wrap.open = true;
    var form = $('custom-form');
    if (form && form.scrollIntoView) form.scrollIntoView({ block: 'center' });
  }

  function resetCustomForm() {
    $('cc-edit-id').value = '';
    $('cc-name').value = '';
    $('cc-color').value = 'wild';
    $('cc-effect').value = 'drawN';
    $('cc-amount').value = 2;
    $('cc-bancolor').value = 'red';
    $('cc-icon').value = '✦';
    $('cc-count').value = 1;
    $('cc-submit').textContent = '保存卡牌';
    $('cc-form-summary').textContent = '新建自定义牌';
    syncCustomFormFields();
  }

  function submitCustom() {
    var id = $('cc-edit-id').value;
    var raw = {
      name: $('cc-name').value,
      color: $('cc-color').value,
      effect: $('cc-effect').value,
      amount: parseInt($('cc-amount').value, 10),
      banColor: $('cc-bancolor').value,
      icon: $('cc-icon').value,
      count: parseInt($('cc-count').value, 10)
    };
    if (!raw.name || !raw.name.trim()) { toast('请填写卡牌名称'); return; }
    if (id) {
      UNO.CustomCards.update(id, raw);
      toast('已保存修改');
    } else {
      UNO.CustomCards.add(raw);
      toast('已添加自定义牌');
    }
    state.customEnabled = true;
    syncCustomControls();
    resetCustomForm();
    renderCustomList();
    updateDeckSummary();
    SFX.tap();
  }

  function syncCustomControls() {
    var box = $('cc-enabled');
    if (box) box.checked = !!state.customEnabled;
  }

  function updateDeckSummary() {
    var node = $('deck-summary');
    if (!node) return;
    var total = UNO.buildDeck(UNO.CustomCards.list, state.customEnabled).length;
    var custom = state.customEnabled ? UNO.buildCustomCards(UNO.CustomCards.list).length : 0;
    node.textContent = '牌堆：标准 108 张' +
      (custom ? ' + 自定义 ' + custom + ' 张' : '') +
      ' = 共 ' + total + ' 张 · 玩家 ' + state.players.length + ' 人';
  }

  function exportCustom() {
    var text = UNO.CustomCards.exportJSON();
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = 'uno-custom-cards.json';
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    toast('已导出 JSON');
  }

  function importCustom(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var n = UNO.CustomCards.importJSON(String(reader.result));
        renderCustomList();
        updateDeckSummary();
        toast('导入成功，共 ' + (n && n.length ? n.length : UNO.CustomCards.list.length) + ' 张自定义牌');
      } catch (e) {
        toast('导入失败：JSON 格式不正确');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

/* ============================ 卡牌 DOM ============================ */
  function buildCardNode(card, opt) {
    opt = opt || {};
    var node = el('div', 'card color-' + (card.color || 'wild') +
      (opt.small ? ' small' : '') + (opt.back ? ' back' : ''));
    if (opt.back) {
      var face = el('div', 'back-face');
      var s = el('span', null, 'UNO');
      face.appendChild(s);
      node.appendChild(face);
      return node;
    }
    if (opt.uid) node.setAttribute('data-uid', opt.uid);

    var tl = el('div', 'corner tl', card.corner != null ? card.corner : '?');
    var br = el('div', 'corner br', card.corner != null ? card.corner : '?');
    var oval = el('div', 'oval');
    var center = el('div', 'center' + (UNO.isNumericFace(card) ? '' : ' icon'),
      card.center != null ? card.center : '?');
    oval.appendChild(center);
    node.appendChild(tl);
    node.appendChild(oval);
    node.appendChild(br);
    if (card.kind === 'custom' && card.name) node.title = UNO.cardText(card);
    else node.title = card.name || '';
    return node;
  }

  function switchScreen(name) {
    ['setup', 'game', 'result'].forEach(function (k) {
      var s = $('screen-' + k);
      if (s) {
        if (k === name) s.classList.add('is-active');
        else s.classList.remove('is-active');
      }
    });
  }

  /* ============================ 游戏屏渲染 ============================ */
  function visibleHumanIndex() {
    var g = state.game;
    if (!g) return -1;
    var cur = g.players[g.currentPlayer];
    if (cur && !cur.isAI) return g.currentPlayer;
    if (g.humanCount() === 1) {
      for (var i = 0; i < g.players.length; i++) if (!g.players[i].isAI) return i;
    }
    return -1;
  }

  function renderGame() {
    var g = state.game;
    if (!g) return;

    var roundNode = $('hud-round');
    if (roundNode) roundNode.textContent = '第 ' + (g.roundIndex + 1) + ' 局';

    var colorNode = $('hud-color');
    if (colorNode) {
      clear(colorNode);
      var i = el('i', g.currentColor);
      colorNode.appendChild(i);
      colorNode.appendChild(el('span', null, (UNO.COLOR_LABEL[g.currentColor] || '') + '色'));
    }

    var dirNode = $('hud-dir');
    if (dirNode) dirNode.textContent = '方向 ' + (g.direction > 0 ? '↻' : '↺');

    var ring = $('direction-ring');
    if (ring) {
      clear(ring);
      ring.appendChild(el('span', null, g.direction > 0 ? '↻' : '↺'));
      if (g.direction > 0) ring.classList.remove('rev'); else ring.classList.add('rev');
    }

    var deckNode = $('hud-deck');
    if (deckNode) deckNode.textContent = '牌堆 ' + g.deck.length;

    var scoreNode = $('hud-score');
    if (scoreNode) {
      scoreNode.textContent = g.settings.targetScore > 0
        ? '目标 ' + g.settings.targetScore + ' 分'
        : '单局定胜负';
    }

    var drawCount = $('draw-count');
    if (drawCount) drawCount.textContent = String(g.deck.length);

    var penalty = $('penalty-badge');
    if (penalty) {
      if (g.pendingDraw > 0) {
        penalty.hidden = false;
        penalty.textContent = '待摸 +' + g.pendingDraw;
      } else {
        penalty.hidden = true;
      }
    }

    var banner = $('turn-banner');
    if (banner) {
      var cp = g.players[g.currentPlayer];
      if (g.roundOver) banner.textContent = '本局结束';
      else banner.textContent = (cp ? cp.name : '') + (cp && cp.isAI ? ' 思考中…' : ' 的回合');
    }

    var discard = $('discard-pile');
    if (discard) {
      clear(discard);
      var top = g.topCard();
      if (top) {
        var tn = buildCardNode(top, {});
        tn.classList.add('played-pop');
        discard.appendChild(tn);
      }
    }

    renderOpponents();
    renderHand();
    updateActionButtons();
  }

  function renderOpponents() {
    var g = state.game;
    var box = $('opponents');
    if (!box || !g) return;
    clear(box);
    var active = visibleHumanIndex();
    g.players.forEach(function (p, i) {
      if (i === active) return;
      var card = el('div', 'opp-card' + (g.currentPlayer === i && !g.roundOver ? ' is-turn' : ''));
      var nameRow = el('div', 'o-name');
      nameRow.appendChild(el('span', null, p.name));
      if (p.isAI) nameRow.appendChild(el('span', 'tag-ai', p.aiLevel === 'hard' ? '困难' : (p.aiLevel === 'easy' ? '简单' : '普通')));
      if (p.saidUno && p.hand.length <= 1) nameRow.appendChild(el('span', 'tag-uno', 'UNO'));
      card.appendChild(nameRow);

      var meta = el('div', 'o-meta');
      meta.appendChild(el('span', null,
        g.settings.hideHands ? '手牌 ?' : '手牌 ' + p.hand.length));
      meta.appendChild(el('span', 'o-score', (g.totals[i] || 0) + ' 分'));
      card.appendChild(meta);

      var cards = el('div', 'o-cards');
      var n = g.settings.hideHands ? Math.min(4, Math.max(1, Math.ceil(p.hand.length / 3))) : Math.min(p.hand.length, 8);
      for (var k = 0; k < n; k++) cards.appendChild(el('div', 'mini'));
      card.appendChild(cards);
      box.appendChild(card);
    });
  }

  function renderHand() {
    var g = state.game;
    var box = $('hand-scroll');
    if (!box || !g) return;
    var scrollLeft = box.scrollLeft;
    clear(box);

    var idx = visibleHumanIndex();
    var nameNode = $('self-name');
    var hintNode = $('self-hint');
    var timerNode = $('self-timer');

    if (idx < 0) {
      if (nameNode) nameNode.textContent = g.humanCount() > 1 ? '等待中' : (g.players[0] ? g.players[0].name : '你');
      var ph = el('div', 'cc-empty', '其他玩家正在行动，请稍候…');
      ph.style.padding = '24px 14px';
      box.appendChild(ph);
      if (hintNode) hintNode.textContent = '';
      if (timerNode) timerNode.textContent = '';
      return;
    }

    var p = g.players[idx];
    var isTurn = g.currentPlayer === idx && !g.roundOver;
    var canPlay = isTurn && (g.awaitingHuman || g.canPassAfterDraw) && !g.roundOver;

    if (nameNode) nameNode.textContent = p.name + (p.isAI ? '（AI）' : '');
    if (timerNode) {
      timerNode.textContent = (isTurn && g.timerLeft > 0) ? g.timerLeft + 's' : '';
    }

    var legal = {};
    if (isTurn) {
      g.getLegalCards(idx).forEach(function (c) { legal[c.uid] = true; });
    }
    var legalCount = Object.keys(legal).length;

    if (hintNode) {
      if (g.roundOver) hintNode.textContent = '本局已结束';
      else if (!isTurn) hintNode.textContent = '等待其他玩家…';
      else if (g.pendingDraw > 0) {
        hintNode.textContent = legalCount > 0
          ? '可用叠牌转移惩罚，或认罚摸 ' + g.pendingDraw + ' 张'
          : '认罚摸 ' + g.pendingDraw + ' 张';
      } else if (g.canPassAfterDraw) hintNode.textContent = '已摸牌，可出这张或选择过牌';
      else if (legalCount > 0) hintNode.textContent = legalCount + ' 张牌可出';
      else hintNode.textContent = '没有可出的牌，请抽牌';
    }

    // 多真人热座：非本人回合显示牌背，避免偷看
    var hideForHotseat = g.humanCount() > 1 && !isTurn;

    p.hand.forEach(function (card) {
      if (hideForHotseat) {
        var back = buildCardNode(card, { back: true });
        box.appendChild(back);
        return;
      }
      var node = buildCardNode(card, { uid: card.uid });
      var ok = !!legal[card.uid];
      if (isTurn && g.settings.hintHighlight) {
        if (ok) node.classList.add('playable');
        else node.classList.add('dim');
      } else if (isTurn && !ok) {
        node.classList.add('dim');
      }
      node.onclick = function () { handleCardClick(idx, card, canPlay, ok); };
      box.appendChild(node);
    });

    if (g.humanCount() === 1) setTimeout(function () { box.scrollLeft = scrollLeft; }, 0);
    else box.scrollLeft = 0;
  }

  function handleCardClick(idx, card, canPlay, legalFlag) {
    var g = state.game;
    if (!g || g.roundOver) return;
    if (!canPlay) {
      toast(g.currentPlayer === idx ? '请稍候…' : '还没轮到你出牌');
      return;
    }
    if (!legalFlag) {
      SFX.skip();
      toast('这张牌现在不能出');
      return;
    }
    SFX.tap();
    if (card.color === 'wild') {
      g.h.askColor(idx, function (color) {
        g.playCard(idx, card.uid, color);
      });
    } else {
      g.playCard(idx, card.uid, g.currentColor);
    }
  }

  function updateActionButtons() {
    var g = state.game;
    if (!g) return;
    var idx = visibleHumanIndex();
    var isTurn = idx >= 0 && g.currentPlayer === idx && !g.roundOver;
    var canAct = isTurn && (g.awaitingHuman || g.canPassAfterDraw);

    var drawBtn = $('btn-draw');
    var passBtn = $('btn-pass');
    var unoBtn = $('btn-uno');

    if (drawBtn) {
      if (g.pendingDraw > 0) drawBtn.textContent = '认罚摸 ' + g.pendingDraw + ' 张';
      else drawBtn.textContent = '抽牌';
      drawBtn.disabled = !canAct || g.canPassAfterDraw;
      drawBtn.onclick = function () { handleDraw(); };
    }
    if (passBtn) {
      passBtn.disabled = !(isTurn && g.canPassAfterDraw);
      passBtn.onclick = function () { handlePass(); };
    }
    if (unoBtn) {
      var p = idx >= 0 ? g.players[idx] : null;
      var eligible = !!(p && isTurn && p.hand.length === 2 && !p.saidUno);
      unoBtn.disabled = !eligible;
      if (eligible) unoBtn.classList.add('pulse'); else unoBtn.classList.remove('pulse');
      unoBtn.onclick = function () { handleUnoCall(); };
    }

    var drawPile = $('draw-pile');
    if (drawPile) {
      drawPile.style.opacity = canAct ? '1' : '0.72';
    }
  }

  function handleDraw() {
    var g = state.game;
    if (!g || g.roundOver) return;
    var idx = visibleHumanIndex();
    if (idx < 0 || g.currentPlayer !== idx) { toast('还没轮到你'); return; }
    if (g.pendingDraw > 0) {
      SFX.penalty();
      g.takePenalty(idx);
      return;
    }
    if (!g.awaitingHuman) { toast('现在不能摸牌'); return; }
    SFX.draw();
    g.humanDraw(idx);
  }

  function handlePass() {
    var g = state.game;
    if (!g || g.roundOver) return;
    var idx = visibleHumanIndex();
    if (idx < 0) return;
    SFX.tap();
    g.humanPass(idx);
  }

  function handleUnoCall() {
    var g = state.game;
    if (!g || g.roundOver) return;
    var idx = visibleHumanIndex();
    if (idx < 0) return;
    g.callUno(idx);
  }

  /* ============================ 结算屏 ============================ */
  function renderResult(result) {
    var g = state.game;
    switchScreen('result');
    var title = $('result-title');
    var sub = $('result-sub');

    if (title) title.textContent = result.matchOver ? '🏆 比赛结束' : '本局结束';
    if (sub) {
      sub.textContent = result.winnerName + ' 获胜，本局获得 ' + result.gained + ' 分' +
        (result.targetScore > 0 ? '（目标 ' + result.targetScore + ' 分）' : '');
    }

    var box = $('result-scores');
    if (box) {
      clear(box);
      var winnerRow = el('div', 'result-row win');
      winnerRow.appendChild(el('div', 'r-idx', '1'));
      var wn = el('div', 'r-name');
      wn.appendChild(el('span', null, result.winnerName));
      wn.appendChild(el('span', 'tag-ai', '本局赢家'));
      winnerRow.appendChild(wn);
      winnerRow.appendChild(el('div', 'r-delta', '+' + result.gained));
      winnerRow.appendChild(el('div', 'r-total', String(result.totals[result.winner])));
      box.appendChild(winnerRow);

      result.scores.forEach(function (s, i) {
        var row = el('div', 'result-row');
        row.appendChild(el('div', 'r-idx', String(i + 2)));
        var nm = el('div', 'r-name');
        nm.appendChild(el('span', null, s.name));
        if (s.isAI) nm.appendChild(el('span', 'tag-ai', 'AI'));
        row.appendChild(nm);
        row.appendChild(el('div', 'r-delta', '-' + s.points));
        row.appendChild(el('div', 'r-total', String(result.totals[s.player])));
        box.appendChild(row);
      });
    }

    var stand = $('result-standings');
    if (stand) {
      clear(stand);
      var order = result.totals.map(function (v, i) { return { i: i, v: v }; })
        .sort(function (a, b) { return b.v - a.v; });
      stand.appendChild(el('div', null, '累计积分排名：'));
      order.forEach(function (o, n) {
        var nm = result.players[o.i] ? result.players[o.i].name : ('玩家 ' + (o.i + 1));
        stand.appendChild(el('div', null, (n + 1) + '. ' + nm + ' — ' + o.v + ' 分'));
      });
      if (result.matchOver) {
        stand.appendChild(el('div', null, '比赛已结束，' + result.winnerName + ' 达到目标分数。'));
      } else if (result.needNext) {
        stand.appendChild(el('div', null, '继续下一局，累计积分先达到 ' + result.targetScore + ' 分者获胜。'));
      }
      if (g && g.logs && g.logs.length) {
        stand.appendChild(el('div', null, '最近记录：' + g.logs.slice(-4).join(' / ')));
      }
    }

    var nextBtn = $('btn-next-round');
    if (nextBtn) {
      nextBtn.textContent = result.matchOver ? '再来一场' : '下一局';
      nextBtn.hidden = false;
    }
    SFX.win();
  }

  /* ============================ 对局启动 ============================ */
  function buildHandlers() {
    return {
      update: function () { renderGame(); },
      event: function (type, data) {
        if (type === 'played') SFX.play();
        else if (type === 'draw') SFX.draw();
        else if (type === 'skip') SFX.skip();
        else if (type === 'reverse') SFX.reverse();
        else if (type === 'wild') SFX.wild();
        else if (type === 'penalty') SFX.penalty();
        else if (type === 'turn') SFX.tap();
      },
      toast: function (msg) { toast(msg); },
      askColor: function (idx, cb) { askColor(idx, cb); },
      askTarget: function (idx, list, cb) { askTarget(idx, list, cb); },
      askChallenge: function (idx, cb) { askChallenge(idx, cb); },
      askReady: function (idx, cb) { askReady(idx, cb); },
      showUno: function (idx) { showUnoBanner(idx); },
      roundEnd: function (result) { renderResult(result); }
    };
  }

  function startGame(opts) {
    opts = opts || {};
    closeOverlay();
    var g;
    try {
      g = new UNO.Game({
        settings: state.settings,
        customCards: UNO.CustomCards.list,
        customEnabled: state.customEnabled,
        players: state.players,
        totals: opts.totals,
        roundIndex: opts.roundIndex || 0
      });
    } catch (e) {
      toast('开局失败：' + e.message);
      return;
    }
    g.h = buildHandlers();
    state.game = g;
    switchScreen('game');
    renderGame();
    g.newRound();
    g.start();
  }

  function openMenu() {
    var g = state.game;
    openOverlay(function (card) {
      card.appendChild(el('h3', null, '对局菜单'));
      card.appendChild(el('p', null,
        g ? ('第 ' + (g.roundIndex + 1) + ' 局 · ' + g.players.length + ' 名玩家 · 牌堆 ' + g.deck.length + ' 张') : ''));
      var wrap = el('div', 'ov-actions');
      var resume = el('button', 'btn primary', '继续对局');
      resume.type = 'button';
      resume.onclick = function () { closeOverlay(); };
      var restart = el('button', 'btn ghost', '重新开局');
      restart.type = 'button';
      restart.onclick = function () {
        closeOverlay();
        if (state.game) { state.game.stopTimer(); state.game.roundOver = true; }
        startGame({ totals: null, roundIndex: 0 });
      };
      var back = el('button', 'btn ghost', '返回设置');
      back.type = 'button';
      back.onclick = function () {
        closeOverlay();
        if (state.game) { state.game.stopTimer(); state.game.roundOver = true; }
        state.game = null;
        switchScreen('setup');
      };
      wrap.appendChild(resume);
      wrap.appendChild(restart);
      wrap.appendChild(back);
      card.appendChild(wrap);
    });
  }

  function toggleFullscreen() {
    var d = doc;
    var root = d.documentElement;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      var req = root.requestFullscreen || root.webkitRequestFullscreen;
      if (req) req.call(root);
    } else {
      var exit = d.exitFullscreen || d.webkitExitFullscreen;
      if (exit) exit.call(d);
    }
  }

  function syncSoundBtn() {
    var b = $('btn-sound');
    if (!b) return;
    b.textContent = (state.settings.sfx && state.soundOn) ? '🔊' : '🔇';
  }

  /* ============================ 初始化 ============================ */
  function bindCommon() {
    var addBtn = $('btn-add-player');
    if (addBtn) addBtn.onclick = function () {
      if (state.players.length >= 10) { toast('最多 10 名玩家'); return; }
      var ai = state.players.filter(function (p) { return p.isAI; }).length;
      var human = state.players.length - ai;
      var makeAI = ai <= human;
      state.players.push({
        name: makeAI ? nextAIName() : nextHumanName(),
        isAI: makeAI,
        aiLevel: 'normal'
      });
      renderPlayers();
      updateDeckSummary();
    };

    var resetBtn = $('btn-reset-players');
    if (resetBtn) resetBtn.onclick = function () {
      state.players = defaultPlayers();
      renderPlayers();
      updateDeckSummary();
    };

    var startBtn = $('btn-start');
    if (startBtn) startBtn.onclick = function () {
      SFX.tap();
      if (state.players.length < 2) { toast('至少需要 2 名玩家'); return; }
      startGame({ totals: null, roundIndex: 0 });
    };

    var ccEnabled = $('cc-enabled');
    if (ccEnabled) ccEnabled.onchange = function () {
      state.customEnabled = ccEnabled.checked;
      updateDeckSummary();
    };

    var exportBtn = $('btn-export');
    if (exportBtn) exportBtn.onclick = function () { exportCustom(); };

    var importBtn = $('btn-import');
    var fileInput = $('file-import');
    if (importBtn) importBtn.onclick = function () { if (fileInput) fileInput.click(); };
    if (fileInput) fileInput.onchange = function () {
      if (fileInput.files && fileInput.files[0]) importCustom(fileInput.files[0]);
      fileInput.value = '';
    };

    var clearBtn = $('btn-clear-custom');
    if (clearBtn) clearBtn.onclick = function () {
      if (!UNO.CustomCards.list.length) { toast('当前没有自定义牌'); return; }
      UNO.CustomCards.clear();
      renderCustomList();
      updateDeckSummary();
      resetCustomForm();
      toast('已清空自定义牌');
    };

    var menuBtn = $('btn-menu');
    if (menuBtn) menuBtn.onclick = function () { SFX.tap(); openMenu(); };

    var soundBtn = $('btn-sound');
    if (soundBtn) soundBtn.onclick = function () {
      state.soundOn = !state.soundOn;
      syncSoundBtn();
      if (state.soundOn) SFX.tap();
    };

    var fsBtn = $('btn-fullscreen');
    if (fsBtn) fsBtn.onclick = function () { toggleFullscreen(); };

    var drawPile = $('draw-pile');
    if (drawPile) {
      drawPile.onclick = function () { handleDraw(); };
      drawPile.onkeydown = function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); handleDraw(); }
      };
    }

    var nextBtn = $('btn-next-round');
    if (nextBtn) nextBtn.onclick = function () {
      var g = state.game;
      if (!g) { switchScreen('setup'); return; }
      SFX.tap();
      if (g.matchOver) {
        startGame({ totals: null, roundIndex: 0 });
      } else {
        switchScreen('game');
        g.startNextRound();
      }
    };

    var backBtn = $('btn-back-setup');
    if (backBtn) backBtn.onclick = function () {
      if (state.game) { state.game.stopTimer(); state.game.roundOver = true; }
      state.game = null;
      switchScreen('setup');
    };

    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden && ac && ac.suspend) { try { ac.suspend(); } catch (e) { /* ignore */ } }
    });

    // 禁止双击缩放
    var lastTouch = 0;
    doc.addEventListener('touchend', function (ev) {
      var now = Date.now();
      if (now - lastTouch <= 300) ev.preventDefault();
      lastTouch = now;
    }, { passive: false });
  }

  function init() {
    UNO.CustomCards.load();
    state.settings = UNO.cloneSettings(UNO.getPreset('classic') ? UNO.getPreset('classic').settings : null);
    state.presetId = 'classic';
    state.customEnabled = false;
    state.players = defaultPlayers();
    state.soundOn = true;

    renderPresets();
    renderPlayers();
    renderSettings();
    renderCustomList();
    initCustomForm();
    syncCustomControls();
    updateDeckSummary();
    syncSoundBtn();
    bindCommon();
    resetCustomForm();
    switchScreen('setup');
  }

  UNO.UI = {
    init: init,
    renderGame: renderGame,
    toast: toast,
    state: state,
    startGame: startGame
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
