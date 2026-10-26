const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let dashboardData = { subjects: [], tasks: [], today_tasks: [] };
let toastTimer;
const todayISO = new Date().toISOString().slice(0, 10);
$('#today-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
$('#task-date').value = todayISO;

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
  return data;
}
function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function showView(view) {
  $$('.view').forEach(el => el.classList.toggle('active', el.id === `${view}-view`));
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  const titles = { dashboard: 'Dashboard', subjects: 'Subjects', analytics: 'Analytics', kaggle: 'Kaggle Data' };
  $('#page-title').textContent = titles[view] || 'Dashboard';
  if (view === 'kaggle') loadKaggle();
}
$$('.nav-item').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
$$('[data-go="subjects"]').forEach(btn => btn.addEventListener('click', () => showView('subjects')));
$('#add-task-shortcut').addEventListener('click', () => { $('#task-form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#task-form [name="title"]').focus(); });

async function loadDashboard() {
  try {
    dashboardData = await api('/api/dashboard');
    $('#total-hours').textContent = dashboardData.total_study_hours;
    $('#avg-mastery').textContent = dashboardData.average_mastery;
    $('#mastery-bar').style.width = `${dashboardData.average_mastery}%`;
    $('#today-progress').textContent = dashboardData.today_progress;
    $('#today-bar').style.width = `${dashboardData.today_progress}%`;
    $('#subject-count').textContent = dashboardData.subject_count;
    renderTasks(dashboardData.today_tasks || []);
    renderAttention(dashboardData.needs_attention || []);
    renderSubjects(dashboardData.subjects || []);
    renderSubjectOptions(dashboardData.subjects || []);
    renderAnalytics(dashboardData);
  } catch (error) { showToast(error.message); }
}
function renderTasks(tasks) {
  const target = $('#today-task-list');
  if (!tasks.length) { target.innerHTML = '<div class="empty-state">No study tasks yet. Add one below to get started.</div>'; return; }
  target.innerHTML = tasks.map(task => `<div class="task-row">
    <input class="task-check" type="checkbox" aria-label="Mark task complete" data-task-toggle="${task.id}" ${task.completed ? 'checked' : ''}>
    <div class="task-main"><span class="task-title ${task.completed ? 'done' : ''}">${escapeHtml(task.title)}</span><span class="task-meta">${escapeHtml(task.subject_name || 'General')} · ${task.duration_minutes} min · ${escapeHtml(task.task_date)}</span></div>
    <span class="priority ${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span><button class="delete-btn" title="Delete task" data-task-delete="${task.id}">×</button>
  </div>`).join('');
  $$('[data-task-toggle]').forEach(el => el.addEventListener('change', async () => {
    const task = dashboardData.tasks.find(t => t.id === Number(el.dataset.taskToggle));
    if (!task) return;
    try { await api(`/api/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify({ ...task, completed: el.checked }) }); await loadDashboard(); showToast(el.checked ? 'Task completed!' : 'Task marked incomplete.'); }
    catch (e) { showToast(e.message); }
  }));
  $$('[data-task-delete]').forEach(el => el.addEventListener('click', async () => {
    if (!confirm('Delete this study task?')) return;
    try { await api(`/api/tasks/${el.dataset.taskDelete}`, { method: 'DELETE' }); await loadDashboard(); showToast('Task deleted.'); }
    catch (e) { showToast(e.message); }
  }));
}
function renderAttention(subjects) {
  $('#attention-list').innerHTML = subjects.length ? subjects.map(s => `<div class="attention-item"><div class="attention-line"><span>${escapeHtml(s.name)}</span><span>${s.mastery}% mastery</span></div><div class="mastery-track"><div style="width:${s.mastery}%;background:${escapeHtml(s.color)}"></div></div></div>`).join('') : '<div class="empty-state">Add subjects to see study recommendations.</div>';
}
function renderSubjectOptions(subjects) {
  const select = $('#task-subject'); const old = select.value;
  select.innerHTML = '<option value="">General / no subject</option>' + subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (old) select.value = old;
}
function renderSubjects(subjects) {
  $('#subjects-grid').innerHTML = subjects.length ? subjects.map(s => `<article class="subject-card"><div class="subject-card-top"><h3><span class="subject-dot" style="background:${escapeHtml(s.color)}"></span>${escapeHtml(s.name)}</h3><button class="delete-btn" data-subject-delete="${s.id}" title="Delete subject">×</button></div><div class="subject-score">${s.mastery}%</div><p>Mastery · Target ${s.target_hours} hours/week</p><div class="mastery-track"><div style="width:${s.mastery}%;background:${escapeHtml(s.color)}"></div></div><div class="subject-actions"><button class="small-btn" data-subject-edit="${s.id}">Edit mastery</button></div></article>`).join('') : '<div class="empty-state">No subjects yet. Use the form above to add one.</div>';
  $$('[data-subject-delete]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Delete this subject? Related tasks will remain without a subject.')) return;
    try { await api(`/api/subjects/${btn.dataset.subjectDelete}`, { method: 'DELETE' }); await loadDashboard(); showToast('Subject deleted.'); } catch (e) { showToast(e.message); }
  }));
  $$('[data-subject-edit]').forEach(btn => btn.addEventListener('click', async () => {
    const subject = dashboardData.subjects.find(s => s.id === Number(btn.dataset.subjectEdit)); if (!subject) return;
    const input = prompt(`Set mastery for ${subject.name} (0–100):`, subject.mastery); if (input === null) return;
    const mastery = Number(input); if (!Number.isInteger(mastery) || mastery < 0 || mastery > 100) { showToast('Enter a whole number from 0 to 100.'); return; }
    try { await api(`/api/subjects/${subject.id}`, { method: 'PUT', body: JSON.stringify({ ...subject, mastery }) }); await loadDashboard(); showToast('Subject updated.'); } catch (e) { showToast(e.message); }
  }));
}
function renderAnalytics(data) {
  const tasks = data.tasks || [];
  $('#analytics-task-count').textContent = tasks.length;
  $('#analytics-completed-count').textContent = tasks.filter(t => t.completed).length;
  $('#mastery-chart').innerHTML = (data.subjects || []).map(s => `<div class="chart-row"><span>${escapeHtml(s.name)}</span><div class="chart-track"><div style="width:${s.mastery}%;background:${escapeHtml(s.color)}"></div></div><strong>${s.mastery}%</strong></div>`).join('') || '<div class="empty-state">Add subjects to see analytics.</div>';
}
$('#task-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form);
  const data = Object.fromEntries(fd.entries()); data.subject_id = data.subject_id || null; data.duration_minutes = Number(data.duration_minutes);
  if (!data.title.trim() || !data.task_date || !Number.isInteger(data.duration_minutes) || data.duration_minutes < 1 || data.duration_minutes > 1440) { $('#task-form-message').textContent = 'Check the title, date and duration.'; return; }
  try { await api('/api/tasks', { method: 'POST', body: JSON.stringify(data) }); form.reset(); $('#task-date').value = todayISO; $('#task-form-message').textContent = 'Task saved successfully.'; await loadDashboard(); showToast('Study task added.'); }
  catch (e) { $('#task-form-message').textContent = e.message; }
});
$('#subject-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form).entries()); data.target_hours = Number(data.target_hours); data.mastery = Number(data.mastery);
  if (!data.name.trim() || !Number.isFinite(data.target_hours) || data.target_hours <= 0 || !Number.isInteger(data.mastery) || data.mastery < 0 || data.mastery > 100) { $('#subject-form-message').textContent = 'Check name, target hours and mastery (0–100).'; return; }
  try { await api('/api/subjects', { method: 'POST', body: JSON.stringify(data) }); form.reset(); form.elements.color.value = '#7968f5'; $('#subject-form-message').textContent = 'Subject added successfully.'; await loadDashboard(); showToast('Subject added.'); }
  catch (e) { $('#subject-form-message').textContent = e.message; }
});
async function loadKaggle() {
  $('#kaggle-status').textContent = 'Loading dataset information…';
  try {
    const data = await api('/api/kaggle-insights');
    if (!data.available) { $('#kaggle-status').innerHTML = `<strong>Dataset not found.</strong><br>${escapeHtml(data.message)}<br><br>Put the actual CSV file at <code>data/student_performance.csv</code>.`; $('#kaggle-summary').innerHTML = ''; $('#kaggle-table').innerHTML = ''; return; }
    $('#kaggle-status').innerHTML = `<strong>Dataset loaded successfully.</strong> ${data.row_count.toLocaleString()} records and ${data.columns.length} columns found.`;
    const stats = [['Rows', data.row_count.toLocaleString()], ['Columns', data.columns.length], ['Numeric averages', Object.keys(data.averages).length]];
    $('#kaggle-summary').innerHTML = stats.map(([label, value]) => `<article class="kaggle-stat"><span>${label}</span><strong>${escapeHtml(value)}</strong></article>`).join('');
    const columns = data.columns; $('#kaggle-table').innerHTML = `<thead><tr>${columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${data.preview.map(row => `<tr>${columns.map(c => `<td>${escapeHtml(row[c])}</td>`).join('')}</tr>`).join('')}</tbody>`;
    if (Object.keys(data.averages).length) $('#kaggle-summary').insertAdjacentHTML('beforeend', `<article class="kaggle-stat"><span>Sample numeric averages</span><strong style="font-size:12px;line-height:1.7">${Object.entries(data.averages).slice(0,3).map(([k,v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`).join('<br>')}</strong></article>`);
  } catch (error) { $('#kaggle-status').textContent = `Could not load dataset: ${error.message}`; }
}
$('#refresh-kaggle').addEventListener('click', loadKaggle);
loadDashboard();
