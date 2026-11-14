/* ===================================================================
   ai.js —— 三档 AI 策略（简单 / 普通 / 困难）
   困难档会使用"已出牌统计 + 对手颜色倾向 + 剩余牌估算"做决策
   =================================================================== */
(function (global) {
  'use strict';

  var UNO = global.UNO = global.UNO || {};

  function isAttack(card) {
    if (!card) return false;
    if (card.kind === 'draw2' || card.kind === 'wild4' || card.kind === 'skip') return true;
    if (card.kind === 'custom') {
      return card.effect === 'drawN' || card.effect === 'skip' ||
        card.effect === 'trimHand' || card.effect === 'doublePenalty' ||
        card.effect === 'banColor';
    }
    return false;
  }

  function isWild(card) {
    return card.color === 'wild';
  }

  function handColorCounts(hand) {
    var c = { red: 0, yellow: 0, green: 0, blue: 0 };
    for (var i = 0; i < hand.length; i++) {
      if (hand[i].color !== 'wild') c[hand[i].color] = (c[hand[i].color] || 0) + 1;
    }
    return c;
  }

  function mainColor(hand) {
    var counts = handColorCounts(hand);
    var best = null, bestN = 0;
    UNO.COLORS.forEach(function (c) {
      if (counts[c] > bestN) { bestN = counts[c]; best = c; }
    });
    return best || UNO.COLORS[Math.floor(Math.random() * 4)];
  }

  /* 估算剩余未出现的各色数量（公开信息推算，不使用对手手牌） */
  function remainingColorEstimate(game, playerIndex) {
    var totals = game.colorTotals || { red: 0, yellow: 0, green: 0, blue: 0 };
    var played = { red: 0, yellow: 0, green: 0, blue: 0 };
    (game.discard || []).forEach(function (c) {
      if (c && c.color !== 'wild') played[c.color] = (played[c.color] || 0) + 1;
    });
    var mine = handColorCounts(game.players[playerIndex].hand);
    var out = {};
    UNO.COLORS.forEach(function (c) {
      out[c] = Math.max(0, (totals[c] || 0) - (played[c] || 0) - (mine[c] || 0));
    });
    return out;
  }

  /* 每个对手最常打出的颜色（用于针对性禁用 / 判断倾向） */
  function opponentColorHabit(game, playerIndex) {
    var best = {};
    (game.playedColors || []).forEach(function (stat, i) {
      if (i === playerIndex) return;
      var pick = null, n = 0;
      UNO.COLORS.forEach(function (c) {
        if ((stat[c] || 0) > n) { n = stat[c] || 0; pick = c; }
      });
      best[i] = pick;
    });
    return best;
  }

  function pickColor(game, playerIndex, level) {
    var hand = game.players[playerIndex].hand;
    var counts = handColorCounts(hand);
    var order = UNO.COLORS.slice().sort(function (a, b) { return counts[b] - counts[a]; });

    if (level === 'easy') {
      return order[0] || UNO.COLORS[0];
    }
    if (level === 'normal') {
      return order[0];
    }
    // hard：优先自己最多的颜色；并列时看剩余牌分布
    var remain = remainingColorEstimate(game, playerIndex);
    if (counts[order[0]] === 0) {
      var sorted = UNO.COLORS.slice().sort(function (a, b) { return remain[b] - remain[a]; });
      return sorted[0];
    }
    var tied = UNO.COLORS.filter(function (c) { return counts[c] === counts[order[0]]; });
    if (tied.length === 1) return tied[0];
    tied.sort(function (a, b) { return remain[b] - remain[a]; });
    return tied[0];
  }

  /* 单张牌的出牌收益评分，越高越优先 */
  function scoreCard(game, playerIndex, card) {
    var hand = game.players[playerIndex].hand;
    var nextIdx = game.nextIndex(playerIndex, 1);
    var nextCount = hand.length && game.players[nextIdx] ? game.players[nextIdx].hand.length : 0;
    var score = 0;

    if (card.kind === 'number') score = 26;
    else if (card.kind === 'skip') score = 44;
    else if (card.kind === 'reverse') score = 38;
    else if (card.kind === 'draw2') score = 56;
    else if (card.kind === 'wild') score = 34;
    else if (card.kind === 'wild4') score = 48;
    else if (card.kind === 'custom') {
      if (card.effect === 'drawN') score = 54 + (card.amount || 2) * 3;
      else if (card.effect === 'skip') score = 44;
      else if (card.effect === 'reverse') score = 36;
      else if (card.effect === 'banColor') score = 46;
      else if (card.effect === 'swapHands') score = 40;
      else if (card.effect === 'copyLast') score = 42;
      else if (card.effect === 'doublePenalty') score = 58;
      else if (card.effect === 'trimHand') score = 70;
      else score = 40;
    }

    // 下家快没牌了：攻击牌大幅加分
    if (isAttack(card) && nextCount <= 2) score += 38;
    // 万能牌不要早用：手上还有别的选择时压低
    if (isWild(card) && hand.length > 4) score -= 22;
    if (card.kind === 'wild4' && hand.length > 2) score -= 18;
    // 出完就赢
    if (hand.length === 1) score += 60;
    // 保留稀有颜色：出掉自己该色最后一张会减少后续选择
    if (card.color !== 'wild') {
      var mineSame = 0;
      for (var i = 0; i < hand.length; i++) {
        if (hand[i].color === card.color && hand[i].uid !== card.uid) mineSame++;
      }
      if (mineSame === 0 && hand.length > 3) score -= 8;
    }
    // 数字牌尽量出大的，留小的（对 7-0 规则：出 7 有额外价值）
    if (card.kind === 'number' && game.settings && game.settings.sevenZero) {
      if (card.value === 7) score += 16;
      if (card.value === 0) score += 10;
    }
    return score;
  }

  function chooseEasy(legal) {
    return legal[Math.floor(Math.random() * legal.length)];
  }

  function chooseNormal(game, idx, legal) {
    // 优先：同色数字 > 功能牌 > 同数字 > 万能
    var groups = [
      function (c) { return c.kind === 'number' && c.color === game.currentColor; },
      function (c) { return (c.kind === 'skip' || c.kind === 'reverse' || c.kind === 'draw2' || c.kind === 'custom') && c.color === game.currentColor; },
      function (c) { return c.kind === 'number'; },
      function (c) { return c.kind !== 'wild' && c.kind !== 'wild4'; },
      function () { return true; }
    ];
    for (var g = 0; g < groups.length; g++) {
      var pool = legal.filter(groups[g]);
      if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
    }
    return chooseEasy(legal);
  }

  function chooseHard(game, idx, legal) {
    var scored = legal.map(function (c) {
      return { card: c, score: scoreCard(game, idx, c) };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    // 加一点随机扰动，避免每局完全一致
    var top = scored[0];
    var near = scored.filter(function (s) { return top.score - s.score <= 6; });
    var pick = near[Math.floor(Math.random() * near.length)] || top;

    // 禁用颜色牌：针对最常出该色的对手
    if (pick.card.kind === 'custom' && pick.card.effect === 'banColor') {
      var habits = opponentColorHabit(game, idx);
      var target = habits[game.nextIndex(idx, 1)];
      if (target) {
        pick.card.banColor = target;
      }
    }
    return pick.card;
  }

  var AI = {
    /* 返回 { action: 'play'|'draw', card, color } */
    decide: function (game, playerIndex) {
      var player = game.players[playerIndex];
      var level = player.aiLevel || 'normal';
      var legal = game.getLegalCards(playerIndex);

      if (!legal.length) {
        return { action: 'draw' };
      }

      var card;
      if (level === 'easy') card = chooseEasy(legal);
      else if (level === 'normal') card = chooseNormal(game, playerIndex, legal);
      else card = chooseHard(game, playerIndex, legal);

      var color = null;
      if (card.color === 'wild') {
        color = pickColor(game, playerIndex, level);
      }
      return { action: 'play', card: card, color: color };
    },

    pickColor: pickColor,
    scoreCard: scoreCard,

    /* AI 是否会喊 UNO */
    shouldCallUno: function (level) {
      if (level === 'easy') return Math.random() < 0.62;
      if (level === 'normal') return Math.random() < 0.86;
      return true;
    },

    /* AI 是否质疑 +4 */
    shouldChallenge: function (game, playerIndex, level) {
      if (!game.settings.challengeWild4) return false;
      if (level === 'easy') return Math.random() < 0.08;
      if (level === 'normal') return Math.random() < 0.2;
      var hand = game.players[playerIndex].hand.length;
      // 手牌少时质疑成本更低，更愿意赌一把
      return Math.random() < (hand <= 3 ? 0.42 : 0.22);
    },

    /* 思考耗时（ms），随动画速度缩放 */
    thinkTime: function (level, animSpeed) {
      var base = level === 'easy' ? 620 : (level === 'normal' ? 760 : 900);
      var speed = animSpeed || 1;
      return Math.max(120, Math.round(base / speed));
    }
  };

  UNO.AI = AI;

})(window);
