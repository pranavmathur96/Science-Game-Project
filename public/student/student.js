// public/student/student.js

if (!Auth.isLoggedIn() || Auth.getUser().role !== 'student') {
  window.location.href = '../index.html';
}

document.getElementById('userName').textContent = Auth.getUser().displayName;
document.getElementById('logoutBtn').addEventListener('click', () => {
  Auth.clearSession();
  window.location.href = '../index.html';
});

const topicListView = document.getElementById('topicListView');
const gameHubView = document.getElementById('gameHubView');
const badgeShelfView = document.getElementById('badgeShelfView');
let currentTopicId = null;
let currentGameKit = null;
let currentModes = { quiz: 0, sort: 0, match: 0 };

// ============================================================
// TOPIC LIST
// ============================================================
const TOPIC_EMOJIS = ['🔬', '🌍', '🪐', '🌱', '⚡', '🧪', '🦋', '🌊', '🔥', '❄️'];
function emojiForTopic(title) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash + title.charCodeAt(i)) % TOPIC_EMOJIS.length;
  return TOPIC_EMOJIS[hash];
}

async function loadTopicList() {
  try {
    const { topics } = await apiCall('/api/student/topics');
    const list = document.getElementById('topicList');
    const empty = document.getElementById('topicListEmpty');
    list.innerHTML = '';
    empty.classList.toggle('hidden', topics.length > 0);

    loadFeaturedChallenge(topics);

    topics.forEach(t => {
      const card = document.createElement('div');
      card.className = 'topic-card';

      const gameTypes = ['quiz', 'sort', 'match'];
      const dots = gameTypes.map(gt => {
        const progress = t.progress.find(p => p.game_type === gt);
        let cls = '';
        let icon = '';
        if (progress && progress.mastered) { cls = 'mastered'; icon = '✓'; }
        else if (progress) { cls = 'attempted'; icon = '·'; }
        return `<span class="progress-dot ${cls}">${icon}</span>`;
      }).join('');

      card.innerHTML = `
        <div class="topic-emoji">${emojiForTopic(t.title)}</div>
        <h3>${escapeHtml(t.title)}</h3>
        <div class="progress-dots">${dots}</div>
      `;
      card.addEventListener('click', () => openGameHub(t.id, t.title));
      list.appendChild(card);
    });
  } catch (err) {
    showToast(err.message, true);
  }
}

// ============================================================
// FEATURED CHALLENGE (daily spotlight, same pick for the whole class)
// ============================================================
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function loadFeaturedChallenge(topics) {
  const banner = document.getElementById('featuredChallengeBanner');
  banner.innerHTML = '';
  if (topics.length === 0) return;

  const classId = topics[0].class_id;
  const todayKey = new Date().toISOString().slice(0, 10);
  const featured = topics[hashString(`${todayKey}-${classId}`) % topics.length];

  banner.innerHTML = `
    <div class="featured-banner" id="featuredBannerCard">
      <div class="featured-label">✨ Today's Featured Challenge</div>
      <div class="featured-title">${emojiForTopic(featured.title)} ${escapeHtml(featured.title)}</div>
    </div>
  `;
  banner.querySelector('#featuredBannerCard').addEventListener('click', () => openGameHub(featured.id, featured.title));
}

// ============================================================
// GAME HUB
// ============================================================
async function openGameHub(topicId, title) {
  currentTopicId = topicId;
  badgeShelfView.classList.add('hidden');
  topicListView.classList.add('hidden');
  gameHubView.classList.remove('hidden');
  document.getElementById('hubTopicTitle').textContent = title;

  try {
    const data = await apiCall(`/api/student/topics/${topicId}/kit`);
    currentGameKit = data.gameKit;
    currentModes = data.modes || { quiz: 0, sort: 0, match: 0 };
    renderGamePicker();
    selectGame('quiz');
  } catch (err) {
    showToast(err.message, true);
  }
}

document.getElementById('backToTopics').addEventListener('click', () => {
  gameHubView.classList.add('hidden');
  topicListView.classList.remove('hidden');
  loadTopicList();
});

