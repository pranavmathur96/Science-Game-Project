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
let currentTopicId = null;
let currentGameKit = null;

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
// GAME HUB
// ============================================================
async function openGameHub(topicId, title) {
  currentTopicId = topicId;
  topicListView.classList.add('hidden');
  gameHubView.classList.remove('hidden');
  document.getElementById('hubTopicTitle').textContent = title;

  try {
    const data = await apiCall(`/api/student/topics/${topicId}/kit`);
    currentGameKit = data.gameKit;
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
  if (type === 'quiz') renderQuiz(currentGameKit.quiz);
  if (type === 'sort') renderSort(currentGameKit.sort);
  if (type === 'match') renderMatch(currentGameKit.match);
}

// ---- record an attempt with the backend ----
async function recordAttempt({ gameType, score, maxScore, timeSpentSeconds, completed }) {
  try {
    await apiCall('/api/student/attempts', {
      method: 'POST',
      body: { topicId: currentTopicId, gameType, score, maxScore, timeSpentSeconds, completed }
    });
  } catch (err) {
    // Don't block the kid's play experience on a logging failure —
    // just let them know quietly so a teacher/parent can be told if it persists.
    console.error('Failed to record attempt:', err);
    showToast('Could not save your progress this time.', true);
  }
}

// ============================================================
// QUIZ GAME
// ============================================================
function renderQuiz(quiz) {
  const panel = document.getElementById('gamePanel');
  if (!quiz || !Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    panel.innerHTML = `<div class="game-card"><p>No quiz available.</p></div>`;
    return;
  }

  let current = 0;
  let score = 0;
  let answered = false;
  const startTime = Date.now();

  function renderQuestion() {
    const q = quiz.questions[current];
    panel.innerHTML = `
      <div class="game-card">
        <h2>${escapeHtml(quiz.title || 'Quiz')}</h2>
        <div class="quiz-progress">Question ${current + 1} of ${quiz.questions.length}</div>
        <div class="quiz-question">${escapeHtml(q.question)}</div>
        <div class="quiz-options" id="quizOptions"></div>
        <div class="quiz-explain" id="quizExplain"></div>
        <button class="quiz-next" id="quizNext">${current === quiz.questions.length - 1 ? 'See results' : 'Next question →'}</button>
      </div>
    `;
    const optionsEl = panel.querySelector('#quizOptions');
    answered = false;

    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-option';
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        if (answered) return;
        answered = true;
        const isCorrect = i === q.correctIndex;
        if (isCorrect) score++;

        [...optionsEl.children].forEach((el, j) => {
          el.disabled = true;
          if (j === q.correctIndex) el.classList.add('correct');
          else if (j === i) el.classList.add('incorrect');
        });

        const explainEl = panel.querySelector('#quizExplain');
        explainEl.textContent = (isCorrect ? '✅ ' : '❌ ') + (q.explanation || '');
        explainEl.classList.add('show');
        panel.querySelector('#quizNext').classList.add('show');
      });
      optionsEl.appendChild(btn);
    });

    panel.querySelector('#quizNext').addEventListener('click', () => {
      current++;
      if (current < quiz.questions.length) renderQuestion();
      else renderDone();
    });
  }

  function renderDone() {
    const timeSpent = Math.round((Date.now() - startTime) / 1000);
    panel.innerHTML = `
      <div class="game-card quiz-done">
        <h2>${escapeHtml(quiz.title || 'Quiz')} — done!</h2>
        <div class="big-score">${score} / ${quiz.questions.length}</div>
        <p>${score === quiz.questions.length ? 'Perfect score! 🎉' : 'Nice work!'}</p>
        <button class="replay-btn" id="quizReplay">Play again</button>
      </div>
    `;
    recordAttempt({
      gameType: 'quiz', score, maxScore: quiz.questions.length,
      timeSpentSeconds: timeSpent, completed: true
    });
    panel.querySelector('#quizReplay').addEventListener('click', () => { current = 0; score = 0; renderQuestion(); });
  }

  renderQuestion();
}

// ============================================================
// SORT GAME
// ============================================================
function renderSort(sort) {
  const panel = document.getElementById('gamePanel');
  if (!sort || !Array.isArray(sort.categories) || !Array.isArray(sort.items)) {
    panel.innerHTML = `<div class="game-card"><p>No sorting game available.</p></div>`;
    return;
  }

  const startTime = Date.now();
  let placedCount = 0;
  let wrongMoves = 0;
  const items = shuffle(sort.items.map((it, idx) => ({ ...it, id: `item-${idx}` })));

  panel.innerHTML = `
    <div class="game-card">
      <h2>${escapeHtml(sort.title || 'Sort it out')}</h2>
      <div class="sort-tray" id="sortTray"></div>
      <div class="sort-zones" id="sortZones"></div>
      <div class="sort-done-banner hidden" id="sortDoneBanner">🎉 All sorted! Great work.</div>
    </div>
  `;

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
// ============================================================
function renderMatch(match) {
  const panel = document.getElementById('gamePanel');
  if (!match || !Array.isArray(match.pairs) || match.pairs.length === 0) {
    panel.innerHTML = `<div class="game-card"><p>No matching game available.</p></div>`;
    return;
  }

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
    </div>
  `;

  const termsEl = panel.querySelector('#matchTerms');
  const defsEl = panel.querySelector('#matchDefs');
  const statusEl = panel.querySelector('#matchStatus');

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
