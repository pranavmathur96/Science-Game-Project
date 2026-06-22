// public/teacher/teacher.js

// ---- Handle token arriving via URL hash after Google OAuth ----
// After Google login, the server redirects to /teacher/index.html#token=...
// We read it here, store it in sessionStorage, then clean the URL.
(function handleOAuthHash() {
  if (!window.location.hash) return;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('token');
  const displayName = params.get('displayName');
  const role = params.get('role');
  if (token && role === 'teacher') {
    Auth.setSession(token, { role, displayName: decodeURIComponent(displayName || '') });
    // Clean the token out of the URL so it's not visible / accidentally shared
    history.replaceState(null, '', window.location.pathname);
  }
})();

// ---- Guard: must be logged in as a teacher ----
if (!Auth.isLoggedIn() || Auth.getUser().role !== 'teacher') {
  window.location.href = '../index.html';
}

document.getElementById('userName').textContent = Auth.getUser().displayName;
document.getElementById('logoutBtn').addEventListener('click', () => {
  Auth.clearSession();
  window.location.href = '../index.html';
});

// ---- View elements ----
const classListView = document.getElementById('classListView');
const classDetailView = document.getElementById('classDetailView');
const classList = document.getElementById('classList');
const classListEmpty = document.getElementById('classListEmpty');

let currentClassId = null;

// ============================================================
// CLASS LIST
// ============================================================
async function loadClassList() {
  try {
    const { classes } = await apiCall('/api/teacher/classes');
    classList.innerHTML = '';
    classListEmpty.classList.toggle('hidden', classes.length > 0);

    classes.forEach(c => {
      const card = document.createElement('div');
      card.className = 'class-card';
      card.innerHTML = `
        <h3>${escapeHtml(c.name)}</h3>
        <div class="meta">
          <span>🧑‍🎓 ${c.student_count} student${c.student_count === 1 ? '' : 's'}</span>
          <span>📚 ${c.active_topic_count} active topic${c.active_topic_count === 1 ? '' : 's'}</span>
        </div>
        <div class="code">${escapeHtml(c.class_code)}</div>
      `;
      card.addEventListener('click', () => openClassDetail(c.id));
      classList.appendChild(card);
    });
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---- New class modal ----
const newClassModal = document.getElementById('newClassModal');
const newClassName = document.getElementById('newClassName');
const newClassError = document.getElementById('newClassError');

function openNewClassModal() {
  newClassName.value = '';
  newClassError.textContent = '';
  newClassModal.classList.remove('hidden');
  newClassName.focus();
}
document.getElementById('newClassBtn').addEventListener('click', openNewClassModal);
document.getElementById('newClassBtnEmpty').addEventListener('click', openNewClassModal);
document.getElementById('cancelNewClass').addEventListener('click', () => newClassModal.classList.add('hidden'));

document.getElementById('confirmNewClass').addEventListener('click', async () => {
  const name = newClassName.value.trim();
  if (!name) { newClassError.textContent = 'Please enter a class name.'; return; }

  try {
    const result = await apiCall('/api/teacher/classes', { method: 'POST', body: { name } });
    newClassModal.classList.add('hidden');
    showToast(`Class created! Code: ${result.classCode}`);
    await loadClassList();
  } catch (err) {
    newClassError.textContent = err.message;
  }
});

// ============================================================
// CLASS DETAIL
// ============================================================
async function openClassDetail(classId) {
  currentClassId = classId;
  classListView.classList.add('hidden');
  classDetailView.classList.remove('hidden');
  switchTab('topics');
  await loadClassDetail();
}

document.getElementById('backToClasses').addEventListener('click', () => {
  classDetailView.classList.add('hidden');
  classListView.classList.remove('hidden');
  loadClassList();
});

let lastClassData = null;

async function loadClassDetail() {
  try {
    const data = await apiCall(`/api/teacher/classes/${currentClassId}`);
    lastClassData = data;
    document.getElementById('detailClassName').textContent = data.class.name;
    document.getElementById('detailClassCode').textContent = data.class.classCode;
    renderTopics(data.topics);
    renderRoster(data.roster);
  } catch (err) {
    showToast(err.message, true);
  }
}

document.getElementById('copyCodeBtn').addEventListener('click', () => {
  const code = document.getElementById('detailClassCode').textContent;
  navigator.clipboard?.writeText(code).then(() => showToast('Class code copied!'));
});

// ---- Tabs ----
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== `panel-${tab}`));
  if (tab === 'metrics') loadMetrics();
}