function renderGamePicker() {
  const picker = document.getElementById('gamePicker');
  const games = [
    { type: 'quiz', emoji: '📝', label: 'Quiz' },
    { type: 'sort', emoji: '🗂️', label: 'Sort' },
    { type: 'match', emoji: '🔗', label: 'Match' },
  ];
  picker.innerHTML = '';
  games.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'game-pick-btn';
    btn.dataset.type = g.type;
    btn.innerHTML = `<span class="emoji">${g.emoji}</span><span>${g.label}</span>`;
    btn.addEventListener('click', () => selectGame(g.type));
    picker.appendChild(btn);
  });
}

function selectGame(type) {
  document.querySelectorAll('.game-pick-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  if (type === 'quiz') renderQuiz(currentGameKit.quiz, currentModes.quiz);
  if (type === 'sort') renderSort(currentGameKit.sort, currentModes.sort);
  if (type === 'match') renderMatch(currentGameKit.match, currentModes.match);
}

// Re-fetches the kit (so a rotated slice/mode is served) and re-renders the
// same game type — used by in-game "Play again" buttons so replaying
// without leaving the hub still feels different each time.
async function replayGame(gameType) {
  try {
    const data = await apiCall(`/api/student/topics/${currentTopicId}/kit`);
    currentGameKit = data.gameKit;
    currentModes = data.modes || { quiz: 0, sort: 0, match: 0 };
    if (gameType === 'quiz') renderQuiz(currentGameKit.quiz, currentModes.quiz);
    if (gameType === 'sort') renderSort(currentGameKit.sort, currentModes.sort);
    if (gameType === 'match') renderMatch(currentGameKit.match, currentModes.match);
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---- record an attempt with the backend ----
async function recordAttempt({ gameType, score, maxScore, timeSpentSeconds, completed }) {
  try {
    const result = await apiCall('/api/student/attempts', {
      method: 'POST',
      body: { topicId: currentTopicId, gameType, score, maxScore, timeSpentSeconds, completed }
    });
    if (result.newBadges && result.newBadges.length > 0) {
      showBadgeCelebration(result.newBadges);
    }
    return result;
  } catch (err) {
    // Don't block the kid's play experience on a logging failure —
    // just let them know quietly so a teacher/parent can be told if it persists.
    console.error('Failed to record attempt:', err);
    showToast('Could not save your progress this time.', true);
    return null;
  }
}

// ============================================================
// QUIZ GAME
// mode 0 = classic, 1 = Speed Round (countdown per question),
// 2 = Lives mode (3 hearts, ends early if hearts run out)
// ============================================================
function renderQuiz(quiz, mode = 0) {
  const panel = document.getElementById('gamePanel');
  if (!quiz || !Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    panel.innerHTML = `<div class="game-card"><p>No quiz available.</p></div>`;
    return;
  }

  const isSpeedRound = mode === 1;
  const isLives = mode === 2;
  const modeLabel = isSpeedRound ? '⚡ Speed Round' : (isLives ? '❤️ Lives Mode' : '');
  const SPEED_SECONDS = 15;
  const START_LIVES = 3;

  let current = 0;
  let score = 0;
  let questionsShown = 0;
  let lives = START_LIVES;
  let answered = false;
  let timerInterval = null;
  const startTime = Date.now();

  function clearTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function renderQuestion() {
    clearTimer();
    const q = quiz.questions[current];
    questionsShown = current + 1;
    panel.innerHTML = `
      <div class="game-card">
        <h2>${escapeHtml(quiz.title || 'Quiz')}</h2>
        ${modeLabel ? `<div class="mode-banner">${modeLabel}</div>` : ''}
        <div class="quiz-progress-row">
          <div class="quiz-progress">Question ${current + 1} of ${quiz.questions.length}</div>
          ${isLives ? `<div class="lives-row">${'❤️'.repeat(lives)}${'🖤'.repeat(START_LIVES - lives)}</div>` : ''}
        </div>
        ${isSpeedRound ? `<div class="timer-bar-track"><div class="timer-bar-fill" id="timerBarFill"></div></div>` : ''}
        <div class="quiz-question">${escapeHtml(q.question)}</div>
        <div class="quiz-options" id="quizOptions"></div>
        <div class="quiz-explain" id="quizExplain"></div>
        <button class="quiz-next" id="quizNext">${current === quiz.questions.length - 1 ? 'See results' : 'Next question →'}</button>
      </div>
    `;
    const optionsEl = panel.querySelector('#quizOptions');
    answered = false;

    function handleAnswer(chosenIndex, isCorrect) {
      if (answered) return;
      answered = true;
      clearTimer();
      if (isCorrect) score++;
      else if (isLives) lives--;

      [...optionsEl.children].forEach((el, j) => {
        el.disabled = true;
        if (j === q.correctIndex) el.classList.add('correct');
        else if (j === chosenIndex) el.classList.add('incorrect');
      });

      const explainEl = panel.querySelector('#quizExplain');
      explainEl.textContent = (isCorrect ? '✅ ' : '❌ ') + (q.explanation || '');
      explainEl.classList.add('show');

      const nextBtn = panel.querySelector('#quizNext');
      if (isLives && lives <= 0) nextBtn.textContent = 'See results';
      nextBtn.classList.add('show');
    }

    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-option';
      btn.textContent = opt;
      btn.addEventListener('click', () => handleAnswer(i, i === q.correctIndex));
      optionsEl.appendChild(btn);
    });

    if (isSpeedRound) {
      let timeLeft = SPEED_SECONDS;
      const fill = panel.querySelector('#timerBarFill');
      timerInterval = setInterval(() => {
        timeLeft -= 1;
        if (fill) fill.style.width = Math.max(0, (timeLeft / SPEED_SECONDS) * 100) + '%';
        if (timeLeft <= 0) {
          clearTimer();
          if (!answered) handleAnswer(-1, false);
        }
      }, 1000);
    }

    panel.querySelector('#quizNext').addEventListener('click', () => {
      current++;
      if (isLives && lives <= 0) { renderDone(); return; }
      if (current < quiz.questions.length) renderQuestion();
      else renderDone();
    });
  }

  function renderDone() {
    clearTimer();
    const timeSpent = Math.round((Date.now() - startTime) / 1000);
    // maxScore reflects questions actually shown, not the full window size —
    // matters for Lives mode, which can end before all questions are seen.
    const maxScore = questionsShown;
    const outOfLives = isLives && lives <= 0;
    panel.innerHTML = `
      <div class="game-card quiz-done">
        <h2>${escapeHtml(quiz.title || 'Quiz')} — done!</h2>
        <div class="big-score">${score} / ${maxScore}</div>
        <p>${outOfLives ? 'Out of hearts — nice try!' : (score === maxScore && maxScore > 0 ? 'Perfect score! 🎉' : 'Nice work!')}</p>
        <button class="replay-btn" id="quizReplay">Play again</button>
      </div>
    `;
    recordAttempt({ gameType: 'quiz', score, maxScore, timeSpentSeconds: timeSpent, completed: true });
    panel.querySelector('#quizReplay').addEventListener('click', () => replayGame('quiz'));
  }

  renderQuestion();
}

// ============================================================
// SORT GAME
// mode 0 = classic, 1 = Timed Sort (visible countdown, beat-the-clock framing)
// ============================================================
function renderSort(sort, mode = 0) {
  const panel = document.getElementById('gamePanel');
  if (!sort || !Array.isArray(sort.categories) || !Array.isArray(sort.items)) {
    panel.innerHTML = `<div class="game-card"><p>No sorting game available.</p></div>`;
    return;
  }

  const isTimed = mode === 1;
  const TIMED_SECONDS = 60;
  const startTime = Date.now();
  let placedCount = 0;
  let wrongMoves = 0;
  let timerInterval = null;
  const items = shuffle(sort.items.map((it, idx) => ({ ...it, id: `item-${idx}` })));

  panel.innerHTML = `
    <div class="game-card">
      <h2>${escapeHtml(sort.title || 'Sort it out')}</h2>
      ${isTimed ? `<div class="mode-banner">⏱️ Timed Sort <span id="sortTimerText">${TIMED_SECONDS}s</span></div>` : ''}
      <div class="sort-tray" id="sortTray"></div>
      <div class="sort-zones" id="sortZones"></div>
      <div class="sort-done-banner hidden" id="sortDoneBanner">
        🎉 All sorted! Great work.
        <button class="replay-btn" id="sortReplay">Play again</button>
      </div>
    </div>
  `;

  if (isTimed) {
    let timeLeft = TIMED_SECONDS;
    const timerText = panel.querySelector('#sortTimerText');
    timerInterval = setInterval(() => {
      timeLeft -= 1;
      if (timerText) timerText.textContent = `${Math.max(0, timeLeft)}s`;
      if (timeLeft <= 0) clearInterval(timerInterval);
    }, 1000);
  }

  panel.querySelector('#sortReplay').addEventListener('click', () => replayGame('sort'));

  const tray = panel.querySelector('#sortTray');
  const zonesEl = panel.querySelector('#sortZones');

  sort.categories.forEach(cat => {
    const zone = document.createElement('div');
    zone.className = 'sort-zone';
    zone.dataset.categoryId = cat.id;
    zone.innerHTML = `<div class="sort-zone-title">${escapeHtml(cat.emoji || '')} ${escapeHtml(cat.label)}</div><div class="sort-zone-cards"></div>`;
    zonesEl.appendChild(zone);

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('dragover');
      handleSortDrop(zone, e.dataTransfer.getData('text/plain'));
    });
    zone.addEventListener('click', () => {
      const selected = tray.querySelector('.sort-card.selected');
      if (selected) handleSortDrop(zone, selected.dataset.itemId);
    });
  });

  function makeCard(item) {
    const card = document.createElement('div');
    card.className = 'sort-card';
    card.draggable = true;
    card.dataset.itemId = item.id;
    card.innerHTML = `<span>${escapeHtml(item.emoji || '')}</span><span>${escapeHtml(item.text)}</span>`;
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', item.id);
      setTimeout(() => card.classList.add('dragging'), 0);
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('click', () => {
      tray.querySelectorAll('.sort-card.selected').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
    return card;
  }

  items.forEach(item => tray.appendChild(makeCard(item)));

  function handleSortDrop(zoneEl, itemId) {
    const item = items.find(it => it.id === itemId);
    if (!item) return;
    const cardEl = tray.querySelector(`[data-item-id="${itemId}"]`);
    if (!cardEl) return;

    if (zoneEl.dataset.categoryId === item.categoryId) {
      const placed = makeCard(item);
      placed.draggable = false;
      placed.style.cursor = 'default';
      zoneEl.querySelector('.sort-zone-cards').appendChild(placed);
      cardEl.remove();
      placedCount++;
      if (placedCount === items.length) {
        if (timerInterval) clearInterval(timerInterval);
        document.getElementById('sortDoneBanner').classList.remove('hidden');
        const timeSpent = Math.round((Date.now() - startTime) / 1000);
        recordAttempt({
          gameType: 'sort', score: items.length, maxScore: items.length,
          timeSpentSeconds: timeSpent, completed: true
        });
      }
    } else {
      wrongMoves++;
      cardEl.classList.add('wrong-shake');
      setTimeout(() => cardEl.classList.remove('wrong-shake'), 400);
    }
  }
}

// ============================================================
// MATCH GAME
// mode 0 = classic click-to-pair, 1 = Memory Flip (face-down grid)
// ============================================================
function renderMatch(match, mode = 0) {
  const panel = document.getElementById('gamePanel');
  if (!match || !Array.isArray(match.pairs) || match.pairs.length === 0) {
    panel.innerHTML = `<div class="game-card"><p>No matching game available.</p></div>`;
    return;
  }

  if (mode === 1) { renderMemoryFlip(match); return; }

  const startTime = Date.now();
  let matchedCount = 0;
  let selectedTerm = null;
  let selectedDef = null;

  const pairs = match.pairs.map((p, idx) => ({ ...p, id: `pair-${idx}` }));
  const terms = shuffle(pairs.map(p => ({ id: p.id, text: p.term })));
  const defs = shuffle(pairs.map(p => ({ id: p.id, text: p.definition })));

  panel.innerHTML = `
    <div class="game-card">
      <h2>${escapeHtml(match.title || 'Match it up')}</h2>
      <div class="match-grid">
        <div><div class="match-col-label">Term</div><div id="matchTerms"></div></div>
        <div><div class="match-col-label">Definition</div><div id="matchDefs"></div></div>
      </div>
      <div class="match-status" id="matchStatus">Tap a term, then tap its matching definition.</div>
      <button class="replay-btn hidden" id="matchReplay">Play again</button>
    </div>
  `;

  const termsEl = panel.querySelector('#matchTerms');
  const defsEl = panel.querySelector('#matchDefs');
  const statusEl = panel.querySelector('#matchStatus');
  panel.querySelector('#matchReplay').addEventListener('click', () => replayGame('match'));

  terms.forEach(t => termsEl.appendChild(makeMatchItem(t, 'term')));
  defs.forEach(d => defsEl.appendChild(makeMatchItem(d, 'def')));

  function makeMatchItem(entry, kind) {
    const btn = document.createElement('button');
    btn.className = 'match-item';
    btn.textContent = entry.text;
    btn.dataset.pairId = entry.id;
    btn.addEventListener('click', () => {
      if (btn.classList.contains('matched')) return;
      if (kind === 'term') {
        termsEl.querySelectorAll('.match-item').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedTerm = btn;
      } else {
        defsEl.querySelectorAll('.match-item').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedDef = btn;
      }
      if (selectedTerm && selectedDef) checkMatch();
    });
    return btn;
  }

  function checkMatch() {
    if (selectedTerm.dataset.pairId === selectedDef.dataset.pairId) {
      selectedTerm.classList.remove('selected');
      selectedDef.classList.remove('selected');
      selectedTerm.classList.add('matched');
      selectedDef.classList.add('matched');
      matchedCount++;
      if (matchedCount === pairs.length) {
        statusEl.textContent = '🎉 All matched! Nice work.';
        panel.querySelector('#matchReplay').classList.remove('hidden');
        const timeSpent = Math.round((Date.now() - startTime) / 1000);
        recordAttempt({
          gameType: 'match', score: pairs.length, maxScore: pairs.length,
          timeSpentSeconds: timeSpent, completed: true
        });
      } else {
        statusEl.textContent = `${matchedCount} of ${pairs.length} matched.`;
      }
    } else {
      selectedTerm.classList.add('wrong');
      selectedDef.classList.add('wrong');
      setTimeout(() => {
        selectedTerm.classList.remove('wrong', 'selected');
        selectedDef.classList.remove('wrong', 'selected');
      }, 400);
    }
    selectedTerm = null;
    selectedDef = null;
  }
}

function renderMemoryFlip(match) {
  const panel = document.getElementById('gamePanel');
  const startTime = Date.now();
  let matchedCount = 0;
  let flippedCards = [];
  let lockBoard = false;

  const pairs = match.pairs.map((p, idx) => ({ id: `pair-${idx}`, term: p.term, definition: p.definition }));
  const cards = shuffle(pairs.flatMap(p => ([
    { pairId: p.id, text: p.term },
    { pairId: p.id, text: p.definition },
  ])));

  panel.innerHTML = `
    <div class="game-card">
      <h2>${escapeHtml(match.title || 'Match it up')}</h2>
      <div class="mode-banner">🧠 Memory Flip</div>
      <div class="memory-grid" id="memoryGrid"></div>
      <div class="match-status" id="matchStatus">Flip two cards to find a matching term and definition.</div>
      <button class="replay-btn hidden" id="matchReplay">Play again</button>
    </div>
  `;
  const grid = panel.querySelector('#memoryGrid');
  const statusEl = panel.querySelector('#matchStatus');
  panel.querySelector('#matchReplay').addEventListener('click', () => replayGame('match'));

  cards.forEach(card => {
    const el = document.createElement('button');
    el.className = 'memory-card';
    el.dataset.pairId = card.pairId;
    el.innerHTML = `
      <div class="memory-card-inner">
        <div class="memory-card-back">?</div>
        <div class="memory-card-front">${escapeHtml(card.text)}</div>
      </div>
    `;
    el.addEventListener('click', () => flipCard(el));
    grid.appendChild(el);
  });

  function flipCard(el) {
    if (lockBoard || el.classList.contains('flipped') || el.classList.contains('matched')) return;
    el.classList.add('flipped');
    flippedCards.push(el);

    if (flippedCards.length === 2) {
      lockBoard = true;
      const [a, b] = flippedCards;
      if (a.dataset.pairId === b.dataset.pairId && a !== b) {
        a.classList.add('matched');
        b.classList.add('matched');
        matchedCount++;
        flippedCards = [];
        lockBoard = false;
        if (matchedCount === pairs.length) {
          statusEl.textContent = '🎉 All matched! Nice work.';
          panel.querySelector('#matchReplay').classList.remove('hidden');
          const timeSpent = Math.round((Date.now() - startTime) / 1000);
          recordAttempt({
            gameType: 'match', score: pairs.length, maxScore: pairs.length,
            timeSpentSeconds: timeSpent, completed: true
          });
        } else {
          statusEl.textContent = `${matchedCount} of ${pairs.length} matched.`;
        }
      } else {
        setTimeout(() => {
          a.classList.remove('flipped');
          b.classList.remove('flipped');
          flippedCards = [];
          lockBoard = false;
        }, 800);
      }
    }
  }
}

// ============================================================
// MY BADGES
// ============================================================
document.getElementById('badgesNavBtn').addEventListener('click', openBadgeShelf);
document.getElementById('backToTopicsFromBadges').addEventListener('click', () => {
  badgeShelfView.classList.add('hidden');
  topicListView.classList.remove('hidden');
  loadTopicList();
});

async function openBadgeShelf() {
  topicListView.classList.add('hidden');
  gameHubView.classList.add('hidden');
  badgeShelfView.classList.remove('hidden');
  const content = document.getElementById('badgeShelfContent');
  content.innerHTML = '<div class="no-data-note">Loading…</div>';

  try {
    const { earned, locked } = await apiCall('/api/student/badges');
    let html = '';

    if (earned.length > 0) {
      html += `<div class="section-label">Earned (${earned.length})</div><div class="badge-grid">`;
      earned.forEach(b => { html += badgeCardHtml(b, true); });
      html += `</div>`;
    }
    if (locked.length > 0) {
      html += `<div class="section-label">Still locked</div><div class="badge-grid">`;
      locked.forEach(b => { html += badgeCardHtml(b, false); });
      html += `</div>`;
    }
    if (earned.length === 0 && locked.length === 0) {
      html = '<div class="no-data-note">No badges yet — play some games to start earning them!</div>';
    }
    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = '<div class="no-data-note">Could not load badges.</div>';
    showToast(err.message, true);
  }
}

function badgeCardHtml(b, isEarned) {
  return `
    <div class="badge-card ${isEarned ? 'earned' : 'locked'}">
      <div class="badge-emoji">${b.emoji}</div>
      <div class="badge-label">${escapeHtml(b.label)}</div>
      <div class="badge-desc">${escapeHtml(b.description)}</div>
    </div>
  `;
}

function showBadgeCelebration(badges) {
  const el = document.getElementById('badgeCelebration');
  el.innerHTML = badges.map(b => `
    <div class="celebration-badge">
      <div class="celebration-emoji">${b.emoji}</div>
      <div class="celebration-text">
        <div class="celebration-title">Badge earned!</div>
        <div class="celebration-label">${escapeHtml(b.label)}</div>
      </div>
    </div>
  `).join('');
  el.classList.remove('hidden');
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 300);
  }, 3500);
}

// ---- Utilities ----
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Init ----
loadTopicList();
