/* ===================================================================
   game.js —— UNO 规则核心引擎
   （规则判定 / 效果结算 / 回合调度 / AI 驱动 / 计分）
   全局命名空间：window.UNO
   =================================================================== */
(function (global) {
  'use strict';

  var UNO = global.UNO = global.UNO || {};

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function emptyColorStat() {
    return { red: 0, yellow: 0, green: 0, blue: 0 };
  }

  function cardPoints(card) {
    if (!card) return 0;
    if (card.kind === 'number') return card.value;
    if (card.kind === 'wild' || card.kind === 'wild4') return 50;
    return 20;
  }

  function noop() {}

  /* ============================ 构造 ============================ */
  function Game(opts) {
    opts = opts || {};
    this.settings = UNO.cloneSettings(opts.settings);
    this.customCards = opts.customCards || [];
    this.customEnabled = !!opts.customEnabled;
    this.roundIndex = opts.roundIndex || 0;

    var src = opts.players || [];
    if (src.length < 2) throw new Error('至少需要 2 名玩家');
    if (src.length > 10) src = src.slice(0, 10);

    this.players = src.map(function (p, i) {
      return {
        name: p.name || ('玩家 ' + (i + 1)),
        isAI: !!p.isAI,
        aiLevel: p.aiLevel || 'normal',
        hand: [],
        saidUno: false,
        idx: i
      };
    });

    this.totals = (opts.totals && opts.totals.length === this.players.length)
      ? opts.totals.slice()
      : this.players.map(function () { return 0; });

    this.h = {
      update: noop,
      event: noop,
      toast: noop,
      askColor: function (idx, cb) { cb('red'); },
      askTarget: function (idx, list, cb) { cb(list[0]); },
      askChallenge: function (idx, cb) { cb(false); },
      askReady: function (idx, cb) { cb(); },
      showUno: noop,
      roundEnd: noop
    };

    this.roundOver = false;
    this.matchOver = false;
    this.busy = false;
    this.logs = [];
    this.deck = [];
    this.discard = [];
    this.bans = [];
    this.pendingDraw = 0;
    this.pendingKind = null;
    this.lastWild4 = null;
    this.unoWindow = null;
    this.awaitingHuman = false;
    this.canPassAfterDraw = false;
    this.drawTimeCard = null;
    this.timerId = null;
    this.aiTimer = null;
    this.unoTimer = null;
    this.timerLeft = 0;
    this.currentColor = 'red';
    this.direction = 1;
    this.currentPlayer = 0;
    this.colorTotals = emptyColorStat();
    this.playedColors = [];
  }

  /* ============================ 工具方法 ============================ */
  Game.prototype.nextIndex = function (from, step) {
    var n = this.players.length;
    var raw = (from + step * this.direction) % n;
    return ((raw % n) + n) % n;
  };

  Game.prototype.topCard = function () {
    return this.discard.length ? this.discard[this.discard.length - 1] : null;
  };

  Game.prototype.emit = function (type, data) {
    if (this.h && typeof this.h.event === 'function') this.h.event(type, data || {});
  };

  Game.prototype.addLog = function (text) {
    this.logs.push(text);
    if (this.logs.length > 160) this.logs.shift();
  };

  Game.prototype.humanCount = function () {
    return this.players.filter(function (p) { return !p.isAI; }).length;
  };

  Game.prototype.stopTimer = function () {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.timerLeft = 0;
  };

  /* ============================ 开局 ============================ */
  Game.prototype.newRound = function () {
    var self = this;
    this.roundOver = false;
    this.busy = false;
    this.discard = [];
    this.bans = [];
    this.pendingDraw = 0;
    this.pendingKind = null;
    this.lastWild4 = null;
    this.unoWindow = null;
    this.direction = 1;
    this.currentPlayer = 0;
    this.turnSeq = 0;
    this.canPassAfterDraw = false;
    this.awaitingHuman = false;
    this.drawTimeCard = null;
    this.stopTimer();
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    if (this.unoTimer) { clearTimeout(this.unoTimer); this.unoTimer = null; }

    this.players.forEach(function (p) {
      p.hand = [];
      p.saidUno = false;
    });

    this.deck = shuffle(UNO.buildDeck(this.customCards, this.customEnabled));

    this.colorTotals = emptyColorStat();
    this.deck.forEach(function (c) {
      if (c.color !== 'wild') self.colorTotals[c.color] = (self.colorTotals[c.color] || 0) + 1;
    });

    this.playedColors = this.players.map(function () { return emptyColorStat(); });

    var handSize = Math.max(1, Math.min(20, parseInt(this.settings.handSize, 10) || 7));
    for (var r = 0; r < handSize; r++) {
      for (var i = 0; i < this.players.length; i++) {
        if (!this.deck.length) this.reshuffle();
        if (!this.deck.length) break;
        this.players[i].hand.push(this.deck.pop());
      }
    }

    var guard = 0, first = null;
    while (this.deck.length && guard < 400) {
      guard++;
      var c = this.deck.pop();
      if (c && c.kind === 'number') { first = c; break; }
      this.deck.unshift(c);
    }
    if (!first && this.deck.length) first = this.deck.pop();
    if (first) {
      this.discard.push(first);
      this.currentColor = first.color === 'wild' ? UNO.COLORS[Math.floor(Math.random() * 4)] : first.color;
    } else {
      this.currentColor = 'red';
    }

    this.addLog('第 ' + (this.roundIndex + 1) + ' 局开始，每人 ' + handSize + ' 张牌，牌堆 ' + this.deck.length + ' 张');
  };

  Game.prototype.start = function () {
    this.beginTurn();
  };

  Game.prototype.startNextRound = function () {
    this.roundIndex += 1;
    this.matchOver = false;
    this.newRound();
    this.beginTurn();
  };

  /* ============================ 洗牌 / 摸牌 ============================ */
  Game.prototype.reshuffle = function () {
    if (this.discard.length <= 1) return;
    var top = this.discard.pop();
    var rest = this.discard;
    this.discard = [top];
    this.deck = shuffle(rest);
    this.emit('reshuffle', { count: this.deck.length });
  };

  Game.prototype.drawCards = function (idx, n) {
    var got = [];
    var p = this.players[idx];
    if (!p) return got;
    for (var i = 0; i < n; i++) {
      if (!this.deck.length) this.reshuffle();
      if (!this.deck.length) break;
      var c = this.deck.pop();
      p.hand.push(c);
      got.push(c);
    }
    if (p.hand.length > 1) p.saidUno = false;
    return got;
  };

  /* ============================ 合法性判定 ============================ */
  Game.prototype.banColorOf = function (idx) {
    var colors = [];
    for (var i = 0; i < this.bans.length; i++) {
      if (this.bans[i].playerIdx === idx && this.bans[i].left > 0) colors.push(this.bans[i].color);
    }
    return colors;
  };

  Game.prototype.canStack = function (card) {
    if (!card) return false;
    if (card.kind === 'draw2') return !!this.settings.stack2 && this.pendingKind === 'draw2';
    if (card.kind === 'wild4') return !!this.settings.stack4;
    if (card.kind === 'custom') {
      if (card.effect === 'drawN') return !!this.settings.stack2 && this.pendingKind === 'draw2';
      if (card.effect === 'doublePenalty') return true;
    }
    return false;
  };

  Game.prototype.isLegal = function (idx, card) {
    if (!card) return false;
    var top = this.topCard();
    if (!top) return true;

    var banned = this.banColorOf(idx);
    if (card.color !== 'wild' && banned.indexOf(card.color) >= 0) return false;

    if (this.pendingDraw > 0) return this.canStack(card);

    if (card.color === 'wild') return true;
    if (card.color === this.currentColor) return true;
    if (top.kind === 'number' && card.kind === 'number' && card.value === top.value) return true;
    if (top.kind !== 'number' && card.kind === top.kind && card.kind !== 'custom') return true;
    if (card.kind === 'custom' && top.kind === 'custom' && card.customId && card.customId === top.customId) return true;
    return false;
  };

  Game.prototype.getLegalCards = function (idx) {
    var p = this.players[idx];
    if (!p) return [];
    var self = this;
    return p.hand.filter(function (c) { return self.isLegal(idx, c); });
  };

  /* ============================ 回合调度 ============================ */
  Game.prototype.beginTurn = function () {
    if (this.roundOver || this.matchOver) return;
    var idx = this.currentPlayer;
    var p = this.players[idx];
    if (!p) return;

    this.busy = false;
    this.turnSeq = (this.turnSeq || 0) + 1;
    this.tickBans(idx);
    this.canPassAfterDraw = false;
    this.awaitingHuman = false;
    this.drawTimeCard = null;

    this.emit('turn', { player: idx });
    if (typeof this.h.update === 'function') this.h.update();

    var self = this;
    if (p.isAI) {
      var delay = UNO.AI.thinkTime(p.aiLevel, this.settings.animSpeed);
      this.aiTimer = setTimeout(function () { self.aiAct(idx); }, delay);
    } else {
      if (this.humanCount() > 1) {
        this.h.askReady(idx, function () { self.startHumanTurn(idx); });
      } else {
        this.startHumanTurn(idx);
      }
    }
  };

  Game.prototype.tickBans = function (idx) {
    var keep = [];
    for (var i = 0; i < this.bans.length; i++) {
      var b = this.bans[i];
      if (b.playerIdx === idx) {
        b.left -= 1;
        if (b.left > 0) keep.push(b);
        else this.emit('banExpire', { player: idx, color: b.color });
      } else {
        keep.push(b);
      }
    }
    this.bans = keep;
  };

  Game.prototype.startHumanTurn = function (idx) {
    if (this.roundOver || this.matchOver) return;
    if (this.currentPlayer !== idx) return;
    this.awaitingHuman = true;
    var self = this;

    var canChallenge = this.settings.challengeWild4 && this.pendingKind === 'draw4' &&
      this.lastWild4 && this.lastWild4.idx !== idx;

    if (this.pendingDraw > 0) {
      var stackables = this.getLegalCards(idx);
      if (canChallenge) {
        this.h.askChallenge(idx, function (wantChallenge) {
          if (wantChallenge) self.resolveChallenge(idx);
          else self.takePenalty(idx);
        });
        this.h.update();
        return;
      }
      if (stackables.length) {
        this.awaitingHuman = true;
        this.stopTimer();
        this.h.update();
        return;
      }
      this.aiTimer = setTimeout(function () { self.takePenalty(idx); }, 520);
      this.h.update();
      return;
    }

    this.startTimer();
    this.h.update();
  };

  Game.prototype.startTimer = function () {
    var self = this;
    this.stopTimer();
    var limit = parseInt(this.settings.turnTime, 10) || 0;
    if (!limit) {
      this.h.update();
      return;
    }
    this.timerLeft = limit;
    this.timerId = setInterval(function () {
      self.timerLeft -= 1;
      if (self.timerLeft <= 0) {
        self.stopTimer();
        self.autoAct(self.currentPlayer);
      }
      self.h.update();
    }, 1000);
  };

  Game.prototype.autoAct = function (idx) {
    var p = this.players[idx];
    if (!p || p.isAI) return;
    if (this.pendingDraw > 0) { this.takePenalty(idx); return; }
    var legal = this.getLegalCards(idx);
    if (legal.length) {
      var card = legal[0];
      var color = card.color === 'wild' ? UNO.AI.pickColor(this, idx, 'normal') : null;
      this.h.toast('超时，自动出牌');
      this.playCard(idx, card.uid, color);
    } else {
      this.h.toast('超时，自动摸牌');
      this.humanDraw(idx);
    }
  };

  /* 领罚：摸 pendingDraw 张并跳过 */
  Game.prototype.takePenalty = function (idx) {
    if (this.roundOver || this.matchOver) return;
    if (this.pendingDraw <= 0) return;
    var n = this.pendingDraw;
    this.pendingDraw = 0;
    this.pendingKind = null;
    this.lastWild4 = null;
    this.drawCards(idx, n);
    this.emit('penalty', { player: idx, count: n });
    this.addLog(this.players[idx].name + ' 摸了 ' + n + ' 张罚牌');
    this.h.update();
    this.finishTurn(true);
  };

  /* 质疑 +4 */
  Game.prototype.resolveChallenge = function (challengerIdx) {
    var last = this.lastWild4;
    this.pendingDraw = 0;
    this.pendingKind = null;
    this.lastWild4 = null;
    if (!last) { this.finishTurn(true); return; }

    var cheated = last.handColors.indexOf(last.colorAtPlay) >= 0;
    if (cheated) {
      this.drawCards(last.idx, 4);
      this.addLog('质疑成功！' + this.players[last.idx].name + ' 手上仍有' +
        (UNO.COLOR_LABEL[last.colorAtPlay] || '') + '色，改罚摸 4 张');
      this.emit('challenge', { ok: true, player: challengerIdx, target: last.idx });
    } else {
      this.drawCards(challengerIdx, 6);
      this.addLog('质疑失败，' + this.players[challengerIdx].name + ' 罚摸 6 张');
      this.emit('challenge', { ok: false, player: challengerIdx, target: last.idx });
    }
    this.h.update();
    this.finishTurn(true);
  };

  Game.prototype.finishTurn = function (skipNext) {
    if (this.roundOver || this.matchOver) return;
    this.stopTimer();
    this.awaitingHuman = false;
    this.canPassAfterDraw = false;
    this.busy = false;

    var steps = skipNext ? 2 : 1;
    this.currentPlayer = this.nextIndex(this.currentPlayer, steps);
    this.beginTurn();
  };

  /* ============================ AI 行动 ============================ */
  Game.prototype.aiAct = function (idx) {
    if (this.roundOver || this.matchOver) return;
    var p = this.players[idx];
    if (!p || !p.isAI) return;
    if (this.currentPlayer !== idx) return;
    var self = this;

    var canChallenge = this.settings.challengeWild4 && this.pendingKind === 'draw4' &&
      this.lastWild4 && this.lastWild4.idx !== idx;

    if (canChallenge && this.pendingDraw > 0 && UNO.AI.shouldChallenge(this, idx, p.aiLevel)) {
      this.h.toast(p.name + ' 提出质疑');
      this.resolveChallenge(idx);
      return;
    }
    if (this.pendingDraw > 0) {
      var legalStack = this.getLegalCards(idx);
      if (!legalStack.length) {
        this.takePenalty(idx);
        return;
      }
    }

    var move = UNO.AI.decide(this, idx);
    if (move.action === 'play' && move.card) {
      this.playCard(idx, move.card.uid, move.color);
    } else {
      this.aiDraw(idx);
    }
  };

  Game.prototype.aiDraw = function (idx) {
    var self = this;
    var p = this.players[idx];
    if (this.pendingDraw > 0) { this.takePenalty(idx); return; }

    var got = this.drawCards(idx, 1);
    this.emit('drew', { player: idx, count: 1 });
    this.h.update();
    if (!got.length) { this.finishTurn(false); return; }

    var card = got[0];
    if (this.settings.drawPlayable && this.isLegal(idx, card)) {
      this.aiTimer = setTimeout(function () {
        if (self.roundOver || self.matchOver) return;
        var color = card.color === 'wild' ? UNO.AI.pickColor(self, idx, p.aiLevel) : null;
        self.playCard(idx, card.uid, color);
      }, Math.max(200, UNO.AI.thinkTime(p.aiLevel, self.settings.animSpeed) * 0.6));
    } else {
      this.finishTurn(false);
    }
  };

  /* ============================ 真人在摸牌后操作 ============================ */
  Game.prototype.humanDraw = function (idx) {
    if (!this.awaitingHuman) return false;
    if (this.roundOver || this.matchOver) return false;
    if (this.currentPlayer !== idx) return false;

    if (this.pendingDraw > 0) { this.takePenalty(idx); return true; }

    if (this.settings.forcePlay && this.getLegalCards(idx).length) {
      this.h.toast('强制出牌规则：手上有合法牌时必须出牌');
      return false;
    }

    var got = this.drawCards(idx, 1);
    this.emit('drew', { player: idx, count: 1 });
    this.h.update();
    if (!got.length) { this.finishTurn(false); return true; }

    var card = got[0];
    if (this.settings.drawPlayable && this.isLegal(idx, card)) {
      this.drawTimeCard = card;
      this.canPassAfterDraw = true;
      this.stopTimer();
      this.h.update();
      this.h.toast('摸到了 ' + card.name + '，可以直接出牌或选择过牌');
    } else {
      this.stopTimer();
      this.awaitingHuman = false;
      this.finishTurn(false);
    }
    return true;
  };

  Game.prototype.humanPass = function (idx) {
    if (!this.canPassAfterDraw) return false;
    if (this.currentPlayer !== idx) return false;
    this.canPassAfterDraw = false;
    this.drawTimeCard = null;
    this.awaitingHuman = false;
    this.finishTurn(false);
    return true;
  };

  /* ============================ 出牌 ============================ */
  Game.prototype.playCard = function (idx, uid, chosenColor) {
    if (this.roundOver || this.matchOver || this.busy) return false;
    var p = this.players[idx];
    if (!p) return false;

    var card = null, ci = -1;
    for (var i = 0; i < p.hand.length; i++) {
      if (p.hand[i].uid === uid) { card = p.hand[i]; ci = i; break; }
    }
    if (!card) return false;
    if (!this.isLegal(idx, card)) {
      this.h.toast('这张牌现在不能出');
      return false;
    }
    if (!p.isAI && !this.awaitingHuman && !this.canPassAfterDraw) return false;

    var prevColor = this.currentColor;
    var prevHandColors = p.hand.map(function (c) { return c.color; });

    if (card.color === 'wild' && !chosenColor) {
      chosenColor = UNO.AI.pickColor(this, idx, p.aiLevel || 'normal');
    }

    this.busy = true;
    this.awaitingHuman = false;
    this.canPassAfterDraw = false;
    this.drawTimeCard = null;
    this.stopTimer();

    p.hand.splice(ci, 1);
    this.discard.push(card);
    p.saidUno = false;

    var colorKey = card.color === 'wild' ? chosenColor : card.color;
    if (this.playedColors[idx] && colorKey) {
      this.playedColors[idx][colorKey] = (this.playedColors[idx][colorKey] || 0) + 1;
    }

    if (card.kind === 'wild4') {
      this.lastWild4 = { idx: idx, colorAtPlay: prevColor, handColors: prevHandColors };
    }

    this.currentColor = colorKey || this.currentColor;

    this.addLog(p.name + ' 打出 ' + UNO.cardText(card) +
      (card.color === 'wild' ? ' → ' + (UNO.COLOR_LABEL[this.currentColor] || '') + '色' : ''));
    this.emit('played', { player: idx, card: card, color: this.currentColor });
    this.h.update();

    var self = this;
    this.applyEffect(idx, card, false, function (skipNext) {
      self.afterPlay(idx, skipNext);
    });
    return true;
  };

  Game.prototype.afterPlay = function (idx, skipNext) {
    var self = this;
    var p = this.players[idx];
    this.busy = false;

    if (p.hand.length === 0) {
      this.endRound(idx);
      return;
    }
    if (p.hand.length === 1) this.handleUno(idx);

    this.triggerChaos(idx, function (chaosSkip) {
      self.finishTurn(!!skipNext || !!chaosSkip);
    });
  };


  /* ============================ 效果结算 ============================ */
  Game.prototype.applyEffect = function (idx, card, forceNoStack, done) {
    var self = this;
    var field = this.settings.reverseAsSkip ? 'reverseAsSkip' : 'reverse';

    function next() { done.call(self, false); }
    function skip() { done.call(self, true); }
    function continues() { done.call(self, false, true); }

    switch (card.kind) {
      case 'number':
        if (this.settings.sevenZero) {
          if (card.value === 7) this.runSevenSwap(idx, next);
          else if (card.value === 0) this.runZeroRotate(idx, next);
          else next();
        } else next();
        break;

      case 'skip':
        this.emit('effect', { kind: 'skip' });
        skip();
        break;

      case 'reverse':
        this.emit('effect', { kind: field });
        if (this.players.length === 2 && this.settings.reverseAsSkip) skip();
        else {
          this.direction = -this.direction;
          this.addLog('方向翻转 → ' + (this.direction === 1 ? '顺时针' : '逆时针'));
          this.h.update();
          next();
        }
        break;

      case 'draw2':
        this.pendingDraw = (this.pendingDraw || 0) + 2;
        this.pendingKind = 'draw2';
        this.emit('effect', { kind: 'draw2' });
        if (!forceNoStack && this.settings.stack2) {
          done.call(this, false);
          this.h.update();
          return;
        }
        this.pendingDraw = 0;
        this.pendingKind = null;
        this.drawCards(this.nextIndex(this.currentPlayer, 1), 2);
        this.addLog(this.players[this.nextIndex(this.currentPlayer, 1)].name + ' 摸 2 张并跳过');
        skip();
        break;

      case 'wild4':
        this.pendingDraw = (this.pendingDraw || 0) + 4;
        this.pendingKind = 'draw4';
        this.emit('effect', { kind: 'wild4' });
        if (!forceNoStack && this.settings.stack4) {
          done.call(this, false);
          this.h.update();
          return;
        }
        this.pendingDraw = 0;
        this.pendingKind = null;
        this.drawCards(this.nextIndex(this.currentPlayer, 1), 4);
        this.addLog(this.players[this.nextIndex(this.currentPlayer, 1)].name + ' 摸 4 张并跳过');
        skip();
        break;

      case 'wild':
        this.emit('effect', { kind: 'wild' });
        next();
        break;

      case 'custom':
        this.applyCustomEffect(idx, card, done);
        return;

      default:
        next();
    }
  };

  Game.prototype.applyCustomEffect = function (idx, card, done) {
    var self = this;
    var victim = this.nextIndex(idx, 1);
    var name = function (i) { return self.players[i] ? self.players[i].name : '玩家'; };
    var finish = function (skipNext) { done.call(self, !!skipNext); };

    switch (card.effect) {
      case 'drawN': {
        var n = Math.max(1, Math.min(20, parseInt(card.amount, 10) || 2));
        this.pendingDraw = (this.pendingDraw || 0) + n;
        this.pendingKind = 'draw2';
        this.emit('effect', { kind: 'drawN', count: n });
        if (this.settings.stack2) { done.call(this, false); this.h.update(); return; }
        this.pendingDraw = 0;
        this.pendingKind = null;
        this.drawCards(victim, n);
        this.addLog(name(victim) + ' 摸 ' + n + ' 张并跳过');
        finish(true);
        break;
      }
      case 'skip':
        this.emit('effect', { kind: 'customSkip' });
        this.addLog(name(victim) + ' 被跳过');
        finish(true);
        break;

      case 'reverse':
        this.direction = -this.direction;
        this.addLog('方向翻转 → ' + (this.direction === 1 ? '顺时针' : '逆时针'));
        this.emit('effect', { kind: 'customReverse' });
        this.h.update();
        finish(false);
        break;

      case 'banColor': {
        var bc = card.banColor && card.banColor !== 'wild' ? card.banColor : this.currentColor;
        this.bans.push({ playerIdx: victim, color: bc, left: 2 });
        this.addLog(name(victim) + ' 被禁止打出' + (UNO.COLOR_LABEL[bc] || '') + '色，持续 2 回合');
        this.emit('effect', { kind: 'banColor', color: bc });
        this.h.update();
        finish(false);
        break;
      }
      case 'swapHands': {
        var target = victim;
        if (this.players.length > 2 && card.targetMode === 'choose') {
          var list = [];
          for (var i = 0; i < this.players.length; i++) if (i !== idx) list.push(i);
          target = list[0];
        }
        var tmp = this.players[idx].hand;
        this.players[idx].hand = this.players[target].hand;
        this.players[target].hand = tmp;
        this.players[idx].hand.forEach(function (c) { /* 保持引用 */ });
        this.players[idx].saidUno = false;
        this.players[target].saidUno = false;
        this.addLog('手牌互换：' + name(idx) + ' ↔ ' + name(target));
        this.emit('effect', { kind: 'swapHands' });
        this.h.update();
        this.checkAfterEffect(idx);
        finish(false);
        break;
      }
      case 'copyLast': {
        var probe = this.discard.slice(0, this.discard.length - 1);
        var last = probe.length ? probe[probe.length - 1] : null;
        if (!last || last.kind === 'custom') {
          this.addLog('没有可复制的牌，效果取消');
          finish(false);
          break;
        }
        this.addLog('复制上一张牌效果：' + UNO.cardText(last));
        this.applyEffect(idx, last, true, function (skipNext) { finish(skipNext); });
        return;
      }
      case 'doublePenalty': {
        var times = Math.max(2, Math.min(4, parseInt(card.amount, 10) || 2));
        if (this.pendingDraw > 0) this.pendingDraw *= times;
        else this.pendingDraw = times;
        this.pendingKind = this.pendingKind || 'draw2';
        this.addLog('下家惩罚翻 ' + times + ' 倍');
        this.emit('effect', { kind: 'doublePenalty', times: times });
        this.h.update();
        finish(false);
        break;
      }
      case 'trimHand': {
        var amount = Math.max(1, Math.min(5, parseInt(card.amount, 10) || 1));
        for (var t = 0; t < this.players.length; t++) {
          var pl = this.players[t];
          if (t === idx) continue;
          if (pl.hand.length > 0) {
            pl.hand.splice(Math.floor(Math.random() * pl.hand.length), 1);
          }
          if (pl.saidUno) pl.saidUno = false;
        }
        this.addLog('所有对手各被弃掉 ' + amount + ' 张牌（随机 1 张）');
        this.emit('effect', { kind: 'trimHand' });
        this.h.update();
        finish(false);
        break;
      }
      default:
        finish(false);
    }
  };

  Game.prototype.checkAfterEffect = function (idx) {
    var p = this.players[idx];
    if (p && p.hand.length === 1 && !p.saidUno) this.handleUno(idx);
  };

  /* ============================ 7-0 规则 ============================ */
  Game.prototype.runSevenSwap = function (idx, done) {
    var self = this;
    var targets = [];
    for (var i = 0; i < this.players.length; i++) if (i !== idx) targets.push(i);
    if (!targets.length) { done.call(this); return; }

    var pick = function (target) {
      var tmp = self.players[idx].hand;
      self.players[idx].hand = self.players[target].hand;
      self.players[target].hand = tmp;
      self.players[idx].saidUno = false;
      self.players[target].saidUno = false;
      self.addLog('7-0 规则：' + self.players[idx].name + ' 与 ' + self.players[target].name + ' 换牌');
      self.emit('effect', { kind: 'seven' });
      self.h.update();
      done.call(self);
    };

    if (this.players[idx].isAI) pick(targets[Math.floor(Math.random() * targets.length)]);
    else this.h.askTarget(idx, targets, function (t) {
      pick(typeof t === 'number' && targets.indexOf(t) >= 0 ? t : targets[0]);
    });
  };

  Game.prototype.runZeroRotate = function (idx, done) {
    var n = this.players.length;
    var hands = this.players.map(function (p) { return p.hand; });
    var rotated = hands.slice();
    for (var i = 0; i < n; i++) {
      rotated[(i + this.direction + n) % n] = hands[i];
    }
    for (var k = 0; k < n; k++) {
      this.players[k].hand = rotated[k];
      this.players[k].saidUno = false;
    }
    this.addLog('7-0 规则：所有玩家手牌' + (this.direction === 1 ? '顺时针' : '逆时针') + '传递');
    this.emit('effect', { kind: 'zero' });
    this.h.update();
    done.call(this);
  };

  /* ============================ 混沌模式 ============================ */
  Game.prototype.triggerChaos = function (idx, done) {
    var self = this;
    if (!this.settings.chaos) { done.call(this, false); return; }
    if (Math.random() > 0.4) { done.call(this, false); return; }

    var events = [
      function () {
        self.players.forEach(function (p, i) { self.drawCards(i, 1); });
        this.addLog('混沌事件：全体摸 1 张牌');
        this.emit('chaos', { kind: 'allDraw' });
        this.h.update();
        done.call(this, false);
      },
      function () {
        this.direction = -this.direction;
        this.addLog('混沌事件：方向强制反转');
        this.emit('chaos', { kind: 'reverse' });
        this.h.update();
        done.call(this, false);
      },
      function () {
        var t = this.players[idx];
        var n = 1 + Math.floor(Math.random() * 3);
        this.drawCards(idx, n);
        this.addLog('混沌事件：' + (t ? t.name : '出牌者') + ' 额外摸 ' + n + ' 张');
        this.emit('chaos', { kind: 'selfDraw' });
        this.h.update();
        done.call(this, false);
      },
      function () {
        this.currentColor = UNO.COLORS[Math.floor(Math.random() * 4)];
        this.addLog('混沌事件：桌面颜色随机变为' + (UNO.COLOR_LABEL[this.currentColor] || '') + '色');
        this.emit('chaos', { kind: 'colorChange' });
        this.h.update();
        done.call(this, false);
      },
      function () {
        var best = -1, bc = 0;
        this.players.forEach(function (p, i) {
          if (p.hand.length > best) { best = p.hand.length; bc = i; }
        });
        if (this.players[bc] && best > 0) {
          this.players[bc].hand.splice(Math.floor(Math.random() * best), 1);
          this.addLog('混沌事件：' + this.players[bc].name + ' 弃掉 1 张牌');
          this.emit('chaos', { kind: 'discardTop' });
        }
        this.h.update();
        done.call(this, false);
      },
      function () {
        var v = this.nextIndex(this.currentPlayer, 1);
        this.pendingDraw = (this.pendingDraw || 0) + 2;
        this.pendingKind = 'draw2';
        this.addLog('混沌事件：下家额外累积 +2 惩罚');
        this.emit('chaos', { kind: 'extra2' });
        this.h.update();
        done.call(this, false);
      }
    ];

    var inbox = Math.floor(Math.random() * events.length);
    events[inbox].call(this);
  };

  /* ============================ UNO 喊牌 ============================ */
  Game.prototype.handleUno = function (idx) {
    var self = this;
    var p = this.players[idx];
    if (!p) return;
    if (p.hand.length !== 1) return;

    if (p.isAI) {
      var said = UNO.AI.shouldCallUno(p.aiLevel);
      p.saidUno = said;
      if (said) {
        this.addLog(p.name + ' 喊出了 UNO！');
        this.emit('uno', { player: idx, said: true });
      } else {
        this.addLog(p.name + ' 忘记喊 UNO');
        this.emit('uno', { player: idx, said: false });
      }
      this.h.update();
      return;
    }

    p.saidUno = false;
    this.awaitingHumanUno = true;
    this.h.update();
    this.emit('unoWindow', { player: idx });

    var wait = 3000;
    if (this.unoTimer) clearTimeout(this.unoTimer);
    this.unoTimer = setTimeout(function () {
      self.unoTimer = null;
      self.awaitingHumanUno = false;
      if (self.players[idx].saidUno) return;
      if (self.players[idx].hand.length > 1) return;
      self.drawCards(idx, 2);
      self.addLog(p.name + ' 漏喊 UNO，罚摸 2 张');
      self.h.toast('漏喊 UNO！罚摸 2 张');
      self.h.update();
    }, wait);
  };

  Game.prototype.callUno = function (idx) {
    var p = this.players[idx];
    if (!p) return false;
    if (p.hand.length !== 1) {
      this.h.toast('只有在剩 1 张牌时才能喊 UNO');
      return false;
    }
    if (p.saidUno) return false;
    p.saidUno = true;
    if (this.unoTimer) { clearTimeout(this.unoTimer); this.unoTimer = null; }
    var self = this;
    this.h.showUno(idx);
    this.emit('uno', { player: idx, said: true });
    this.addLog(p.name + ' 喊出了 UNO！');
    this.h.update();

    var penalty = Math.max(0, Math.min(10, parseInt(this.settings.unoPenalty, 10) || 0));
    if (penalty > 0) {
      var others = [];
      for (var i = 0; i < this.players.length; i++) if (i !== idx) others.push(i);
      if (others.length) {
        var victim = others[Math.floor(Math.random() * others.length)];
        this.drawCards(victim, penalty);
        this.addLog(this.players[victim].name + ' 被 UNO 波及罚摸 ' + penalty + ' 张');
        this.h.update();
      }
    }
    return true;
  };

  /* ============================ 结算 ============================ */
  Game.prototype.endRound = function (winner) {
    this.stopTimer();
    this.roundOver = true;
    this.busy = true;
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    if (this.unoTimer) { clearTimeout(this.unoTimer); this.unoTimer = null; }
    this.awaitingHuman = false;
    this.awaitingHumanUno = false;

    var self = this;
    var scores = [];
    var gained = 0;

    this.players.forEach(function (p, i) {
      if (i === winner) return;
      var sum = 0;
      p.hand.forEach(function (c) { sum += cardPoints(c); });
      scores.push({ player: i, name: p.name, points: sum, cards: p.hand.length, isAI: p.isAI });
      gained += sum;
    });

    if (gained === 0 && this.players.length === 2) gained = 20;
    if (gained === 0) gained = 50;

    this.totals[winner] = (this.totals[winner] || 0) + gained;

    var target = parseInt(this.settings.targetScore, 10) || 0;
    var needNext = target > 0 && this.totals[winner] < target;

    var best = 0;
    for (var i = 1; i < this.totals.length; i++) if (this.totals[i] > this.totals[best]) best = i;

    this.matchOver = target > 0 && this.totals[winner] >= target;

    this.addLog(this.players[winner].name + ' 本局获胜，得 ' + gained + ' 分');

    var result = {
      winner: winner,
      winnerName: this.players[winner].name,
      gained: gained,
      scores: scores.sort(function (a, b) { return a.points - b.points; }),
      totals: this.totals.slice(),
      players: this.players.map(function (p) {
        return { name: p.name, isAI: p.isAI, aiLevel: p.aiLevel };
      }),
      roundIndex: this.roundIndex,
      targetScore: target,
      matchOver: this.matchOver,
      needNext: needNext,
      leader: best,
      hands: this.players.map(function (p) { return p.hand.slice(); })
    };

    this.emit('roundEnd', result);
    if (typeof this.h.roundEnd === 'function') this.h.roundEnd(result);
  };

  UNO.Game = Game;
  UNO.cardPoints = cardPoints;
  UNO.shuffle = shuffle;

})(typeof window !== 'undefined' ? window : this);