// ---- Topics ----
function renderTopics(topics) {
  const list = document.getElementById('topicList');
  list.innerHTML = '';
  if (topics.length === 0) {
    list.innerHTML = `<div class="no-attempts-note">No topics assigned yet. Type one above to generate games for your class.</div>`;
    return;
  }
  topics.forEach(t => {
    const card = document.createElement('div');
    card.className = 'topic-card';
    const date = new Date(t.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    card.innerHTML = `
      <div>
        <h4>${escapeHtml(t.title)}</h4>
        <div class="topic-date">Assigned ${date}</div>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <span class="topic-status ${t.status}">${t.status}</span>
        ${t.status === 'active' ? `<button class="archive-btn" data-topic-id="${t.id}">Archive</button>` : ''}
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('.archive-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await apiCall(`/api/teacher/topics/${btn.dataset.topicId}/archive`, { method: 'PATCH' });
        showToast('Topic archived.');
        loadClassDetail();
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });
}

const newTopicInput = document.getElementById('newTopicInput');
const assignTopicBtn = document.getElementById('assignTopicBtn');
const assignTopicLabel = document.getElementById('assignTopicLabel');
const topicError = document.getElementById('topicError');

assignTopicBtn.addEventListener('click', async () => {
  const title = newTopicInput.value.trim();
  topicError.textContent = '';
  if (!title) { topicError.textContent = 'Please enter a topic.'; return; }

  assignTopicBtn.disabled = true;
  assignTopicLabel.innerHTML = '<span class="spinner"></span> Generating games…';

  try {
    await apiCall(`/api/teacher/classes/${currentClassId}/topics`, { method: 'POST', body: { title } });
    newTopicInput.value = '';
    showToast(`Games generated for "${title}"!`);
    await loadClassDetail();
  } catch (err) {
    topicError.textContent = err.message;
  } finally {
    assignTopicBtn.disabled = false;
    assignTopicLabel.textContent = 'Generate & assign';
  }
});

// ---- Roster ----
function renderRoster(roster) {
  const list = document.getElementById('rosterList');
  list.innerHTML = '';
  if (roster.length === 0) {
    list.innerHTML = `<div class="no-attempts-note">No students have joined yet. Share the class code with them.</div>`;
    return;
  }
  roster.forEach(s => {
    const row = document.createElement('div');
    row.className = 'roster-row';
    row.innerHTML = `
      <span class="student-name">${escapeHtml(s.display_name)}</span>
      <span class="student-username">@${escapeHtml(s.username)}</span>
    `;
    list.appendChild(row);
  });
}

// ---- Metrics ----
async function loadMetrics() {
  const container = document.getElementById('metricsContent');
  container.innerHTML = '<div class="no-attempts-note">Loading…</div>';

  try {
    const data = await apiCall(`/api/teacher/classes/${currentClassId}/metrics`);

    if (data.roster.length === 0) {
      container.innerHTML = `<div class="no-attempts-note">No students in this class yet.</div>`;
      return;
    }
    if (data.attempts.length === 0) {
      container.innerHTML = `<div class="no-attempts-note">No games have been played yet.</div>`;
      return;
    }

    // Group attempts by student
    const byStudent = {};
    data.attempts.forEach(a => {
      if (!byStudent[a.student_id]) byStudent[a.student_id] = { name: a.student_name, rows: [] };
      byStudent[a.student_id].rows.push(a);
    });

    let html = '';
    Object.values(byStudent).forEach(student => {
      html += `<div class="section-label">${escapeHtml(student.name)}</div>`;
      html += `<table class="metrics-table"><thead><tr>
        <th>Topic</th><th>Game</th><th>Best score</th><th>Mastered</th><th>Time spent</th><th>Attempts</th>
      </tr></thead><tbody>`;
      student.rows.forEach(r => {
        const pct = r.best_ratio != null ? Math.round(r.best_ratio * 100) + '%' : '—';
        const masteryClass = r.mastered ? 'yes' : 'no';
        const masteryLabel = r.mastered ? 'Yes' : 'Not yet';
        const minutes = Math.round(r.total_time_seconds / 60 * 10) / 10;
        html += `<tr>
          <td>${escapeHtml(r.topic_title)}</td>
          <td>${capitalize(r.game_type)}</td>
          <td>${pct}</td>
          <td><span class="mastery-pill ${masteryClass}">${masteryLabel}</span></td>
          <td>${minutes} min</td>
          <td>${r.attempt_count}</td>
        </tr>`;
      });
      html += `</tbody></table>`;
    });

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="no-attempts-note">Could not load metrics.</div>`;
    showToast(err.message, true);
  }
}

// ---- Utilities ----
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ---- Init ----
loadClassList();
