'use strict';

window.kioskGames = (() => {
  const stakeKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  const wheelSectors = [0, 2, 0, 1, 0, 3, 0, 2, 0, 1];
  const wheelSectorAngle = 360 / wheelSectors.length;
  const scratchSymbols = ['◆', '●', '✦', '·'];
  const scratchDeck = [0, 0, 0, 1, 1, 1, 2, 2, 3];
  const scratchMultipliers = [2, 1, 3];
  const reelSymbols = ['🍒', '🔔', '◆', '7'];
  const reelWeights = [40, 27, 20, 13];
  const reelMultipliers = [3, 4, 6, 10];
  const memorySymbols = ['▲', '◆', '✦', '☾', '⬢', '●'];
  const blockSymbols = ['●', '◆', '✦', '▲'];
  const blockNames = ['Mavi daire', 'Sarı elmas', 'Pembe yıldız', 'Yeşil üçgen'];
  const blockSize = 6;
  const memoryMoves = 12;
  const blockMoves = 8;
  const blockGoals = [65, 145, 240];
  const dartGoals = [2, 6, 10];
  const dartShotMs = 3500;
  const dartRings = [0.16, 0.38, 0.68, 1];
  const dartPoints = [5, 3, 2, 1];
  const skillOdds = [
    { label: 'Temel', weights: [53, 24, 19, 4] },
    { label: 'Orta', weights: [48, 22, 23, 7] },
    { label: 'Yüksek', weights: [43, 24, 25, 8] },
  ];

  const games = {
    wheel: { name: 'Şans çarkı', symbol: '◉', summary: 'On dilim, tek dönüş.', start: 'Çarkı çevir', rules: 'Her dilimin gelme şansı eşit. Kazandıran dilimler bahis tutarının 1, 2 veya 3 katını öder.' },
    scratch: { name: 'Kazı kazan', symbol: '✦', summary: 'Üç kart aç, sembolleri eşleştir.', start: 'Kartları hazırla', rules: 'Üç kart aç. Aynı sembolden en az iki tane bulursan ● 1×, ◆ 2× veya ✦ 3× öder.' },
    slots: { name: 'Slot oyunu', symbol: '777', summary: 'Üç makara, dört sembol.', start: 'Makaraları döndür', rules: 'İki eş sembol bahsi geri verir. Üç eş sembol 🍒 3×, 🔔 4×, ◆ 6× veya 7 10× öder.' },
    darts: { name: 'Hedefi vur', symbol: '◎', summary: 'Üç atışta en yüksek puanı topla.', start: 'Nişan almaya başla',
      rules: `Üç atışın her biri için 3,5 saniyen var. ${dartGoals[0]} puan temel, ${dartGoals[1]} puan orta, ${dartGoals[2]} puan yüksek ödül seviyesini açar.` },
    memory: { name: 'Hafıza oyunu', symbol: '▥', summary: 'Altı çifti en az hamleyle bul.', start: 'Kartları karıştır',
      rules: '12 hamlen var. 3 çift temel, 5 çift orta seviye açar. Altı çifti 9 hamlede bitirirsen yüksek seviyeden ödül kurasına girersin.' },
    blocks: { name: 'Blok patlat', symbol: '▦', summary: 'Aynı renkteki komşu blokları patlat.', start: 'Tahtayı hazırla',
      rules: `Sekiz hamlen var. En az iki komşu bloğu patlat. ${blockGoals[0]} puan temel, ${blockGoals[1]} puan orta, ${blockGoals[2]} puan yüksek ödül seviyesini açar.` },
  };

  let session;
  let aimFrame;
  let scratchPointer;
  const randomWord = new Uint32Array(1);
  const coinText = new Intl.NumberFormat('tr-TR');
  const format = value => coinText.format(value);

  function randomInt(limit) {
    const ceiling = 0x100000000 - (0x100000000 % limit);
    do { crypto.getRandomValues(randomWord); } while (randomWord[0] >= ceiling);
    return randomWord[0] % limit;
  }

  function shuffle(values) {
    const deck = [...values];
    for (let index = deck.length - 1; index > 0; index--) {
      const other = randomInt(index + 1);
      [deck[index], deck[other]] = [deck[other], deck[index]];
    }
    return deck;
  }

  function weightedIndex(weights) {
    let roll = randomInt(100);
    return weights.findIndex(weight => (roll -= weight) < 0);
  }

  function blockGroup(board, origin) {
    const group = new Set([origin]);
    const colour = board[origin];
    for (const index of group) {
      const column = index % blockSize;
      const neighbours = [index - blockSize, index + blockSize];
      if (column > 0) neighbours.push(index - 1);
      if (column < blockSize - 1) neighbours.push(index + 1);
      for (const neighbour of neighbours) {
        if (board[neighbour] === colour) group.add(neighbour);
      }
    }
    return group;
  }

  function hasBlockMove(board) {
    return board.some((colour, index) => colour === board[index + blockSize] ||
      (index % blockSize < blockSize - 1 && colour === board[index + 1]));
  }

  function newBlockBoard() {
    const board = Array.from({ length: blockSize ** 2 }, () => randomInt(blockSymbols.length));
    if (!hasBlockMove(board)) board[1] = board[0];
    return board;
  }

  function endSession() {
    if (session) for (const timer of session.timers) clearTimeout(timer);
    cancelAnimationFrame(aimFrame);
    aimFrame = undefined;
    scratchPointer = undefined;
    session = undefined;
  }

  function startSession() {
    endSession();
    session = { coins: 100n, stakeInput: '', game: undefined, rounds: {}, timers: new Set() };
  }

  function later(round, callback, delay) {
    const owner = session;
    const timer = setTimeout(() => {
      owner.timers.delete(timer);
      if (session === owner && owner.rounds[round.game] === round) callback();
    }, delay);
    owner.timers.add(timer);
  }

  function finish(round, multiplier) {
    if (round.phase === 'settled') return;
    round.phase = 'settled';
    round.payout = round.stake * BigInt(multiplier);
    session.coins += round.payout;
    update();
  }

  function skillLevel(round) {
    if (!round) return -1;
    if (round.game === 'memory') {
      const pairs = round.matched.size / 2;
      return pairs === 6 && round.moves <= 9 ? 2 : pairs >= 5 ? 1 : pairs >= 3 ? 0 : -1;
    }
    const goals = round.game === 'darts' ? dartGoals : blockGoals;
    return goals.findLastIndex(goal => round.score >= goal);
  }

  function finishSkillGame(round) {
    const odds = skillOdds[skillLevel(round)];
    finish(round, odds ? weightedIndex(odds.weights) : 0);
  }

  function readStake() {
    const { stakeInput, coins } = session;
    if (!/^\d+$/.test(stakeInput)) return 0n;
    const stake = BigInt(stakeInput);
    return stake > 0n && stake <= coins ? stake : 0n;
  }

  function startWheel(round, previousAngle) {
    const sector = randomInt(wheelSectors.length);
    const targetAngle = 360 - (sector + 0.5) * wheelSectorAngle;
    const clockwise = (targetAngle - previousAngle + 360) % 360;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rotation = reducedMotion ? (clockwise > 180 ? clockwise - 360 : clockwise) : 4 * 360 + clockwise;
    round.phase = 'spinning';
    round.sector = sector;
    round.targetAngle = targetAngle;
    round.startAngle = previousAngle;
    round.endAngle = previousAngle + rotation;
    round.startedAt = performance.now();
    round.duration = reducedMotion ? 500 : 2200;
    later(round, () => finish(round, wheelSectors[sector]), round.duration);
  }

  function begin() {
    const { game, rounds } = session;
    const previous = rounds[game];
    const stake = readStake();
    if (!game || !stake || (previous && previous.phase !== 'settled')) return;
    const round = { game, stake, phase: 'playing' };
    rounds[game] = round;
    session.coins -= stake;
    if (game === 'wheel') {
      startWheel(round, previous?.targetAngle ?? 0);
    } else if (game === 'scratch') {
      round.cards = shuffle(scratchDeck);
      round.opened = new Set();
    } else if (game === 'slots') {
      round.phase = 'spinning';
      round.reels = Array.from({ length: 3 }, () => weightedIndex(reelWeights));
      const [first, second, third] = round.reels;
      const multiplier = first === second && second === third ? reelMultipliers[first]
        : new Set(round.reels).size === 2 ? 1 : 0;
      later(round, () => finish(round, multiplier), 1050);
    } else if (game === 'darts') {
      round.shots = [];
      round.score = 0;
      startDartShot(round);
    } else if (game === 'memory') {
      round.cards = shuffle([...memorySymbols, ...memorySymbols]);
      round.matched = new Set();
      round.opened = [];
      round.moves = 0;
    } else {
      round.board = newBlockBoard();
      round.moves = 0;
      round.score = 0;
      round.falling = new Set();
    }
    update();
    document.querySelector('#games-root .arcade-stage')?.scrollIntoView({ block: 'nearest' });
  }

  function revealScratch(round, index) {
    if (round.opened.has(index)) return;
    round.opened.add(index);
    round.lastRevealed = index;
    if (round.opened.size < 3) { update(); return; }
    const counts = [0, 0, 0, 0];
    for (const card of round.opened) counts[round.cards[card]]++;
    finish(round, scratchMultipliers[counts.findIndex(count => count >= 2)] ?? 0);
  }

  function flipMemory(round, index) {
    if (round.matched.has(index) || round.opened.includes(index) || round.opened.length === 2) return;
    round.opened.push(index);
    round.lastRevealed = index;
    if (round.opened.length === 1) { update(); return; }
    round.moves++;
    const [first, second] = round.opened;
    if (round.cards[first] === round.cards[second]) {
      round.matched.add(first);
      round.matched.add(second);
      round.opened = [];
      if (round.matched.size === round.cards.length || round.moves === memoryMoves) { finishSkillGame(round); return; }
    } else {
      later(round, () => {
        round.opened = [];
        if (round.moves === memoryMoves) finishSkillGame(round);
        else update();
      }, 690);
    }
    update();
  }

  function startDartShot(round) {
    const shot = round.shots.length;
    round.aimStarted = performance.now();
    round.aimPoint = undefined;
    round.aimPhaseX = randomInt(360) * Math.PI / 180;
    round.aimPhaseY = randomInt(360) * Math.PI / 180;
    round.aimSpeedX = 3.5 + randomInt(100) / 150;
    round.aimSpeedY = 2.6 + randomInt(100) / 150;
    later(round, () => {
      if (round.phase === 'playing' && round.shots.length === shot) recordDart(round, null);
    }, dartShotMs);
  }

  function aim(round, now) {
    const seconds = (now - round.aimStarted) / 1000;
    return { x: 0.95 * Math.sin(seconds * round.aimSpeedX + round.aimPhaseX),
      y: 0.89 * Math.cos(seconds * round.aimSpeedY + round.aimPhaseY) };
  }

  function recordDart(round, point) {
    const radius = point ? Math.hypot(point.x, point.y) : Infinity;
    const points = dartPoints[dartRings.findIndex(ring => radius <= ring)] ?? 0;
    round.shots.push({ point, points });
    round.score += points;
    if (round.shots.length === 3) {
      finishSkillGame(round);
      return;
    }
    startDartShot(round);
    update();
  }

  function throwDart(round) {
    if (performance.now() - round.aimStarted >= dartShotMs) recordDart(round, null);
    else if (round.aimPoint) recordDart(round, round.aimPoint);
  }

  function popBlocks(round, index) {
    const group = blockGroup(round.board, index);
    if (group.size < 2) return;
    round.moves++;
    round.gain = group.size ** 2;
    round.score += round.gain;
    round.falling = new Set();
    for (let column = 0; column < blockSize; column++) {
      const cells = Array.from({ length: blockSize }, (_, row) => row * blockSize + column);
      if (!cells.some(cell => group.has(cell))) continue;
      const remaining = cells.filter(cell => !group.has(cell)).map(cell => round.board[cell]);
      const incoming = Array.from({ length: blockSize - remaining.length }, () => randomInt(blockSymbols.length));
      [...incoming, ...remaining].forEach((colour, row) => {
        round.board[cells[row]] = colour;
        round.falling.add(cells[row]);
      });
    }
    if (round.moves === blockMoves) {
      finishSkillGame(round);
      return;
    }
    if (!hasBlockMove(round.board)) {
      round.board = newBlockBoard();
      round.falling = new Set(round.board.keys());
    }
    update();
  }

  function gameButton(label, action, value, options = {}) {
    const { classes = '', disabled = false, pressed, ariaLabel } = options;
    return `<button type="button" class="${classes}" data-game-action="${action}" data-game-value="${value}"
      ${disabled ? 'disabled' : ''}${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}${ariaLabel ? ` aria-label="${ariaLabel}"` : ''}>${label}</button>`;
  }

  function stakeForm(startLabel, coins) {
    return `<form class="arcade-stakes">
      <div class="arcade-stake-field">
        <label for="arcade-stake-input">Bahis miktarı</label>
        <div class="arcade-stake-amount"><input id="arcade-stake-input" type="text" inputmode="none"
          autocomplete="off" spellcheck="false" aria-describedby="arcade-stake-hint"${coins === 0n ? ' disabled' : ''}><span>coin</span></div>
        <p id="arcade-stake-hint" aria-live="polite"></p>
      </div>
      ${coins > 0n ? `<div class="arcade-keypad" role="group" aria-label="Bahis tuş takımı">${stakeKeys.map(key => gameButton(
        key === 'clear' ? 'Temizle' : key === 'back' ? '⌫' : key, 'stake-key', key,
        { classes: 'arcade-button arcade-key', ariaLabel: key === 'back' ? 'Son rakamı sil' : undefined })).join('')}</div>` : ''}
      <button type="submit" data-game-action="start" class="arcade-button arcade-primary" disabled>${startLabel}</button>
    </form>`;
  }

  function syncStakeForm(form) {
    const { stakeInput, coins } = session;
    const stake = readStake();
    const input = form.querySelector('input');
    if (input.value !== stakeInput) input.value = stakeInput;
    const invalid = coins > 0n && stakeInput !== '' && !stake;
    input.setAttribute('aria-invalid', String(invalid));
    const hint = form.querySelector('#arcade-stake-hint');
    const message = coins === 0n ? 'Bu oturumdaki oyun coin’in bitti.'
      : invalid ? `1 ile ${format(coins)} arasında bir tam sayı gir.` : `En fazla ${format(coins)} coin`;
    if (hint.textContent !== message) hint.textContent = message;
    form.querySelector('button[type="submit"]').disabled = !stake;
  }

  function slotBoard(round) {
    const spinning = round?.phase === 'spinning';
    const reels = round?.reels ?? [0, 2, 3];
    const symbols = reels.map((symbol, index) => {
      const matched = round?.phase === 'settled' && round.payout > 0n && reels.filter(value => value === symbol).length >= 2;
      const strip = spinning ? Array.from({ length: 9 }, (_, step) => step === 8 ? symbol : (step + index) % reelSymbols.length) : [symbol];
      return `<div class="arcade-reel ${matched ? 'is-match' : ''}" aria-label="${index + 1}. makara ${spinning ? 'dönüyor' : reelSymbols[symbol]}">
        <div class="arcade-reel-strip" aria-hidden="true">${strip.map(value => `<span class="reel-symbol-${value}">${reelSymbols[value]}</span>`).join('')}</div></div>`;
    }).join('');
    return `<div class="arcade-slot-machine"><div class="arcade-slot-lights" aria-hidden="true"></div>
      <div class="arcade-reels ${spinning ? 'is-spinning' : ''}" aria-label="Makaralar">${symbols}</div>
      <div class="arcade-slot-foot" aria-hidden="true"></div></div>`;
  }

  function skillOddsMarkup(game, round) {
    if (!['darts', 'memory', 'blocks'].includes(game)) return '';
    const level = skillLevel(round);
    const current = skillOdds[level];
    const profitChance = current ? current.weights[2] + current.weights[3] : 0;
    return `<details class="arcade-odds"><summary>Ödül olasılıkları</summary>
      <p>Seviye yükseldikçe 2× ve 3× ödül şansı artar. 1× bahsi iade eder. Seviye açılmazsa bahis kaybedilir.</p>
      <table><thead><tr><th scope="col">Seviye</th><th scope="col">0×</th><th scope="col">1×</th><th scope="col">2×</th><th scope="col">3×</th></tr></thead>
      <tbody>${skillOdds.map(({ label, weights }, index) => `<tr class="${index === level ? 'is-current' : ''}"><th scope="row">${label}</th>${weights.map(weight => `<td>%${weight}</td>`).join('')}</tr>`).join('')}</tbody></table></details>
      ${round ? `<p class="arcade-current-odds">${current ? `${current.label} seviye · %${profitChance} kazanç şansı` : round.phase === 'settled' ? 'Ödül seviyesi açılmadı.' : 'Ödül seviyesi henüz açılmadı.'}</p>` : ''}`;
  }

  function boardMarkup(game, round) {
    const playing = round?.phase === 'playing';
    if (game === 'wheel') {
      const sectors = wheelSectors.map((value, index) => {
        const landed = round?.phase === 'settled' && round.sector === index;
        return `<span${landed ? ' class="is-landing"' : ''}><b>${value ? value + '×' : '·'}</b></span>`;
      }).join('');
      return `<div class="arcade-wheel-machine"><div class="arcade-wheel" aria-hidden="true"><div class="arcade-wheel-rim"></div>
        <div class="arcade-wheel-arrow"></div><div class="arcade-wheel-disc">${sectors}</div><i></i></div>
        <div class="arcade-wheel-base" aria-hidden="true"></div></div>`;
    }
    if (game === 'slots') return slotBoard(round);
    if (game === 'darts') {
      const shots = round?.shots ?? [];
      return `<div class="arcade-dart-score"><div class="arcade-dart-shots" aria-label="Atış puanları">${Array.from({ length: 3 }, (_, index) =>
        `<span class="${shots[index] ? 'is-thrown' : ''}" aria-label="${index + 1}. atış">${shots[index]?.points ?? '–'}</span>`).join('')}</div><span>Toplam <strong>${round?.score ?? 0}</strong></span></div>
        <div class="arcade-target" aria-hidden="true"><i class="arcade-cross"></i><span class="arcade-target-values"><b>5</b><b>3</b><b>2</b><b>1</b></span>${shots.filter(shot => shot.point).map(shot => `<i class="arcade-hit" data-points="${shot.points}"></i>`).join('')}${playing ? '<i class="arcade-aim"></i>' : ''}</div>
        ${playing ? `<div class="arcade-dart-actions"><div class="arcade-dart-clock"><span>Atış süresi <strong>3,5 sn</strong></span><progress value="${dartShotMs}" max="${dartShotMs}" aria-label="Kalan atış süresi"></progress></div>${gameButton('Atış yap', 'dart', '', { classes: 'arcade-button arcade-primary arcade-throw' })}</div>` : ''}`;
    }
    if (game === 'blocks') {
      const score = round?.score ?? 0;
      return `<div class="arcade-block-hud"><div class="arcade-metrics"><span>Hamle <strong>${round?.moves ?? 0}/${blockMoves}</strong></span><span>Puan <strong>${score}</strong></span>${round?.gain ? `<span class="arcade-gain">+${round.gain}</span>` : ''}</div>
        <div class="arcade-block-goals"><progress aria-label="Ödül hedefine ilerleme" value="${Math.min(score, blockGoals.at(-1))}" max="${blockGoals.at(-1)}"></progress><div>${blockGoals.map((threshold, index) => `<span class="${score >= threshold ? 'is-earned' : ''}"><strong>${skillOdds[index].label}</strong> ${threshold}</span>`).join('')}</div></div></div>
        <div class="arcade-block-grid">${(round?.board ?? Array.from({ length: 36 }, (_, index) => (index + Math.floor(index / 6)) % 4)).map((colour, index) =>
          gameButton(`<span>${blockSymbols[colour]}</span>`, 'block', index, { classes: `arcade-block block-${colour}${round?.falling.has(index) ? ' is-falling' : ''}`, disabled: !playing, ariaLabel: `${index + 1}. blok, ${blockNames[colour]}` })).join('')}</div>`;
    }
    const scratch = game === 'scratch';
    const size = scratch ? 9 : 12;
    const opened = scratch ? round?.opened.size ?? 0 : (round?.matched.size ?? 0) / 2;
    const progress = scratch ? `<span>Açılan kart <strong>${opened}/3</strong></span>`
      : `<span>Hamle <strong>${round?.moves ?? 0}/${memoryMoves}</strong></span><span>Eşleşme <strong>${opened}/6</strong></span>`;
    return `<div class="arcade-card-progress"><div class="arcade-metrics">${progress}</div><div class="arcade-progress-dots" aria-hidden="true">${Array.from({ length: scratch ? 3 : 6 }, (_, index) => `<i class="${index < opened ? 'is-filled' : ''}"></i>`).join('')}</div></div>
      <div class="arcade-tiles ${scratch ? 'scratch-tiles' : 'memory-tiles'}">${Array.from({ length: size }, (_, index) => {
      const matched = !scratch && round?.matched.has(index);
      const revealed = scratch ? round?.opened.has(index) : matched || round?.opened.includes(index);
      const symbol = revealed ? (scratch ? scratchSymbols[round.cards[index]] : round.cards[index]) : scratch ? '✦' : '◈';
      const colour = revealed ? (scratch ? round.cards[index] : memorySymbols.indexOf(symbol)) : '';
      const classes = ['arcade-tile', revealed && `is-open card-symbol-${colour}`, matched && 'is-matched',
        round?.lastRevealed === index && 'is-revealing'].filter(Boolean).join(' ');
      return gameButton(`<span class="arcade-tile-face">${symbol}</span>${matched ? '<span class="arcade-match-mark" aria-hidden="true">✓</span>' : ''}`, scratch ? 'scratch' : 'memory', index, { classes,
        disabled: !playing || revealed || (!scratch && round.opened.length === 2), ariaLabel: `${index + 1}. kart${revealed ? ', ' + symbol : ''}` });
    }).join('')}</div>`;
  }

  function gameContent() {
    const { game, coins, rounds } = session;
    const wallet = `<div class="arcade-wallet"><span class="arcade-coin" aria-hidden="true">◈</span><div><span>Oyun bakiyesi</span><strong data-game-coins>${format(coins)}</strong><small>coin</small></div></div>`;
    if (!game) {
      return `<header class="arcade-heading arcade-banner"><div><h1>Oyunlar</h1><p>Bir oyun seç ve oynamaya başla.</p></div>${wallet}</header>
        <div class="arcade-grid">${Object.entries(games).map(([id, details]) => gameButton(
          `<span class="arcade-card-cover" aria-hidden="true"><span class="arcade-card-art">${details.symbol}</span></span>
           <span class="arcade-card-text"><strong>${details.name}</strong><span>${details.summary}</span></span><span class="arcade-card-arrow" aria-hidden="true">→</span>`,
          'select', id, { classes: `arcade-card arcade-${id}` })).join('')}</div>`;
    }
    const details = games[game];
    const round = rounds[game];
    const active = Boolean(round && round.phase !== 'settled');
    let result = '';
    if (round?.phase === 'settled') {
      const difference = round.payout - round.stake;
      const message = difference > 0n ? `+${format(difference)} coin kazandın` : difference === 0n ? 'Bahsin geri döndü' : `${format(round.stake)} coin kaybettin`;
      const sectorLabel = game === 'wheel' ? `Dilim ${round.sector + 1}/${wheelSectors.length} · ` : '';
      result = `<div class="arcade-result ${difference > 0n ? 'is-win' : ''}" role="status"><strong>${message}</strong><span>${sectorLabel}Toplam ödül ${format(round.payout)} coin</span></div>`;
    }
    return `<div class="arcade-game arcade-${game}">
      <header class="arcade-heading arcade-game-heading"><div>${gameButton('← Tüm oyunlar', 'library', '', { classes: 'arcade-button arcade-back' })}<h1>${details.name}</h1><p>${details.rules}</p></div>${wallet}</header>
      <div class="arcade-play-layout"><div class="arcade-stage">${boardMarkup(game, round)}</div>
        <section class="arcade-controls" aria-label="Bahis">${result}
          ${active ? `<span class="arcade-active-bet">Bu turdaki bahis <strong>${format(round.stake)} coin</strong></span>` : stakeForm(details.start, coins)}
          ${skillOddsMarkup(game, round)}</section>
      </div></div>`;
  }

  function render() {
    return session ? `<section id="games-root" class="arcade" aria-label="Oyunlar">${gameContent()}</section>` : '';
  }

  function positionMarker(marker, point) {
    marker.style.left = `${50 + point.x * 43}%`;
    marker.style.top = `${50 + point.y * 43}%`;
  }

  function moveAim(now) {
    aimFrame = undefined;
    const dot = document.querySelector('#games-root .arcade-aim');
    const round = session?.rounds.darts;
    if (!dot || session?.game !== 'darts' || round?.phase !== 'playing') return;
    const remaining = Math.max(0, dartShotMs - (now - round.aimStarted));
    const clock = dot.closest('.arcade-stage').querySelector('.arcade-dart-clock');
    const label = `${(remaining / 1000).toFixed(1).replace('.', ',')} sn`;
    clock.querySelector('progress').value = remaining;
    if (clock.querySelector('strong').textContent !== label) clock.querySelector('strong').textContent = label;
    round.aimPoint = aim(round, Math.min(now, round.aimStarted + dartShotMs));
    positionMarker(dot, round.aimPoint);
    aimFrame = requestAnimationFrame(moveAim);
  }

  function mount() {
    const root = document.querySelector('#games-root');
    const form = root?.querySelector('.arcade-stakes');
    if (form) syncStakeForm(form);
    const round = session?.rounds[session.game];
    if (!root || !round) return;
    if (round.game === 'wheel') {
      const disc = root.querySelector('.arcade-wheel-disc');
      disc.style.transform = `rotate(${round.targetAngle}deg)`;
      const elapsed = performance.now() - round.startedAt;
      if (round.phase === 'spinning' && elapsed < round.duration) {
        const angles = round.startAngle === round.endAngle
          ? [round.startAngle, round.startAngle + 12, round.endAngle]
          : [round.startAngle, round.endAngle];
        const animation = disc.animate(angles.map(angle => ({ transform: `rotate(${angle}deg)` })),
          { duration: round.duration, fill: 'both', easing: 'cubic-bezier(.2,.65,.22,1)' });
        animation.currentTime = elapsed;
      }
    }
    if (round.game === 'darts') {
      const hits = round.shots.filter(shot => shot.point);
      root.querySelectorAll('.arcade-hit').forEach((marker, index) => positionMarker(marker, hits[index].point));
      if (round.phase === 'playing' && aimFrame === undefined) moveAim(performance.now());
    }
  }

  function update() {
    const root = document.querySelector('#games-root');
    if (!root || !session) return;
    const focus = root.querySelector('button:focus-visible');
    const stakeInput = root.querySelector('#arcade-stake-input:focus');
    const openOdds = root.querySelector('.arcade-odds[open]');
    root.innerHTML = gameContent();
    const odds = root.querySelector('.arcade-odds');
    if (openOdds && odds) odds.open = true;
    if (focus) {
      const next = [...root.querySelectorAll('button:not(:disabled)')].find(button =>
        button.dataset.gameAction === focus.dataset.gameAction && button.dataset.gameValue === focus.dataset.gameValue);
      (next ?? root.querySelector('.arcade-back'))?.focus({ preventScroll: true });
    }
    mount();
    if (stakeInput) {
      const next = root.querySelector('#arcade-stake-input');
      next?.focus({ preventScroll: true });
      next?.setSelectionRange(stakeInput.selectionStart, stakeInput.selectionEnd);
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('#games-root [data-game-action]');
    if (!button || button.disabled || !session) return;
    const action = button.dataset.gameAction;
    const value = button.dataset.gameValue;
    if (action === 'select' || action === 'library') {
      session.game = action === 'select' ? value : undefined;
      const content = button.closest('.content');
      update();
      if (content) content.scrollTop = 0;
      return;
    }
    if (action === 'stake-key') {
      const form = button.form;
      const input = form.querySelector('input');
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const from = value === 'back' && start === end ? Math.max(0, start - 1) : start;
      const digit = value === 'back' ? '' : value;
      session.stakeInput = value === 'clear' ? '' : input.value.slice(0, from) + digit + input.value.slice(end);
      syncStakeForm(form);
      input.setSelectionRange(from + digit.length, from + digit.length);
      return;
    }
    const round = session.rounds[session.game];
    if (round?.phase !== 'playing') return;
    if (action === 'scratch') revealScratch(round, Number(value));
    else if (action === 'memory') flipMemory(round, Number(value));
    else if (action === 'dart') throwDart(round);
    else if (action === 'block') popBlocks(round, Number(value));
  });

  document.addEventListener('input', event => {
    const input = event.target;
    if (!session || !input.matches('#arcade-stake-input')) return;
    session.stakeInput = input.value;
    syncStakeForm(input.form);
  });

  document.addEventListener('submit', event => {
    if (!session || !event.target.matches('#games-root .arcade-stakes')) return;
    event.preventDefault();
    begin();
  });

  document.addEventListener('pointerdown', event => {
    const cell = event.target.closest('#games-root [data-game-action="scratch"]:enabled');
    if (!cell || !event.isPrimary || event.button !== 0) return;
    scratchPointer = { id: event.pointerId, index: Number(cell.dataset.gameValue), x: event.clientX, y: event.clientY };
  });
  document.addEventListener('pointermove', event => {
    if (scratchPointer?.id !== event.pointerId || !event.buttons || session?.game !== 'scratch') return;
    const round = session.rounds.scratch;
    if (round?.phase !== 'playing' || Math.hypot(event.clientX - scratchPointer.x, event.clientY - scratchPointer.y) < 9) return;
    const root = document.querySelector('#games-root');
    if (!root) return;
    if (!root.hasPointerCapture(event.pointerId)) root.setPointerCapture(event.pointerId);
    const next = document.elementFromPoint(event.clientX, event.clientY)?.closest('#games-root [data-game-action="scratch"]:enabled');
    const nextIndex = next ? Number(next.dataset.gameValue) : undefined;
    revealScratch(round, scratchPointer.index);
    if (nextIndex !== undefined && round.phase === 'playing') revealScratch(round, nextIndex);
  });
  for (const event of ['pointerup', 'pointercancel']) document.addEventListener(event, () => { scratchPointer = undefined; });

  return { startSession, endSession, render, mount };
})();
