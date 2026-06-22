// public/parent/parent.js

// ---- Handle token arriving via URL hash after Google OAuth ----
(function handleOAuthHash() {
  if (!window.location.hash) return;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('token');
  const displayName = params.get('displayName');
  const role = params.get('role');
  if (token && role === 'parent') {
    Auth.setSession(token, { role, displayName: decodeURIComponent(displayName || '') });
    history.replaceState(null, '', window.location.pathname);
  }
})();

// ---- Guard: must be logged in as a parent ----
if (!Auth.isLoggedIn() || Auth.getUser().role !== 'parent') {
  window.location.href = '../index.html';
}

document.getElementById('userName').textContent = Auth.getUser().displayName;
document.getElementById('logoutBtn').addEventListener('click', () => {
  Auth.clearSession();
  window.location.href = '../index.html';
});

const childListView = document.getElementById('childListView');
const childProgressView = document.getElementById('childProgressView');

// ============================================================
// CHILD LIST
// ============================================================
async function loadChildList() {
  try {
    const { children } = await apiCall('/api/parent/children');
    const list = document.getElementById('childList');
    const empty = document.getElementById('childListEmpty');
    list.innerHTML = '';
    empty.classList.toggle('hidden', children.length > 0);

    children.forEach(c => {
      const initial = c.display_name.charAt(0).toUpperCase();
      const card = document.createElement('div');
      card.className = 'child-card';
      card.innerHTML = `
        <div class="child-avatar">${initial}</div>
        <h3>${escapeHtml(c.display_name)}</h3>
        <div class="class-name">${escapeHtml(c.class_name)}</div>
      `;
      card.addEventListener('click', () => openChildProgress(c.id, c.display_name));
      list.appendChild(card);
    });
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---- Link child modal ----
const linkChildModal = document.getElementById('linkChildModal');
const linkUsernameInput = document.getElementById('linkUsernameInput');
const linkChildError = document.getElementById('linkChildError');

function openLinkModal() {
  linkUsernameInput.value = '';
  linkChildError.textContent = '';
  linkChildModal.classList.remove('hidden');
  linkUsernameInput.focus();
}
document.getElementById('linkChildBtn').addEventListener('click', openLinkModal);
document.getElementById('linkChildBtnEmpty').addEventListener('click', openLinkModal);
document.getElementById('cancelLinkChild').addEventListener('click', () => linkChildModal.classList.add('hidden'));

document.getElementById('confirmLinkChild').addEventListener('click', async () => {
  const studentUsername = linkUsernameInput.value.trim();
  if (!studentUsername) { linkChildError.textContent = 'Please enter a username.'; return; }

  try {
    const result = await apiCall('/api/auth/link-child', { method: 'POST', body: { studentUsername } });
    linkChildModal.classList.add('hidden');
    showToast(result.message);
    await loadChildList();
  } catch (err) {
    linkChildError.textContent = err.message;
  }
});

// ============================================================
// CHILD PROGRESS VIEW
// ============================================================
async function openChildProgress(studentId, name) {
  childListView.classList.add('hidden');
  childProgressView.classList.remove('hidden');
  document.getElementById('progressChildName').textContent = `${name}'s progress`;
  document.getElementById('progressContent').innerHTML = '<div class="no-data-note">Loading…</div>';

  try {
    const data = await apiCall(`/api/parent/children/${studentId}/progress`);
    renderProgress(data);
  } catch (err) {
    document.getElementById('progressContent').innerHTML = '<div class="no-data-note">Could not load progress.</div>';
    showToast(err.message, true);
  }
}

document.getElementById('backToChildren').addEventListener('click', () => {
  childProgressView.classList.add('hidden');
  childListView.classList.remove('hidden');
  loadChildList();
});

function renderProgress(data) {
  const container = document.getElementById('progressContent');

  if (data.summary.length === 0) {
    container.innerHTML = '<div class="no-data-note">No games played yet. Check back after your child plays a few!</div>';
    return;
  }

  // ---- Summary stats ----
  const totalTimeSeconds = data.summary.reduce((sum, r) => sum + (r.total_time_seconds || 0), 0);
  const totalMinutes = Math.round(totalTimeSeconds / 60);
  const masteredCount = data.summary.filter(r => r.mastered).length;
  const topicsTouched = new Set(data.summary.map(r => r.topic_id)).size;

  let html = `
    <div class="summary-cards">
      <div class="summary-card"><div class="label">Topics played</div><div class="value">${topicsTouched}</div></div>
      <div class="summary-card"><div class="label">Games mastered</div><div class="value">${masteredCount} / ${data.summary.length}</div></div>
      <div class="summary-card"><div class="label">Total time playing</div><div class="value">${totalMinutes} min</div></div>
    </div>
  `;

  // ---- Per-topic breakdown ----
  const byTopic = {};
  data.summary.forEach(r => {
    if (!byTopic[r.topic_id]) byTopic[r.topic_id] = { title: r.topic_title, rows: [] };
    byTopic[r.topic_id].rows.push(r);
  });

  html += `<div class="section-label">By topic</div>`;
  Object.values(byTopic).forEach(topic => {
    html += `<div class="topic-progress-card"><h4>${escapeHtml(topic.title)}</h4>`;
    topic.rows.forEach(r => {
      const pct = r.best_ratio != null ? Math.round(r.best_ratio * 100) : 0;
      const barClass = pct >= 80 ? '' : 'low';
      html += `
        <div class="game-progress-row">
          <span class="game-label">${capitalize(r.game_type)}</span>
          <div class="progress-bar-track"><div class="progress-bar-fill ${barClass}" style="width:${pct}%"></div></div>
          <span class="pct">${pct}%</span>
          <span class="mastery-check">${r.mastered ? '✅' : ''}</span>
        </div>
      `;
    });
    html += `</div>`;
  });

  // ---- Recent activity ----
  html += `<div class="section-label">Recent activity</div><div class="activity-feed">`;
  data.recent.forEach(a => {
    const date = new Date(a.played_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const scoreText = a.score != null && a.max_score != null ? `${a.score}/${a.max_score}` : (a.mastered ? 'Completed' : 'Attempted');
    html += `
      <div class="activity-row">
        <span class="activity-main">${capitalize(a.game_type)} — ${escapeHtml(a.topic_title)}</span>
        <span class="activity-meta">${scoreText} · ${date}</span>
      </div>
    `;
  });
  html += `</div>`;

  container.innerHTML = html;
}

// ---- Utilities ----
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

// ---- Init ----
loadChildList();
