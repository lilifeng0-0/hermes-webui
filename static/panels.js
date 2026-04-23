let _currentPanel = 'chat';
let _skillsData = null; // cached skills list

async function switchPanel(name) {
  _currentPanel = name;
  // Update nav tabs
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.panel === name));
  // Update panel views
  document.querySelectorAll('.panel-view').forEach(p => p.classList.remove('active'));
  const panelEl = $('panel' + name.charAt(0).toUpperCase() + name.slice(1));
  if (panelEl) panelEl.classList.add('active');
  // Lazy-load panel data
  if (name === 'tasks') await loadCrons();
  if (name === 'canvas') await loadCanvas();
  if (name === 'skills') await loadSkills();
  if (name === 'memory') await loadMemory();
  if (name === 'workspaces') await loadWorkspacesPanel();
  if (name === 'profiles') await loadProfilesPanel();
  if (name === 'todos') loadTodos();
  if (name === 'usage') await loadUsagePanel();
}

// ── Canvas panel ──
let _canvasIframe = null;
async function loadCanvas() {
  const panel = document.getElementById('panelCanvas');
  if (!panel) return;
  // If already loaded, do nothing
  if (_canvasIframe) return;
  // Create iframe to load canvas
  const iframe = document.createElement('iframe');
  iframe.id = 'canvasIframe';
  iframe.src = '/static/canvas.html?v=15';
  iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
  panel.innerHTML = '';
  panel.appendChild(iframe);
  _canvasIframe = iframe;
  // Listen for messages from canvas iframe
  window.addEventListener('message', handleCanvasMessage);
}

function handleCanvasMessage(event) {
  // Handle canvas -> parent communication
  const data = event.data;
  if (!data || !data.type) return;
  if (data.type === 'canvas-send-to-chat') {
    // Inject text into chat input and trigger send
    const msgEl = document.getElementById('msg');
    if (msgEl && data.text) {
      msgEl.value = data.text;
      msgEl.focus();
    }
    // Handle file attachments if any
    if (data.files && data.files.length > 0 && typeof S !== 'undefined' && S.pendingFiles) {
      // Files are referenced by path; add them to pending files for the next send
      data.files.forEach(f => { if (f) S.pendingFiles.push(f); });
      renderTray();
    }
    // Trigger send after a tick (allow UI to update first)
    setTimeout(() => { if (typeof send === 'function') send(); }, 10);
  } else if (data.type === 'canvas-action') {
    // Canvas sends action result back to chat as a message
    if (typeof send === 'function' && data.text) {
      const msgEl = document.getElementById('msg');
      if (msgEl) msgEl.value = data.text;
      setTimeout(() => send(), 10);
    }
  }
}

// ── Cron panel ──
async function loadCrons() {
  const box = $('cronList');
  try {
    const data = await api('/api/crons');
    if (!data.jobs || !data.jobs.length) {
      box.innerHTML = `<div style="padding:16px;color:var(--muted);font-size:12px">${esc(t('cron_no_jobs'))}</div>`;
      return;
    }
    box.innerHTML = '';
    for (const job of data.jobs) {
      const item = document.createElement('div');
      item.className = 'cron-item';
      item.id = 'cron-' + job.id;
      const statusClass = job.enabled === false ? 'disabled' : job.state === 'paused' ? 'paused' : job.last_status === 'error' ? 'error' : 'active';
      const statusLabel = job.enabled === false ? t('cron_status_off') : job.state === 'paused' ? t('cron_status_paused') : job.last_status === 'error' ? t('cron_status_error') : t('cron_status_active');
      const nextRun = job.next_run_at ? new Date(job.next_run_at).toLocaleString() : t('not_available');
      const lastRun = job.last_run_at ? new Date(job.last_run_at).toLocaleString() : t('never');
      item.innerHTML = `
        <div class="cron-header" onclick="toggleCron('${job.id}')">
          <span class="cron-name" title="${esc(job.name)}">${esc(job.name)}</span>
          <span class="cron-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="cron-body" id="cron-body-${job.id}">
          <div class="cron-schedule">${li('clock',12)} ${esc(job.schedule_display || job.schedule?.expression || '')} &nbsp;|&nbsp; ${esc(t('cron_next'))}: ${esc(nextRun)} &nbsp;|&nbsp; ${esc(t('cron_last'))}: ${esc(lastRun)}</div>
          <div class="cron-prompt">${esc((job.prompt||'').slice(0,300))}${(job.prompt||'').length>300?'…':''}</div>
          <div class="cron-actions">
            <button class="cron-btn run" onclick="cronRun('${job.id}')">${li('play',12)} ${esc(t('cron_run_now'))}</button>
            ${job.state==='paused'
              ? `<button class="cron-btn" onclick="cronResume('${job.id}')">${li('play',12)} ${esc(t('cron_resume'))}</button>`
              : `<button class="cron-btn pause" onclick="cronPause('${job.id}')">${li('pause',12)} ${esc(t('cron_pause'))}</button>`}
            <button class="cron-btn" onclick="cronEditOpen('${job.id}',${JSON.stringify(job).replace(/"/g,'&quot;')})">${li('pencil',12)} ${esc(t('edit'))}</button>
            <button class="cron-btn" style="border-color:var(--accent-bg-strong);color:var(--accent-text)" onclick="cronDelete('${job.id}')">${li('trash-2',12)} ${esc(t('delete_title'))}</button>
          </div>
          <!-- Inline edit form, hidden by default -->
          <div id="cron-edit-${job.id}" style="display:none;margin-top:8px;border-top:1px solid var(--border);padding-top:8px">
            <input id="cron-edit-name-${job.id}" placeholder="${esc(t('cron_job_name_placeholder'))}" style="width:100%;background:rgba(255,255,255,.05);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:5px 8px;font-size:12px;outline:none;margin-bottom:5px;box-sizing:border-box">
            <input id="cron-edit-schedule-${job.id}" placeholder="${esc(t('cron_schedule_placeholder'))}" style="width:100%;background:rgba(255,255,255,.05);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:5px 8px;font-size:12px;outline:none;margin-bottom:5px;box-sizing:border-box">
            <textarea id="cron-edit-prompt-${job.id}" rows="3" placeholder="${esc(t('cron_prompt_placeholder'))}" style="width:100%;background:rgba(255,255,255,.05);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:5px 8px;font-size:12px;outline:none;resize:none;font-family:inherit;margin-bottom:5px;box-sizing:border-box"></textarea>
            <div id="cron-edit-err-${job.id}" style="font-size:11px;color:var(--accent);display:none;margin-bottom:5px"></div>
            <div style="display:flex;gap:6px">
              <button class="cron-btn run" style="flex:1" onclick="cronEditSave('${job.id}')">${esc(t('save'))}</button>
              <button class="cron-btn" style="flex:1" onclick="cronEditClose('${job.id}')">${esc(t('cancel'))}</button>
            </div>
          </div>
          <div id="cron-output-${job.id}">
            <div class="cron-last-header" style="display:flex;align-items:center;justify-content:space-between">
              <span>${esc(t('cron_last_output'))}</span>
              <button class="cron-btn" style="padding:1px 8px;font-size:10px" onclick="loadCronHistory('${job.id}',this)">${esc(t('cron_all_runs'))}</button>
            </div>
            <div class="cron-last" id="cron-out-text-${job.id}" style="color:var(--muted);font-size:11px">${esc(t('loading'))}</div>
            <div id="cron-history-${job.id}" style="display:none"></div>
          </div>
        </div>`;
      box.appendChild(item);
      // Eagerly load last output for visible items
      loadCronOutput(job.id);
    }
  } catch(e) { box.innerHTML = `<div style="padding:12px;color:var(--accent);font-size:12px">${esc(t('error_prefix'))}${esc(e.message)}</div>`; }
}

let _cronSelectedSkills=[];
let _cronSkillsCache=null;

function toggleCronForm(){
  const form=$('cronCreateForm');
  if(!form)return;
  const open=form.style.display!=='none';
  form.style.display=open?'none':'';
  if(!open){
    $('cronFormName').value='';
    $('cronFormSchedule').value='';
    $('cronFormPrompt').value='';
    $('cronFormDeliver').value='local';
    $('cronFormError').style.display='none';
    _cronSelectedSkills=[];
    _renderCronSkillTags();
    const search=$('cronFormSkillSearch');
    if(search)search.value='';
    // Always re-fetch skills to avoid stale cache
    _cronSkillsCache=null;
    api('/api/skills').then(d=>{_cronSkillsCache=d.skills||[];}).catch(()=>{});
    $('cronFormName').focus();
  }
}

function _renderCronSkillTags(){
  const wrap=$('cronFormSkillTags');
  if(!wrap)return;
  wrap.innerHTML='';
  for(const name of _cronSelectedSkills){
    const tag=document.createElement('span');
    tag.className='skill-tag';
    tag.dataset.skill=name;
    const rm=document.createElement('span');
    rm.className='remove-tag';rm.textContent='×';
    rm.onclick=()=>{_cronSelectedSkills=_cronSelectedSkills.filter(s=>s!==name);tag.remove();};
    tag.appendChild(document.createTextNode(name));
    tag.appendChild(rm);
    wrap.appendChild(tag);
  }
}

// Skill search input handler
(function(){
  const setup=()=>{
    const search=$('cronFormSkillSearch');
    const dropdown=$('cronFormSkillDropdown');
    if(!search||!dropdown)return;
    search.oninput=()=>{
      const q=search.value.trim().toLowerCase();
      if(!q||!_cronSkillsCache){dropdown.style.display='none';return;}
      const matches=_cronSkillsCache.filter(s=>
        !_cronSelectedSkills.includes(s.name)&&
        (s.name.toLowerCase().includes(q)||(s.category||'').toLowerCase().includes(q))
      ).slice(0,8);
      if(!matches.length){dropdown.style.display='none';return;}
      dropdown.innerHTML='';
      for(const s of matches){
        const opt=document.createElement('div');
        opt.className='skill-opt';
        opt.textContent=s.name+(s.category?' ('+s.category+')':'');
        opt.onclick=()=>{
          _cronSelectedSkills.push(s.name);
          _renderCronSkillTags();
          search.value='';
          dropdown.style.display='none';
        };
        dropdown.appendChild(opt);
      }
      dropdown.style.display='';
    };
    search.onblur=()=>setTimeout(()=>{dropdown.style.display='none';},150);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);
  else setTimeout(setup,0);
})();

async function submitCronCreate(){
  const name=$('cronFormName').value.trim();
  const schedule=$('cronFormSchedule').value.trim();
  const prompt=$('cronFormPrompt').value.trim();
  const deliver=$('cronFormDeliver').value;
  const errEl=$('cronFormError');
  errEl.style.display='none';
  if(!schedule){errEl.textContent=t('cron_schedule_required_example');errEl.style.display='';return;}
  if(!prompt){errEl.textContent=t('cron_prompt_required');errEl.style.display='';return;}
  try{
    const body={schedule,prompt,deliver};
    if(name)body.name=name;
    if(_cronSelectedSkills.length)body.skills=_cronSelectedSkills;
    await api('/api/crons/create',{method:'POST',body:JSON.stringify(body)});
    toggleCronForm();
    showToast(t('cron_job_created'));
    await loadCrons();
  }catch(e){
    errEl.textContent=t('error_prefix')+e.message;errEl.style.display='';
  }
}

function _cronOutputSnippet(content) {
  // Extract the response body from a cron output .md file
  const lines = content.split('\n');
  const responseIdx = lines.findIndex(l => l.startsWith('## Response') || l.startsWith('# Response'));
  const body = (responseIdx >= 0 ? lines.slice(responseIdx + 1) : lines).join('\n').trim();
  return body.slice(0, 600) || '(empty)';
}

async function loadCronOutput(jobId) {
  try {
    const data = await api(`/api/crons/output?job_id=${encodeURIComponent(jobId)}&limit=1`);
    const el = $('cron-out-text-' + jobId);
    if (!el) return;
    if (!data.outputs || !data.outputs.length) { el.textContent = t('cron_no_runs_yet'); return; }
    const out = data.outputs[0];
    const ts = out.filename.replace('.md','').replace(/_/g,' ');
    el.textContent = ts + '\n\n' + _cronOutputSnippet(out.content);
  } catch(e) { /* ignore */ }
}

async function loadCronHistory(jobId, btn) {
  const histEl = $('cron-history-' + jobId);
  if (!histEl) return;
  // Toggle: if already open, close it
  if (histEl.style.display !== 'none') {
    histEl.style.display = 'none';
    if (btn) btn.textContent = t('cron_all_runs');
    return;
  }
  if (btn) btn.textContent = t('loading');
  try {
    const data = await api(`/api/crons/output?job_id=${encodeURIComponent(jobId)}&limit=20`);
    if (!data.outputs || !data.outputs.length) {
      histEl.innerHTML = `<div style="font-size:11px;color:var(--muted);padding:4px 0">${esc(t('cron_no_runs_yet'))}</div>`;
    } else {
      histEl.innerHTML = data.outputs.map((out, i) => {
        const ts = out.filename.replace('.md','').replace(/_/g,' ');
        const snippet = _cronOutputSnippet(out.content);
        const id = `cron-hist-run-${jobId}-${i}`;
        return `<div style="border-top:1px solid var(--border);padding:6px 0">
          <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="document.getElementById('${id}').style.display=document.getElementById('${id}').style.display==='none'?'':'none'">
            <span style="font-size:11px;font-weight:600;color:var(--muted)">${esc(ts)}</span>
            <span style="font-size:10px;color:var(--muted);opacity:.6">▸</span>
          </div>
          <div id="${id}" style="display:none;font-size:11px;color:var(--muted);white-space:pre-wrap;line-height:1.5;margin-top:4px;max-height:200px;overflow-y:auto">${esc(snippet)}</div>
        </div>`;
      }).join('');
    }
    histEl.style.display = '';
    if (btn) btn.textContent = t('cron_hide_runs');
  } catch(e) {
    if (btn) btn.textContent = t('cron_all_runs');
  }
}

function toggleCron(id) {
  const body = $('cron-body-' + id);
  if (body) body.classList.toggle('open');
}

async function cronRun(id) {
  try {
    await api('/api/crons/run', {method:'POST', body: JSON.stringify({job_id: id})});
    showToast(t('cron_job_triggered'));
    setTimeout(() => loadCronOutput(id), 5000);
  } catch(e) { showToast(t('failed_colon') + e.message, 4000); }
}

async function cronPause(id) {
  try {
    await api('/api/crons/pause', {method:'POST', body: JSON.stringify({job_id: id})});
    showToast(t('cron_job_paused'));
    await loadCrons();
  } catch(e) { showToast(t('failed_colon') + e.message, 4000); }
}

async function cronResume(id) {
  try {
    await api('/api/crons/resume', {method:'POST', body: JSON.stringify({job_id: id})});
    showToast(t('cron_job_resumed'));
    await loadCrons();
  } catch(e) { showToast(t('failed_colon') + e.message, 4000); }
}

function cronEditOpen(id, job) {
  const form = $('cron-edit-' + id);
  if (!form) return;
  $('cron-edit-name-' + id).value = job.name || '';
  $('cron-edit-schedule-' + id).value = job.schedule_display || (job.schedule && job.schedule.expression) || job.schedule || '';
  $('cron-edit-prompt-' + id).value = job.prompt || '';
  const errEl = $('cron-edit-err-' + id);
  if (errEl) errEl.style.display = 'none';
  form.style.display = '';
}

function cronEditClose(id) {
  const form = $('cron-edit-' + id);
  if (form) form.style.display = 'none';
}

async function cronEditSave(id) {
  const name = $('cron-edit-name-' + id).value.trim();
  const schedule = $('cron-edit-schedule-' + id).value.trim();
  const prompt = $('cron-edit-prompt-' + id).value.trim();
  const errEl = $('cron-edit-err-' + id);
  if (!schedule) { errEl.textContent = t('cron_schedule_required'); errEl.style.display = ''; return; }
  if (!prompt) { errEl.textContent = t('cron_prompt_required'); errEl.style.display = ''; return; }
  try {
    const updates = {job_id: id, schedule, prompt};
    if (name) updates.name = name;
    await api('/api/crons/update', {method:'POST', body: JSON.stringify(updates)});
    showToast(t('cron_job_updated'));
    await loadCrons();
  } catch(e) { errEl.textContent = t('error_prefix') + e.message; errEl.style.display = ''; }
}

async function cronDelete(id) {
  const _delCron=await showConfirmDialog({title:t('cron_delete_confirm_title'),message:t('cron_delete_confirm_message'),confirmLabel:t('delete_title'),danger:true,focusCancel:true});
  if(!_delCron) return;
  try {
    await api('/api/crons/delete', {method:'POST', body: JSON.stringify({job_id: id})});
    showToast(t('cron_job_deleted'));
    await loadCrons();
  } catch(e) { showToast(t('delete_failed') + e.message, 4000); }
}

function loadTodos() {
  const panel = $('todoPanel');
  if (!panel) return;
  const sourceMessages = (S.session && Array.isArray(S.session.messages) && S.session.messages.length) ? S.session.messages : S.messages;
  // Parse the most recent todo state from message history
  let todos = [];
  for (let i = sourceMessages.length - 1; i >= 0; i--) {
    const m = sourceMessages[i];
    if (m && m.role === 'tool') {
      try {
        const d = JSON.parse(typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
        if (d && Array.isArray(d.todos) && d.todos.length) {
          todos = d.todos;
          break;
        }
      } catch(e) {}
    }
  }
  if (!todos.length) {
    panel.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:4px 0">${esc(t('todos_no_active'))}</div>`;
    return;
  }
  const statusIcon = {pending:li('square',14), in_progress:li('loader',14), completed:li('check',14), cancelled:li('x',14)};
  const statusColor = {pending:'var(--muted)', in_progress:'var(--blue)', completed:'rgba(100,200,100,.8)', cancelled:'rgba(200,100,100,.5)'};
  panel.innerHTML = todos.map(t => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:14px;display:inline-flex;align-items:center;flex-shrink:0;margin-top:1px;color:${statusColor[t.status]||'var(--muted)'}">${statusIcon[t.status]||li('square',14)}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:${t.status==='completed'?'var(--muted)':t.status==='in_progress'?'var(--text)':'var(--text)'};${t.status==='completed'?'text-decoration:line-through;opacity:.5':''};line-height:1.4">${esc(t.content)}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;opacity:.6">${esc(t.id)} · ${esc(t.status)}</div>
      </div>
    </div>`).join('');
}

async function clearConversation() {
  if(!S.session) return;
  const _clrMsg=await showConfirmDialog({title:t('clear_conversation_title'),message:t('clear_conversation_message'),confirmLabel:t('clear'),danger:true,focusCancel:true});
  if(!_clrMsg) return;
  try {
    const data = await api('/api/session/clear', {method:'POST',
      body: JSON.stringify({session_id: S.session.session_id})});
    S.session = data.session;
    S.messages = [];
    S.toolCalls = [];
    syncTopbar();
    renderMessages();
    showToast(t('conversation_cleared'));
  } catch(e) { setStatus(t('clear_failed') + e.message); }
}

// ── Skills panel ──
async function loadSkills() {
  if (_skillsData) { renderSkills(_skillsData); return; }
  const box = $('skillsList');
  try {
    const data = await api('/api/skills');
    _skillsData = data.skills || [];
    renderSkills(_skillsData);
  } catch(e) { box.innerHTML = `<div style="padding:12px;color:var(--accent);font-size:12px">Error: ${esc(e.message)}</div>`; }
}

function renderSkills(skills) {
  const query = ($('skillsSearch').value || '').toLowerCase();
  const filtered = query ? skills.filter(s =>
    (s.name||'').toLowerCase().includes(query) ||
    (s.description||'').toLowerCase().includes(query) ||
    (s.category||'').toLowerCase().includes(query)
  ) : skills;
  // Group by category
  const cats = {};
  for (const s of filtered) {
    const cat = s.category || '(general)';
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(s);
  }
  const box = $('skillsList');
  box.innerHTML = '';
  if (!filtered.length) { box.innerHTML = `<div style="padding:12px;color:var(--muted);font-size:12px">${esc(t('skills_no_match'))}</div>`; return; }
  for (const [cat, items] of Object.entries(cats).sort()) {
    const sec = document.createElement('div');
    sec.className = 'skills-category';
    sec.innerHTML = `<div class="skills-cat-header">${li('folder',12)} ${esc(cat)} <span style="opacity:.5">(${items.length})</span></div>`;
    for (const skill of items.sort((a,b) => a.name.localeCompare(b.name))) {
      const el = document.createElement('div');
      el.className = 'skill-item';
      el.innerHTML = `
        <div style="margin-right: 12px;">
          <label class="switch">
            <input type="checkbox" class="skill-toggle" data-skill="${esc(skill.name)}">
            <span class="slider"></span>
          </label>
        </div>
        <div style="flex: 1;">
          <span class="skill-name">${esc(skill.name)}</span>
          <span class="skill-desc">${esc(skill.description||'')}</span>
        </div>
      `;
      el.onclick = (e) => {
        if (!e.target.closest('.switch')) {
          openSkill(skill.name, el);
        }
      };
      sec.appendChild(el);
    }
    loadSkillStatus();
    box.appendChild(sec);
  }
}

function filterSkills() {
  if (_skillsData) renderSkills(_skillsData);
}

// Load and apply skill toggle status
async function loadSkillStatus() {
  try {
    const response = await api('/api/skills/status');
    const disabledSkills = response.disabled || [];
    document.querySelectorAll('.skill-toggle').forEach(toggle => {
      const skillName = toggle.dataset.skill;
      toggle.checked = !disabledSkills.includes(skillName);
      toggle.onchange = () => toggleSkill(skillName, toggle.checked);
    });
  } catch (e) {
    console.error('Failed to load skill status:', e);
  }
}

// Toggle skill enabled/disabled
async function toggleSkill(skillName, enabled) {
  try {
    const response = await api('/api/skills/toggle', {
      method: 'POST',
      body: JSON.stringify({ name: skillName, enabled })
    });
    showToast(enabled ? t('skill_enabled') : t('skill_disabled'));
    setTimeout(loadSkillStatus, 100);
  } catch (e) {
    console.error('Failed to toggle skill:', e);
    showToast(t('error_prefix') + e.message);
    setTimeout(loadSkillStatus, 100);
  }
}

// ── Skill Upload ──
let _skillUploadDragCounter = 0;

function toggleSkillUpload() {
  const form = $('skillUploadForm');
  const isVisible = form.style.display !== 'none';
  form.style.display = isVisible ? 'none' : 'block';
  // Hide error message
  $('skillUploadError').style.display = 'none';
  if (!isVisible) {
    // Reset file input
    $('skillFileInput').value = '';
    // Remove drag-over class
    const dropZone = $('skillUploadDropZone');
    dropZone.classList.remove('drag-over');
  }
}

function initSkillUploadDropZone() {
  const dropZone = $('skillUploadDropZone');
  if (!dropZone) return;

  // Click to open file dialog
  dropZone.addEventListener('click', (e) => {
    if (e.target.tagName !== 'INPUT') {
      $('skillFileInput').click();
    }
  });

  // Drag events
  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    _skillUploadDragCounter++;
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    _skillUploadDragCounter--;
    if (_skillUploadDragCounter === 0) {
      dropZone.classList.remove('drag-over');
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    _skillUploadDragCounter = 0;
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleSkillFileUpload(files[0]);
    }
  });
}

function handleSkillFileSelect(input) {
  if (input.files && input.files.length > 0) {
    handleSkillFileUpload(input.files[0]);
  }
}

async function handleSkillFileUpload(file) {
  const errorEl = $('skillUploadError');
  const validExtensions = ['.zip', '.skill'];
  const fileName = file.name.toLowerCase();
  const hasValidExt = validExtensions.some(ext => fileName.endsWith(ext));

  if (!hasValidExt) {
    errorEl.textContent = t('upload_skill_invalid_format') || '只支持 .zip 或 .skill 格式';
    errorEl.style.display = 'block';
    return;
  }

  try {
    const formData = new FormData();
    formData.append('file', file);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min timeout

    const response = await fetch('/api/skills/upload', {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Upload failed');
    }

    showToast(t('upload_skill_success') || 'Skill 上传成功');
    toggleSkillUpload();

    // Reload skills list
    _skillsData = null;
    loadSkills();
  } catch (e) {
    console.error('Skill upload error:', e);
    if (e.name === 'AbortError') {
      errorEl.textContent = t('upload_skill_timeout') || '上传超时，请重试';
    } else {
      errorEl.textContent = t('error_prefix') + e.message;
    }
    errorEl.style.display = 'block';
  }
}

// Initialize upload drop zone on load
document.addEventListener('DOMContentLoaded', initSkillUploadDropZone);

async function openSkill(name, el) {
  // Highlight active skill
  document.querySelectorAll('.skill-item').forEach(e => e.classList.remove('active'));
  if (el) el.classList.add('active');
  // Ensure the workspace panel is open so the skill content is actually visible (#643)
  if (typeof ensureWorkspacePreviewVisible === 'function') ensureWorkspacePreviewVisible();
  try {
    const data = await api(`/api/skills/content?name=${encodeURIComponent(name)}`);
    // Show skill content in right panel preview
    $('previewPathText').textContent = name + '.md';
    $('previewBadge').textContent = 'skill';
    $('previewBadge').className = 'preview-badge md';
    showPreview('md');
    let html = renderMd(data.content || '(no content)');
    // Render linked files section if present
    const lf = data.linked_files || {};
    const categories = Object.entries(lf).filter(([,files]) => files && files.length > 0);
    if (categories.length) {
      html += `<div class="skill-linked-files"><div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">${esc(t('linked_files'))}</div>`;
      for (const [cat, files] of categories) {
        html += `<div class="skill-linked-section"><h4>${esc(cat)}</h4>`;
        for (const f of files) {
          html += `<a class="skill-linked-file" href="#" data-skill-name="${esc(name)}" data-skill-file="${esc(f)}">${esc(f)}</a>`;
        }
        html += '</div>';
      }
      html += '</div>';
    }
    $('previewMd').innerHTML = html;
    // Wire linked-file clicks via data attributes (avoids inline JS XSS with apostrophes)
    $('previewMd').querySelectorAll('.skill-linked-file').forEach(a=>{
      a.addEventListener('click',e=>{e.preventDefault();openSkillFile(a.dataset.skillName,a.dataset.skillFile);});
    });
    $('previewArea').classList.add('visible');
    $('fileTree').style.display = 'none';
  } catch(e) { setStatus(t('skill_load_failed') + e.message); }
}

async function openSkillFile(skillName, filePath) {
  try {
    const data = await api(`/api/skills/content?name=${encodeURIComponent(skillName)}&file=${encodeURIComponent(filePath)}`);
    $('previewPathText').textContent = skillName + ' / ' + filePath;
    $('previewBadge').textContent = filePath.split('.').pop() || 'file';
    $('previewBadge').className = 'preview-badge code';
    const ext = filePath.split('.').pop() || '';
    if (['md','markdown'].includes(ext)) {
      showPreview('md');
      $('previewMd').innerHTML = renderMd(data.content || '');
    } else {
      showPreview('code');
      $('previewCode').textContent = data.content || '';
      requestAnimationFrame(() => highlightCode());
    }
  } catch(e) { setStatus(t('skill_file_load_failed') + e.message); }
}

// ── Skill create/edit form ──
let _editingSkillName = null;

function toggleSkillForm(prefillName, prefillCategory, prefillContent) {
  const form = $('skillCreateForm');
  if (!form) return;
  const open = form.style.display !== 'none';
  if (open) { form.style.display = 'none'; _editingSkillName = null; return; }
  $('skillFormName').value = prefillName || '';
  $('skillFormCategory').value = prefillCategory || '';
  $('skillFormContent').value = prefillContent || '';
  $('skillFormError').style.display = 'none';
  _editingSkillName = prefillName || null;
  form.style.display = '';
  $('skillFormName').focus();
}

async function submitSkillSave() {
  const name = ($('skillFormName').value||'').trim().toLowerCase().replace(/\s+/g, '-');
  const category = ($('skillFormCategory').value||'').trim();
  const content = $('skillFormContent').value;
  const errEl = $('skillFormError');
  errEl.style.display = 'none';
  if (!name) { errEl.textContent = t('skill_name_required'); errEl.style.display = ''; return; }
  if (!content.trim()) { errEl.textContent = t('content_required'); errEl.style.display = ''; return; }
  try {
    await api('/api/skills/save', {method:'POST', body: JSON.stringify({name, category: category||undefined, content})});
    showToast(_editingSkillName ? t('skill_updated') : t('skill_created'));
    _skillsData = null;
    _cronSkillsCache = null;
    toggleSkillForm();
    await loadSkills();
  } catch(e) { errEl.textContent = t('error_prefix') + e.message; errEl.style.display = ''; }
}

// ── Memory inline edit ──
let _memoryData = null;

function toggleMemoryEdit() {
  const form = $('memoryEditForm');
  if (!form) return;
  const open = form.style.display !== 'none';
  if (open) { form.style.display = 'none'; return; }
  $('memEditSection').textContent = t('memory_notes_label');
  $('memEditContent').value = _memoryData ? (_memoryData.memory || '') : '';
  $('memEditError').style.display = 'none';
  form.style.display = '';
}

function closeMemoryEdit() {
  const form = $('memoryEditForm');
  if (form) form.style.display = 'none';
}

async function submitMemorySave() {
  const content = $('memEditContent').value;
  const errEl = $('memEditError');
  errEl.style.display = 'none';
  try {
    await api('/api/memory/write', {method:'POST', body: JSON.stringify({section: 'memory', content})});
    showToast(t('memory_saved'));
    closeMemoryEdit();
    await loadMemory(true);
  } catch(e) { errEl.textContent = t('error_prefix') + e.message; errEl.style.display = ''; }
}

// ── Workspace management ──
let _workspaceList = [];  // cached from /api/workspaces

function getWorkspaceFriendlyName(path){
  // Look up the friendly name from the workspace list cache, fallback to last path segment
  if(_workspaceList && _workspaceList.length){
    const match=_workspaceList.find(w=>w.path===path);
    if(match && match.name) return match.name;
  }
  return path.split('/').filter(Boolean).pop()||path;
}

function syncWorkspaceDisplays(){
  const hasSession=!!(S.session&&S.session.workspace);
  const ws=hasSession?S.session.workspace:'';
  const label=hasSession?getWorkspaceFriendlyName(ws):t('no_workspace');

  const sidebarName=$('sidebarWsName');
  const sidebarPath=$('sidebarWsPath');
  if(sidebarName) sidebarName.textContent=label;
  if(sidebarPath) sidebarPath.textContent=ws;

  const composerChip=$('composerWorkspaceChip');
  const composerLabel=$('composerWorkspaceLabel');
  const composerDropdown=$('composerWsDropdown');
  if(!hasSession && composerDropdown) composerDropdown.classList.remove('open');
  // Only show workspace label once boot has finished to prevent
  // flash of "No workspace" before the saved session finishes loading.
  if(composerLabel) composerLabel.textContent=S._bootReady?label:'';
  if(composerChip){
    composerChip.disabled=!hasSession;
    composerChip.title=hasSession?ws:t('no_workspace');
    composerChip.classList.toggle('active',!!(composerDropdown&&composerDropdown.classList.contains('open')));
  }
}

async function loadWorkspaceList(){
  try{
    const data = await api('/api/workspaces');
    _workspaceList = data.workspaces || [];
    syncWorkspaceDisplays();
    return data;
  }catch(e){ return {workspaces:[], last:''}; }
}

function _renderWorkspaceAction(label, meta, iconSvg, onClick){
  const opt=document.createElement('div');
  opt.className='ws-opt ws-opt-action';
  opt.innerHTML=`<span class="ws-opt-icon">${iconSvg}</span><span><span class="ws-opt-name">${esc(label)}</span>${meta?`<span class="ws-opt-meta">${esc(meta)}</span>`:''}</span>`;
  opt.onclick=onClick;
  return opt;
}

function _positionComposerWsDropdown(){
  const dd=$('composerWsDropdown');
  const chip=$('composerWorkspaceChip');
  const footer=document.querySelector('.composer-footer');
  if(!dd||!chip||!footer)return;
  const chipRect=chip.getBoundingClientRect();
  const footerRect=footer.getBoundingClientRect();
  let left=chipRect.left-footerRect.left;
  const maxLeft=Math.max(0, footer.clientWidth-dd.offsetWidth);
  left=Math.max(0, Math.min(left, maxLeft));
  dd.style.left=`${left}px`;
}

function _positionProfileDropdown(){
  const dd=$('profileDropdown');
  const chip=$('profileChip');
  const footer=document.querySelector('.composer-footer');
  if(!dd||!chip||!footer)return;
  const chipRect=chip.getBoundingClientRect();
  const footerRect=footer.getBoundingClientRect();
  let left=chipRect.left-footerRect.left;
  const maxLeft=Math.max(0, footer.clientWidth-dd.offsetWidth);
  left=Math.max(0, Math.min(left, maxLeft));
  dd.style.left=`${left}px`;
}

function renderWorkspaceDropdownInto(dd, workspaces, currentWs){
  if(!dd)return;
  dd.innerHTML='';
  for(const w of workspaces){
    const opt=document.createElement('div');
    opt.className='ws-opt'+(w.path===currentWs?' active':'');
    opt.innerHTML=`<span class="ws-opt-name">${esc(w.name)}</span><span class="ws-opt-path">${esc(w.path)}</span>`;
    opt.onclick=()=>switchToWorkspace(w.path,w.name);
    dd.appendChild(opt);
  }
  dd.appendChild(document.createElement('div')).className='ws-divider';
  dd.appendChild(_renderWorkspaceAction(
    t('workspace_choose_path'),
    t('workspace_choose_path_meta'),
    li('folder',12),
    ()=>promptWorkspacePath()
  ));
  const div=document.createElement('div');div.className='ws-divider';dd.appendChild(div);
  dd.appendChild(_renderWorkspaceAction(
    t('workspace_manage'),
    t('workspace_manage_meta'),
    li('settings',12),
    ()=>{closeWsDropdown();mobileSwitchPanel('workspaces');}
  ));
}

function toggleWsDropdown(){
  const dd=$('wsDropdown');
  if(!dd)return;
  const open=dd.classList.contains('open');
  if(open){closeWsDropdown();}
  else{
    closeProfileDropdown(); // close profile dropdown if open
    loadWorkspaceList().then(data=>{
      renderWorkspaceDropdownInto(dd, data.workspaces, S.session?S.session.workspace:'');
      dd.classList.add('open');
    });
  }
}

function toggleComposerWsDropdown(){
  const dd=$('composerWsDropdown');
  const chip=$('composerWorkspaceChip');
  if(!dd||!chip||chip.disabled)return;
  const open=dd.classList.contains('open');
  if(open){closeWsDropdown();}
  else{
    closeProfileDropdown();
    if(typeof closeModelDropdown==='function') closeModelDropdown();
    loadWorkspaceList().then(data=>{
      renderWorkspaceDropdownInto(dd, data.workspaces, S.session?S.session.workspace:'');
      dd.classList.add('open');
      _positionComposerWsDropdown();
      chip.classList.add('active');
    });
  }
}

function closeWsDropdown(){
  const dd=$('wsDropdown');
  const composerDd=$('composerWsDropdown');
  const composerChip=$('composerWorkspaceChip');
  if(dd)dd.classList.remove('open');
  if(composerDd)composerDd.classList.remove('open');
  if(composerChip)composerChip.classList.remove('active');
}
document.addEventListener('click',e=>{
  if(
    !e.target.closest('#composerWorkspaceChip') &&
    !e.target.closest('#composerWsDropdown')
  ) closeWsDropdown();
});
window.addEventListener('resize',()=>{
  const dd=$('composerWsDropdown');
  if(dd&&dd.classList.contains('open')) _positionComposerWsDropdown();
});

async function loadWorkspacesPanel(){
  const panel=$('workspacesPanel');
  if(!panel)return;
  const data=await loadWorkspaceList();
  renderWorkspacesPanel(data.workspaces);
}

function renderWorkspacesPanel(workspaces){
  const panel=$('workspacesPanel');
  panel.innerHTML='';
  for(const w of workspaces){
    const row=document.createElement('div');row.className='ws-row';
    row.innerHTML=`
      <div class="ws-row-info">
        <div class="ws-row-name">${esc(w.name)}</div>
        <div class="ws-row-path">${esc(w.path)}</div>
      </div>
      <div class="ws-row-actions">
        <button class="ws-action-btn" title="${esc(t('workspace_use_title'))}" onclick="switchToWorkspace('${esc(w.path)}','${esc(w.name)}')">${li('arrow-right',12)} ${esc(t('workspace_use'))}</button>
        <button class="ws-action-btn danger" title="${esc(t('remove'))}" onclick="removeWorkspace('${esc(w.path)}')">${li('x',12)}</button>
      </div>`;
    panel.appendChild(row);
  }
  const addRow=document.createElement('div');addRow.className='ws-add-row';
  addRow.innerHTML=`
    <input id="wsAddInput" placeholder="${esc(t('workspace_add_path_placeholder'))}" style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--border2);border-radius:7px;color:var(--text);padding:7px 10px;font-size:12px;outline:none;">
    <button class="ws-action-btn" onclick="addWorkspace()">${li('plus',12)} ${esc(t('add'))}</button>`;
  panel.appendChild(addRow);
  const hint=document.createElement('div');
  hint.style.cssText='font-size:11px;color:var(--muted);padding:4px 0 8px';
  hint.textContent=t('workspace_paths_validated_hint');
  panel.appendChild(hint);
}

async function addWorkspace(){
  const input=$('wsAddInput');
  const path=(input?input.value:'').trim();
  if(!path)return;
  try{
    const data=await api('/api/workspaces/add',{method:'POST',body:JSON.stringify({path})});
    _workspaceList=data.workspaces;
    renderWorkspacesPanel(data.workspaces);
    if(input)input.value='';
    showToast(t('workspace_added'));
  }catch(e){setStatus(t('add_failed')+e.message);}
}

async function removeWorkspace(path){
  const _rmWs=await showConfirmDialog({title:t('workspace_remove_confirm_title'),message:t('workspace_remove_confirm_message',path),confirmLabel:t('remove'),danger:true,focusCancel:true});
  if(!_rmWs) return;
  try{
    const data=await api('/api/workspaces/remove',{method:'POST',body:JSON.stringify({path})});
    _workspaceList=data.workspaces;
    renderWorkspacesPanel(data.workspaces);
    showToast(t('workspace_removed'));
  }catch(e){setStatus(t('remove_failed')+e.message);}
}

async function promptWorkspacePath(){
  if(!S.session)return;
  const value=await showPromptDialog({
    title:t('workspace_switch_prompt_title'),
    message:t('workspace_switch_prompt_message'),
    confirmLabel:t('workspace_switch_prompt_confirm'),
    placeholder:t('workspace_switch_prompt_placeholder'),
    value:S.session.workspace||''
  });
  const path=(value||'').trim();
  if(!path)return;
  try{
    const data=await api('/api/workspaces/add',{method:'POST',body:JSON.stringify({path})});
    _workspaceList=data.workspaces||[];
    const target=_workspaceList[_workspaceList.length-1];
    if(!target) throw new Error(t('workspace_not_added'));
    await switchToWorkspace(target.path,target.name);
  }catch(e){
    if(String(e.message||'').includes('Workspace already in list')){
      showToast(t('workspace_already_saved'));
      return;
    }
    showToast(t('workspace_switch_failed')+e.message);
  }
}

async function switchToWorkspace(path,name){
  if(!S.session)return;
  if(S.busy){
    showToast(t('workspace_busy_switch'));
    return;
  }
  if(typeof _previewDirty!=='undefined'&&_previewDirty){
    const discard=await showConfirmDialog({
      title:t('discard_file_edits_title'),
      message:t('discard_file_edits_message'),
      confirmLabel:t('discard'),
      danger:true
    });
    if(!discard)return;
    if(typeof cancelEditMode==='function')cancelEditMode();
    if(typeof clearPreview==='function')clearPreview();
  }
  try{
    closeWsDropdown();
    await api('/api/session/update',{method:'POST',body:JSON.stringify({
      session_id:S.session.session_id, workspace:path, model:S.session.model
    })});
    S.session.workspace=path;
    syncTopbar();
    await loadDir('.');
    showToast(t('workspace_switched_to',name||getWorkspaceFriendlyName(path)));
  }catch(e){setStatus(t('switch_failed')+e.message);}
}

// ── Profile panel + dropdown ──
let _profilesCache = null;

async function loadProfilesPanel() {
  const panel = $('profilesPanel');
  if (!panel) return;
  try {
    const data = await api('/api/profiles');
    _profilesCache = data;
    panel.innerHTML = '';
    if (!data.profiles || !data.profiles.length) {
      panel.innerHTML = `<div style="padding:16px;color:var(--muted);font-size:12px">${esc(t('profiles_no_profiles'))}</div>`;
      return;
    }
    for (const p of data.profiles) {
      const card = document.createElement('div');
      card.className = 'profile-card';
      const meta = [];
      if (p.model) meta.push(p.model.split('/').pop());
      if (p.provider) meta.push(p.provider);
      if (p.skill_count) meta.push(t('profile_skill_count', p.skill_count));
      if (p.has_env) meta.push(t('profile_api_keys_configured'));
      const gwDot = p.gateway_running
        ? `<span class="profile-opt-badge running" title="${esc(t('profile_gateway_running'))}"></span>`
        : `<span class="profile-opt-badge stopped" title="${esc(t('profile_gateway_stopped'))}"></span>`;
      const isActive = p.name === data.active;
      const activeBadge = isActive ? `<span style="color:var(--link);font-size:10px;font-weight:600;margin-left:6px">${esc(t('profile_active'))}</span>` : '';
      const defaultBadge = p.is_default ? ` <span style="opacity:.5">${esc(t('profile_default_label'))}</span>` : '';
      card.innerHTML = `
        <div class="profile-card-header">
          <div style="min-width:0;flex:1">
            <div class="profile-card-name${isActive ? ' is-active' : ''}">${gwDot}${esc(p.name)}${defaultBadge}${activeBadge}</div>
            ${meta.length ? `<div class="profile-card-meta">${esc(meta.join(' \u00b7 '))}</div>` : `<div class="profile-card-meta">${esc(t('profile_no_configuration'))}</div>`}
          </div>
          <div class="profile-card-actions">
            ${!isActive ? `<button class="ws-action-btn" onclick="switchToProfile('${esc(p.name)}')" title="${esc(t('profile_switch_title'))}">${esc(t('profile_use'))}</button>` : ''}
            ${!p.is_default ? `<button class="ws-action-btn danger" onclick="deleteProfile('${esc(p.name)}')" title="${esc(t('profile_delete_title'))}">${li('x',12)}</button>` : ''}
          </div>
        </div>`;
      panel.appendChild(card);
    }
  } catch (e) {
    panel.innerHTML = `<div style="color:var(--accent);font-size:12px;padding:12px">${esc(t('error_prefix'))}${esc(e.message)}</div>`;
  }
}

function renderProfileDropdown(data) {
  const dd = $('profileDropdown');
  if (!dd) return;
  dd.innerHTML = '';
  const profiles = data.profiles || [];
  const active = data.active || 'default';
  for (const p of profiles) {
    const opt = document.createElement('div');
    opt.className = 'profile-opt' + (p.name === active ? ' active' : '');
    const meta = [];
    if (p.model) meta.push(p.model.split('/').pop());
    if (p.skill_count) meta.push(t('profile_skill_count', p.skill_count));
    const gwDot = `<span class="profile-opt-badge ${p.gateway_running ? 'running' : 'stopped'}"></span>`;
    const checkmark = p.name === active ? ' <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--link)" stroke-width="3" style="vertical-align:-1px"><polyline points="20 6 9 17 4 12"/></svg>' : '';
    const defaultBadge = p.is_default ? ` <span style="opacity:.5;font-weight:400">${esc(t('profile_default_label'))}</span>` : '';
    opt.innerHTML = `<div class="profile-opt-name">${gwDot}${esc(p.name)}${defaultBadge}${checkmark}</div>` +
      (meta.length ? `<div class="profile-opt-meta">${esc(meta.join(' \u00b7 '))}</div>` : '');
    opt.onclick = async () => {
      closeProfileDropdown();
      if (p.name === active) return;
      await switchToProfile(p.name);
    };
    dd.appendChild(opt);
  }
  // Divider + Manage link
  const div = document.createElement('div'); div.className = 'ws-divider'; dd.appendChild(div);
  const mgmt = document.createElement('div'); mgmt.className = 'profile-opt ws-manage';
  mgmt.innerHTML = `${li('settings',12)} ${esc(t('manage_profiles'))}`;
  mgmt.onclick = () => { closeProfileDropdown(); mobileSwitchPanel('profiles'); };
  dd.appendChild(mgmt);
}

function toggleProfileDropdown() {
  const dd = $('profileDropdown');
  if (!dd) return;
  if (dd.classList.contains('open')) { closeProfileDropdown(); return; }
  closeWsDropdown(); // close workspace dropdown if open
  if(typeof closeModelDropdown==='function') closeModelDropdown();
  api('/api/profiles').then(data => {
    renderProfileDropdown(data);
    dd.classList.add('open');
    _positionProfileDropdown();
    const chip=$('profileChip');
    if(chip) chip.classList.add('active');
  }).catch(e => { showToast(t('profiles_load_failed')); });
}

function closeProfileDropdown() {
  const dd = $('profileDropdown');
  if (dd) dd.classList.remove('open');
  const chip=$('profileChip');
  if(chip) chip.classList.remove('active');
}
document.addEventListener('click', e => {
  if (!e.target.closest('#profileChipWrap') && !e.target.closest('#profileDropdown')) closeProfileDropdown();
});
window.addEventListener('resize',()=>{
  const dd=$('profileDropdown');
  if(dd&&dd.classList.contains('open')) _positionProfileDropdown();
});

async function switchToProfile(name) {
  if (S.busy) { showToast(t('profiles_busy_switch')); return; }

  // Determine whether the current session has any messages.
  // A session with messages is "in progress" and belongs to the current profile —
  // we must not retag it.  We'll start a fresh session for the new profile instead.
  const sessionInProgress = S.session && S.messages && S.messages.length > 0;

  try {
    const data = await api('/api/profile/switch', { method: 'POST', body: JSON.stringify({ name }) });
    S.activeProfile = data.active || name;

    // ── Model ──────────────────────────────────────────────────────────────
    localStorage.removeItem('hermes-webui-model');
    _skillsData = null;
    await populateModelDropdown();
    if (data.default_model) {
      const sel = $('modelSelect');
      const resolved = _applyModelToDropdown(data.default_model, sel);
      const modelToUse = resolved || data.default_model;
      S._pendingProfileModel = modelToUse;
      // Only patch the in-memory session model if we're NOT about to replace the session
      if (S.session && !sessionInProgress) {
        S.session.model = modelToUse;
      }
    }

    // ── Workspace ──────────────────────────────────────────────────────────
    _workspaceList = null;
    await loadWorkspaceList();
    if (data.default_workspace) {
      // Always store the profile default for new sessions
      S._profileDefaultWorkspace = data.default_workspace;

      if (S.session && !sessionInProgress) {
        // Empty session (no messages yet) — safe to update it in place
        try {
          await api('/api/session/update', { method: 'POST', body: JSON.stringify({
            session_id: S.session.session_id,
            workspace: data.default_workspace,
            model: S.session.model,
          })});
          S.session.workspace = data.default_workspace;
        } catch (_) {}
      }
    }

    // ── Session ────────────────────────────────────────────────────────────
    _showAllProfiles = false;

    if (sessionInProgress) {
      // The current session has messages and belongs to the previous profile.
      // Start a new session for the new profile so nothing gets cross-tagged.
      await newSession(false);
      // Apply profile default workspace to the newly created session (fixes #424)
      if (S._profileDefaultWorkspace && S.session) {
        try {
          await api('/api/session/update', { method: 'POST', body: JSON.stringify({
            session_id: S.session.session_id,
            workspace: S._profileDefaultWorkspace,
            model: S.session.model,
          })});
          S.session.workspace = S._profileDefaultWorkspace;
        } catch (_) {}
      }
      updateWorkspaceChip();
      await renderSessionList();
      showToast(t('profile_switched_new_conversation', name));
    } else {
      // No messages yet — just refresh the list and topbar in place
      await renderSessionList();
      syncTopbar();
      showToast(t('profile_switched', name));
    }

    // ── Sidebar panels ─────────────────────────────────────────────────────
    if (_currentPanel === 'skills') await loadSkills();
    if (_currentPanel === 'memory') await loadMemory();
    if (_currentPanel === 'tasks') await loadCrons();
    if (_currentPanel === 'profiles') await loadProfilesPanel();
    if (_currentPanel === 'workspaces') await loadWorkspacesPanel();

  } catch (e) { showToast(t('switch_failed') + e.message); }
}

function toggleProfileForm() {
  const form = $('profileCreateForm');
  if (!form) return;
  form.style.display = form.style.display === 'none' ? '' : 'none';
  if (form.style.display !== 'none') {
    $('profileFormName').value = '';
    $('profileFormClone').checked = false;
    if ($('profileFormBaseUrl')) $('profileFormBaseUrl').value = '';
    if ($('profileFormApiKey')) $('profileFormApiKey').value = '';
    const errEl = $('profileFormError');
    if (errEl) errEl.style.display = 'none';
    $('profileFormName').focus();
  }
}

async function submitProfileCreate() {
  const name = ($('profileFormName').value || '').trim().toLowerCase();
  const cloneConfig = $('profileFormClone').checked;
  const errEl = $('profileFormError');
  if (!name) { errEl.textContent = t('name_required'); errEl.style.display = ''; return; }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) { errEl.textContent = t('profile_name_rule'); errEl.style.display = ''; return; }
  try {
    const baseUrl = (($('profileFormBaseUrl') && $('profileFormBaseUrl').value) || '').trim();
    const apiKey = (($('profileFormApiKey') && $('profileFormApiKey').value) || '').trim();
    if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
      errEl.textContent = t('profile_base_url_rule'); errEl.style.display = ''; return;
    }
    const payload = { name, clone_config: cloneConfig };
    if (baseUrl) payload.base_url = baseUrl;
    if (apiKey) payload.api_key = apiKey;
    await api('/api/profile/create', { method: 'POST', body: JSON.stringify(payload) });
    toggleProfileForm();
    await loadProfilesPanel();
    showToast(t('profile_created', name));
  } catch (e) {
    errEl.textContent = e.message || t('create_failed');
    errEl.style.display = '';
  }
}

async function deleteProfile(name) {
  const _delProf=await showConfirmDialog({title:t('profile_delete_confirm_title',name),message:t('profile_delete_confirm_message'),confirmLabel:t('delete_title'),danger:true,focusCancel:true});
  if(!_delProf) return;
  try {
    await api('/api/profile/delete', { method: 'POST', body: JSON.stringify({ name }) });
    await loadProfilesPanel();
    showToast(t('profile_deleted', name));
  } catch (e) { showToast(t('delete_failed') + e.message); }
}

// ── Memory panel ──
async function loadMemory(force) {
  const panel = $('memoryPanel');
  try {
    const data = await api('/api/memory');
    _memoryData = data;  // cache for edit form
    const fmtTime = ts => ts ? new Date(ts*1000).toLocaleString() : '';
    panel.innerHTML = `
      <div class="memory-section">
        <div class="memory-section-title">
          <span style="display:inline-flex;align-items:center;gap:6px">${li('brain',14)} ${esc(t('my_notes'))}</span>
          <span class="memory-mtime">${fmtTime(data.memory_mtime)}</span>
        </div>
        ${data.memory
          ? `<div class="memory-content preview-md">${renderMd(data.memory)}</div>`
          : `<div class="memory-empty">${esc(t('no_notes_yet'))}</div>`}
      </div>
      <div class="memory-section">
        <div class="memory-section-title">
          <span style="display:inline-flex;align-items:center;gap:6px">${li('user',14)} ${esc(t('user_profile'))}</span>
          <span class="memory-mtime">${fmtTime(data.user_mtime)}</span>
        </div>
        ${data.user
          ? `<div class="memory-content preview-md">${renderMd(data.user)}</div>`
          : `<div class="memory-empty">${esc(t('no_profile_yet'))}</div>`}
      </div>`;
  } catch(e) { panel.innerHTML = `<div style="color:var(--accent);font-size:12px">${esc(t('error_prefix'))}${esc(e.message)}</div>`; }
}

// Drag and drop
const wrap=$('composerWrap');let dragCounter=0;
document.addEventListener('dragover',e=>{
  // Don't intercept if dragging over skill upload zone
  if(e.target.closest('#skillUploadDropZone')) return;
  e.preventDefault();
});
document.addEventListener('dragenter',e=>{
  // Don't intercept if dragging over skill upload zone
  if(e.target.closest('#skillUploadDropZone')) return;
  e.preventDefault();
  if(e.dataTransfer.types.includes('Files')){dragCounter++;wrap.classList.add('drag-over');}
});
document.addEventListener('dragleave',e=>{
  // Don't intercept if dragging over skill upload zone
  if(e.target.closest('#skillUploadDropZone')) return;
  dragCounter--;
  if(dragCounter<=0){dragCounter=0;wrap.classList.remove('drag-over');}
});
document.addEventListener('drop',e=>{
  // Don't intercept if dropping on skill upload zone
  if(e.target.closest('#skillUploadDropZone')) return;
  e.preventDefault();
  dragCounter=0;wrap.classList.remove('drag-over');
  const files=Array.from(e.dataTransfer.files);if(files.length){addFiles(files);$('msg').focus();}
});

// ── Settings panel ───────────────────────────────────────────────────────────

let _settingsDirty = false;
let _settingsThemeOnOpen = null; // track theme at open time for discard revert
let _settingsSkinOnOpen = null; // track skin at open time for discard revert
let _settingsSection = 'conversation';

function switchSettingsSection(name){
  const validSections = ['conversation','appearance','preferences','system','models','channels','usage'];
  const section = validSections.includes(name) ? name : 'conversation';
  _settingsSection = section;
  const sectionMap = {conversation:'Conversation',appearance:'Appearance',preferences:'Preferences',system:'System',models:'Models',channels:'Channels',usage:'Usage'};
  validSections.forEach(key => {
    const tab = $('settingsTab' + sectionMap[key]);
    const pane = $('settingsPane' + sectionMap[key]);
    const active = key === section;
    if (tab) {
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    if (pane) pane.classList.toggle('active', active);
  });
  // Lazy-load content when switching to new tabs
  if (section === 'models') loadModelsProviders();
  if (section === 'channels') loadChannels();
  if (section === 'usage') loadUsageStats();
}

function _syncHermesPanelSessionActions(){
  const hasSession=!!S.session;
  const visibleMessages=hasSession?(S.messages||[]).filter(m=>m&&m.role&&m.role!=='tool').length:0;
  const title=hasSession?(S.session.title||t('untitled')):t('active_conversation_none');
  const meta=$('hermesSessionMeta');
  if(meta){
    meta.textContent=hasSession
      ? t('active_conversation_meta', title, visibleMessages)
      : t('active_conversation_none');
  }
  const setDisabled=(id,disabled)=>{
    const el=$(id);
    if(!el)return;
    el.disabled=!!disabled;
    el.classList.toggle('disabled',!!disabled);
  };
  setDisabled('btnDownload',!hasSession||visibleMessages===0);
  setDisabled('btnExportJSON',!hasSession);
  setDisabled('btnClearConvModal',!hasSession||visibleMessages===0);
}

function toggleSettings(){
  const overlay=$('settingsOverlay');
  if(!overlay) return;
  if(overlay.style.display==='none'){
    _settingsDirty = false;
    _settingsThemeOnOpen = localStorage.getItem('hermes-theme') || 'dark';
    _settingsSkinOnOpen = localStorage.getItem('hermes-skin') || 'default';
    _settingsSection = 'conversation';
    overlay.style.display='';
    loadSettingsPanel();
  } else {
    _closeSettingsPanel();
  }
}

function _resetSettingsPanelState(){
  _settingsSection = 'conversation';
  switchSettingsSection('conversation');
  const bar=$('settingsUnsavedBar');
  if(bar) bar.style.display='none';
}

function _hideSettingsPanel(){
  const overlay=$('settingsOverlay');
  if(!overlay) return;
  _resetSettingsPanelState();
  overlay.style.display='none';
}

// Close with unsaved-changes check. If dirty, show a confirm dialog.
function _closeSettingsPanel(){
  if(!_settingsDirty){
    // Nothing changed -- revert any live preview and close
    _revertSettingsPreview();
    _hideSettingsPanel();
    return;
  }
  // Dirty -- show inline confirm bar
  _showSettingsUnsavedBar();
}

// Revert live DOM/localStorage to what they were when the panel opened
function _revertSettingsPreview(){
  if(_settingsThemeOnOpen){
    localStorage.setItem('hermes-theme', _settingsThemeOnOpen);
    if(typeof _applyTheme==='function') _applyTheme(_settingsThemeOnOpen);
  }
  if(_settingsSkinOnOpen){
    localStorage.setItem('hermes-skin', _settingsSkinOnOpen);
    if(typeof _applySkin==='function') _applySkin(_settingsSkinOnOpen);
  }
}

// Show the "Unsaved changes" bar inside the settings panel
function _showSettingsUnsavedBar(){
  let bar = $('settingsUnsavedBar');
  if(bar){ bar.style.display=''; return; }
  // Create it
  bar = document.createElement('div');
  bar.id = 'settingsUnsavedBar';
  bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;background:rgba(233,69,96,.12);border:1px solid rgba(233,69,96,.3);border-radius:8px;padding:10px 14px;margin:0 0 12px;font-size:13px;';
  bar.innerHTML = `<span style="color:var(--text)">${esc(t('settings_unsaved_changes'))}</span>`
    + '<span style="display:flex;gap:8px">'
    + `<button onclick="_discardSettings()" style="padding:5px 12px;border-radius:6px;border:1px solid var(--border2);background:rgba(255,255,255,.06);color:var(--muted);cursor:pointer;font-size:12px;font-weight:600">${esc(t('discard'))}</button>`
    + `<button onclick="saveSettings(true)" style="padding:5px 12px;border-radius:6px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:12px;font-weight:600">${esc(t('save'))}</button>`
    + '</span>';
  const body = document.querySelector('.settings-main') || document.querySelector('.settings-body') || document.querySelector('.settings-panel');
  if(body) body.prepend(bar);
}

function _discardSettings(){
  _revertSettingsPreview();
  _settingsDirty = false;
  _hideSettingsPanel();
}

// Mark settings as dirty whenever anything changes
function _markSettingsDirty(){
  _settingsDirty = true;
}

async function loadSettingsPanel(){
  try{
    const settings=await api('/api/settings');
    // Hydrate appearance controls first so a slow /api/models request
    // cannot overwrite an in-progress theme/skin selection.
    const themeSel=$('settingsTheme');
    const themeVal=settings.theme||'dark';
    if(themeSel) themeSel.value=themeVal;
    if(typeof _syncThemePicker==='function') _syncThemePicker(themeVal);
    const skinVal=(settings.skin||'default').toLowerCase();
    const skinSel=$('settingsSkin');
    if(skinSel) skinSel.value=skinVal;
    if(typeof _buildSkinPicker==='function') _buildSkinPicker(skinVal);
    const resolvedLanguage=(typeof resolvePreferredLocale==='function')
      ? resolvePreferredLocale(settings.language, localStorage.getItem('hermes-lang'))
      : (settings.language || localStorage.getItem('hermes-lang') || 'en');
    // Keep settings modal and current page strings in sync with the resolved locale.
    if(typeof setLocale==='function'){
      setLocale(resolvedLanguage);
      if(typeof applyLocaleToDOM==='function') applyLocaleToDOM();
    }
    // Populate model dropdown from /api/models
    const modelSel=$('settingsModel');
    if(modelSel){
      modelSel.innerHTML='';
      try{
        const models=await api('/api/models');
        for(const g of (models.groups||[])){
          const og=document.createElement('optgroup');
          og.label=g.provider;
          for(const m of g.models){
            const opt=document.createElement('option');
            opt.value=m.id;opt.textContent=m.label;
            og.appendChild(opt);
          }
          modelSel.appendChild(og);
        }
      }catch(e){}
      modelSel.value=settings.default_model||'';
      modelSel.addEventListener('change',_markSettingsDirty,{once:false});
    }
    // Send key preference
    const sendKeySel=$('settingsSendKey');
    if(sendKeySel){sendKeySel.value=settings.send_key||'enter';sendKeySel.addEventListener('change',_markSettingsDirty,{once:false});}
    // Language preference — populate from LOCALES bundle
    const langSel=$('settingsLanguage');
    if(langSel){
      langSel.innerHTML='';
      if(typeof LOCALES!=='undefined'){
        for(const [code,bundle] of Object.entries(LOCALES)){
          const opt=document.createElement('option');
          opt.value=code;opt.textContent=bundle._label||code;
          langSel.appendChild(opt);
        }
      }
      langSel.value=resolvedLanguage;
      langSel.addEventListener('change',_markSettingsDirty,{once:false});
    }
    const showUsageCb=$('settingsShowTokenUsage');
    if(showUsageCb){showUsageCb.checked=!!settings.show_token_usage;showUsageCb.addEventListener('change',_markSettingsDirty,{once:false});}
    const showCliCb=$('settingsShowCliSessions');
    if(showCliCb){showCliCb.checked=!!settings.show_cli_sessions;showCliCb.addEventListener('change',_markSettingsDirty,{once:false});}
    const syncCb=$('settingsSyncInsights');
    if(syncCb){syncCb.checked=!!settings.sync_to_insights;syncCb.addEventListener('change',_markSettingsDirty,{once:false});}
    const updateCb=$('settingsCheckUpdates');
    if(updateCb){updateCb.checked=settings.check_for_updates!==false;updateCb.addEventListener('change',_markSettingsDirty,{once:false});}
    const soundCb=$('settingsSoundEnabled');
    if(soundCb){soundCb.checked=!!settings.sound_enabled;soundCb.addEventListener('change',_markSettingsDirty,{once:false});}
    const notifCb=$('settingsNotificationsEnabled');
    if(notifCb){notifCb.checked=!!settings.notifications_enabled;notifCb.addEventListener('change',_markSettingsDirty,{once:false});}
    const bubbleCb=$('settingsBubbleLayout');
    if(bubbleCb){bubbleCb.checked=!!settings.bubble_layout;bubbleCb.addEventListener('change',_markSettingsDirty,{once:false});}
    // Bot name
    const botNameField=$('settingsBotName');
    if(botNameField){botNameField.value=settings.bot_name||'Hermes';botNameField.addEventListener('input',_markSettingsDirty,{once:false});}
    // Password field: always blank (we don't send hash back)
    const pwField=$('settingsPassword');
    if(pwField){pwField.value='';pwField.addEventListener('input',_markSettingsDirty,{once:false});}
    // Show auth buttons only when auth is active
    try{
      const authStatus=await api('/api/auth/status');
      _setSettingsAuthButtonsVisible(!!authStatus.auth_enabled);
    }catch(e){}
    _syncHermesPanelSessionActions();
    switchSettingsSection(_settingsSection);
  }catch(e){
    showToast(t('settings_load_failed')+e.message);
  }
}

function _setSettingsAuthButtonsVisible(active){
  const signOutBtn=$('btnSignOut');
  if(signOutBtn) signOutBtn.style.display=active?'':'none';
  const disableBtn=$('btnDisableAuth');
  if(disableBtn) disableBtn.style.display=active?'':'none';
}

function _applySavedSettingsUi(saved, body, opts){
  const {sendKey,showTokenUsage,showCliSessions,theme,skin,language}=opts;
  window._sendKey=sendKey||'enter';
  window._showTokenUsage=showTokenUsage;
  window._showCliSessions=showCliSessions;
  window._soundEnabled=body.sound_enabled;
  window._notificationsEnabled=body.notifications_enabled;
  window._botName=body.bot_name||'Hermes';
  document.body.classList.toggle('bubble-layout', !!body.bubble_layout);
  if(typeof applyBotName==='function') applyBotName();
  if(typeof setLocale==='function') setLocale(language);
  if(typeof applyLocaleToDOM==='function') applyLocaleToDOM();
  if(typeof startGatewaySSE==='function'){
    if(showCliSessions) startGatewaySSE();
    else if(typeof stopGatewaySSE==='function') stopGatewaySSE();
  }
  _setSettingsAuthButtonsVisible(!!saved.auth_enabled);
  _settingsDirty=false;
  _settingsThemeOnOpen=theme;
  _settingsSkinOnOpen=skin||'default';
  const bar=$('settingsUnsavedBar');
  if(bar) bar.style.display='none';
  renderMessages();
  if(typeof syncTopbar==='function') syncTopbar();
  if(typeof renderSessionList==='function') renderSessionList();
}

async function saveSettings(andClose){
  const model=($('settingsModel')||{}).value;
  const sendKey=($('settingsSendKey')||{}).value;
  const showTokenUsage=!!($('settingsShowTokenUsage')||{}).checked;
  const showCliSessions=!!($('settingsShowCliSessions')||{}).checked;
  const pw=($('settingsPassword')||{}).value;
  const theme=($('settingsTheme')||{}).value||'dark';
  const skin=($('settingsSkin')||{}).value||'default';
  const language=($('settingsLanguage')||{}).value||'en';
  const body={};
  if(model) body.default_model=model;

  if(sendKey) body.send_key=sendKey;
  body.theme=theme;
  body.skin=skin;
  body.language=language;
  body.show_token_usage=showTokenUsage;
  body.show_cli_sessions=showCliSessions;
  body.sync_to_insights=!!($('settingsSyncInsights')||{}).checked;
  body.check_for_updates=!!($('settingsCheckUpdates')||{}).checked;
  body.sound_enabled=!!($('settingsSoundEnabled')||{}).checked;
  body.notifications_enabled=!!($('settingsNotificationsEnabled')||{}).checked;
  body.bubble_layout=!!($('settingsBubbleLayout')||{}).checked;
  document.body.classList.toggle('bubble-layout', body.bubble_layout);
  const botName=(($('settingsBotName')||{}).value||'').trim();
  body.bot_name=botName||'Hermes';
  // Password: only act if the field has content; blank = leave auth unchanged
  if(pw && pw.trim()){
    try{
      const saved=await api('/api/settings',{method:'POST',body:JSON.stringify({...body,_set_password:pw.trim()})});
      _applySavedSettingsUi(saved, body, {sendKey,showTokenUsage,showCliSessions,theme,skin,language});
      showToast(t(saved.auth_just_enabled?'settings_saved_pw':'settings_saved_pw_updated'));
      _hideSettingsPanel();
      return;
    }catch(e){showToast(t('settings_save_failed')+e.message);return;}
  }
  try{
    const saved=await api('/api/settings',{method:'POST',body:JSON.stringify(body)});
    _applySavedSettingsUi(saved, body, {sendKey,showTokenUsage,showCliSessions,theme,skin,language});
    showToast(t('settings_saved'));
    _hideSettingsPanel();
  }catch(e){
    showToast(t('settings_save_failed')+e.message);
  }
}

async function signOut(){
  try{
    await api('/api/auth/logout',{method:'POST',body:'{}'});
    window.location.href='login';
  }catch(e){
    showToast(t('sign_out_failed')+e.message);
  }
}

async function disableAuth(){
  const _disAuth=await showConfirmDialog({title:t('disable_auth_confirm_title'),message:t('disable_auth_confirm_message'),confirmLabel:t('disable'),danger:true,focusCancel:true});
  if(!_disAuth) return;
  try{
    await api('/api/settings',{method:'POST',body:JSON.stringify({_clear_password:true})});
    showToast(t('auth_disabled'));
    // Hide both auth buttons since auth is now off
    const disableBtn=$('btnDisableAuth');
    if(disableBtn) disableBtn.style.display='none';
    const signOutBtn=$('btnSignOut');
    if(signOutBtn) signOutBtn.style.display='none';
  }catch(e){
    showToast(t('disable_auth_failed')+e.message);
  }
}

// Close settings on overlay click (not panel click) -- with unsaved-changes check
document.addEventListener('click',e=>{
  const overlay=$('settingsOverlay');
  if(overlay&&e.target===overlay) _closeSettingsPanel();
});

// ── Cron completion alerts ────────────────────────────────────────────────────

let _cronPollSince=Date.now()/1000;  // track from page load
let _cronPollTimer=null;
let _cronUnreadCount=0;

function startCronPolling(){
  if(_cronPollTimer) return;
  _cronPollTimer=setInterval(async()=>{
    if(document.hidden) return;  // don't poll when tab is in background
    try{
      const data=await api(`/api/crons/recent?since=${_cronPollSince}`);
      if(data.completions&&data.completions.length>0){
        for(const c of data.completions){
          showToast(t('cron_completion_status', c.name, c.status==='error' ? t('status_failed') : t('status_completed')),4000);
          _cronPollSince=Math.max(_cronPollSince,c.completed_at);
        }
        _cronUnreadCount+=data.completions.length;
        updateCronBadge();
      }
    }catch(e){}
  },30000);
}

function updateCronBadge(){
  const tab=document.querySelector('.nav-tab[data-panel="tasks"]');
  if(!tab) return;
  let badge=tab.querySelector('.cron-badge');
  if(_cronUnreadCount>0){
    if(!badge){
      badge=document.createElement('span');
      badge.className='cron-badge';
      tab.style.position='relative';
      tab.appendChild(badge);
    }
    badge.textContent=_cronUnreadCount>9?'9+':_cronUnreadCount;
    badge.style.display='';
  }else if(badge){
    badge.style.display='none';
  }
}

// Clear cron badge when Tasks tab is opened
const _origSwitchPanel=switchPanel;
switchPanel=async function(name){
  if(name==='tasks'){_cronUnreadCount=0;updateCronBadge();}
  return _origSwitchPanel(name);
};

// Start polling on page load
startCronPolling();

// ── Background agent error tracking ──────────────────────────────────────────

const _backgroundErrors=[];  // {session_id, title, message, ts}

function trackBackgroundError(sessionId, title, message){
  // Only track if user is NOT currently viewing this session
  if(S.session&&S.session.session_id===sessionId) return;
  _backgroundErrors.push({session_id:sessionId, title:title||t('untitled'), message, ts:Date.now()});
  showErrorBanner();
}

function showErrorBanner(){
  let banner=$('bgErrorBanner');
  if(!banner){
    banner=document.createElement('div');
    banner.id='bgErrorBanner';
    banner.className='bg-error-banner';
    const msgs=document.querySelector('.messages');
    if(msgs) msgs.parentNode.insertBefore(banner,msgs);
    else document.body.appendChild(banner);
  }
  const latest=_backgroundErrors[0];  // FIFO: show oldest (first) error
  if(!latest){banner.style.display='none';return;}
  const count=_backgroundErrors.length;
  const msg=count>1?t('bg_error_multi',count):t('bg_error_single',latest.title);
  banner.innerHTML=`<span>\u26a0 ${esc(msg)}</span><div style="display:flex;gap:6px;flex-shrink:0"><button class="reconnect-btn" onclick="navigateToErrorSession()">${esc(t('view'))}</button><button class="reconnect-btn" onclick="dismissErrorBanner()">${esc(t('dismiss'))}</button></div>`;
  banner.style.display='';
}

function navigateToErrorSession(){
  const latest=_backgroundErrors.shift();  // FIFO: show oldest error first
  if(latest){
    loadSession(latest.session_id);renderSessionList();
  }
  if(_backgroundErrors.length===0) dismissErrorBanner();
  else showErrorBanner();
}

function dismissErrorBanner(){
  _backgroundErrors.length=0;
  const banner=$('bgErrorBanner');
  if(banner) banner.style.display='none';
}

// ── Models Tab ────────────────────────────────────────────────────────────────

const PROVIDER_PRESETS = [
  { label: 'Anthropic', value: 'anthropic', base_url: 'https://api.anthropic.com', models: ['claude-opus-4-7','claude-opus-4-6','claude-sonnet-4-6','claude-opus-4-5-20251101','claude-sonnet-4-5-20250929','claude-opus-4-20250514','claude-sonnet-4-20250514','claude-haiku-4-5-20251001'] },
  { label: 'Google AI Studio', value: 'gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-3.1-pro-preview','gemini-3-flash-preview','gemini-3.1-flash-lite-preview','gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite','gemma-4-31b-it','gemma-4-26b-it'] },
  { label: 'DeepSeek', value: 'deepseek', base_url: 'https://api.deepseek.com', models: ['deepseek-chat','deepseek-reasoner'] },
  { label: 'Z.AI / GLM', value: 'zai', base_url: 'https://api.z.ai/api/paas/v4', models: ['glm-5.1','glm-5','glm-5v-turbo','glm-5-turbo','glm-4.7','glm-4.5','glm-4.5-flash'] },
  { label: 'Kimi for Coding', value: 'kimi-coding', base_url: 'https://api.kimi.com/coding/v1', models: ['kimi-for-coding','kimi-k2.5','kimi-k2-thinking','kimi-k2-thinking-turbo','kimi-k2-turbo-preview','kimi-k2-0905-preview'] },
  { label: 'Kimi for Coding (CN)', value: 'kimi-coding-cn', base_url: 'https://api.kimi.com/coding/v1', models: ['kimi-k2.5','kimi-k2-thinking','kimi-k2-turbo-preview','kimi-k2-0905-preview'] },
  { label: 'Moonshot', value: 'moonshot', base_url: 'https://api.moonshot.cn/v1', models: ['kimi-k2.5','kimi-k2-thinking','kimi-k2-turbo-preview','kimi-k2-0905-preview'] },
  { label: 'xAI', value: 'xai', base_url: 'https://api.x.ai/v1', models: ['grok-4.20-reasoning','grok-4-1-fast-reasoning'] },
  { label: 'MiniMax', value: 'minimax', base_url: 'https://api.minimax.io/anthropic/v1', models: ['MiniMax-M2.7','MiniMax-M2.7-highspeed','MiniMax-M2.5','MiniMax-M2.5-highspeed','MiniMax-M2.1','MiniMax-M2.1-highspeed','MiniMax-M2','MiniMax-M2-highspeed'] },
  { label: 'MiniMax (China)', value: 'minimax-cn', base_url: 'https://api.minimaxi.com/v1', models: ['MiniMax-M2.7','MiniMax-M2.7-highspeed','MiniMax-M2.5','MiniMax-M2.5-highspeed','MiniMax-M2.1','MiniMax-M2.1-highspeed','MiniMax-M2','MiniMax-M2-highspeed'] },
  { label: 'Alibaba Cloud', value: 'alibaba', base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', models: ['qwen3.5-plus','qwen3-coder-plus','qwen3-coder-next','glm-5','glm-4.7','kimi-k2.5','MiniMax-M2.5'] },
  { label: 'Hugging Face', value: 'huggingface', base_url: 'https://router.huggingface.co/v1', models: ['Qwen/Qwen3.5-397B-A17B','Qwen/Qwen3.5-35B-A3B','deepseek-ai/DeepSeek-V3.2','moonshotai/Kimi-K2.5','MiniMaxAI/MiniMax-M2.5','zai-org/GLM-5','XiaomiMiMo/MiMo-V2-Flash','moonshotai/Kimi-K2-Thinking'] },
  { label: 'Xiaomi MiMo', value: 'xiaomi', base_url: 'https://api.xiaomimimo.com/v1', models: ['mimo-v2-pro','mimo-v2-omni','mimo-v2-flash'] },
  { label: 'Kilo Code', value: 'kilocode', base_url: 'https://api.kilo.ai/api/gateway', models: ['anthropic/claude-opus-4.6','anthropic/claude-sonnet-4.6','openai/gpt-5.4','google/gemini-3-pro-preview','google/gemini-3-flash-preview'] },
  { label: 'Vercel AI Gateway', value: 'ai-gateway', base_url: 'https://ai-gateway.vercel.sh/v1', models: ['anthropic/claude-opus-4.6','anthropic/claude-sonnet-4.6','anthropic/claude-sonnet-4.5','anthropic/claude-haiku-4.5','openai/gpt-5','openai/gpt-4.1','openai/gpt-4.1-mini','google/gemini-3-pro-preview','google/gemini-3-flash','google/gemini-2.5-pro','google/gemini-2.5-flash','deepseek/deepseek-v3.2'] },
  { label: 'OpenCode Zen', value: 'opencode-zen', base_url: 'https://opencode.ai/zen/v1', models: ['gpt-5.4-pro','gpt-5.4','gpt-5.3-codex','gpt-5.3-codex-spark','gpt-5.2','gpt-5.2-codex','gpt-5.1','gpt-5.1-codex','gpt-5.1-codex-max','gpt-5.1-codex-mini','gpt-5','gpt-5-codex','gpt-5-nano','claude-opus-4-6','claude-opus-4-5','claude-opus-4-1','claude-sonnet-4-6','claude-sonnet-4-5','claude-sonnet-4','claude-haiku-4-5','claude-3-5-haiku','gemini-3.1-pro','gemini-3-pro','gemini-3-flash','minimax-m2.7','minimax-m2.5','minimax-m2.5-free','minimax-m2.1','glm-5','glm-4.7','glm-4.6','kimi-k2.5','kimi-k2-thinking','kimi-k2','qwen3-coder','big-pickle'] },
  { label: 'OpenCode Go', value: 'opencode-go', base_url: 'https://opencode.ai/zen/go/v1', models: ['glm-5.1','glm-5','kimi-k2.5','mimo-v2-pro','mimo-v2-omni','minimax-m2.7','minimax-m2.5'] },
  { label: 'OpenAI Codex', value: 'openai-codex', base_url: 'https://chatgpt.com/backend-api/codex', models: ['gpt-5.4-mini','gpt-5.4','gpt-5.3-codex','gpt-5.2-codex','gpt-5.1-codex-max','gpt-5.1-codex-mini'] },
  { label: 'Arcee AI', value: 'arcee', base_url: 'https://api.arcee.ai/v1', models: ['trinity-large-thinking','trinity-large-preview','trinity-mini'] },
  { label: 'OpenRouter', value: 'openrouter', base_url: 'https://openrouter.ai/api/v1', models: [] },
];

let _providerType = 'preset';
let _selectedPreset = null;

function buildPresetOptions() {
  const sel = $('presetSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Choose a provider --</option>' +
    PROVIDER_PRESETS.map(p =>
      `<option value="${esc(p.value)}">${esc(p.label)}</option>`
    ).join('');
}

function setProviderType(type) {
  _providerType = type;
  _selectedPreset = null;
  const tabPreset = $('tabPreset');
  const tabCustom = $('tabCustom');
  const presetSection = $('presetSelectorSection');
  if (tabPreset) tabPreset.style.cssText = type === 'preset' ? 'flex:1;padding:7px;font-weight:600;background:var(--accent);color:var(--bg)' : 'flex:1;padding:7px;font-weight:600';
  if (tabCustom) tabCustom.style.cssText = type === 'custom' ? 'flex:1;padding:7px;font-weight:600;background:var(--accent);color:var(--bg)' : 'flex:1;padding:7px;font-weight:600';
  if (presetSection) presetSection.style.display = type === 'preset' ? '' : 'none';
  $('providerFormName').value = '';
  $('providerFormBaseUrl').value = '';
  $('providerFormApiKey').value = '';
  $('providerFormModel').value = '';
  $('fetchedModelsList').style.display = 'none';
  $('fetchModelsStatus').style.display = 'none';
  if (type === 'preset') buildPresetOptions();
}

function onPresetChange() {
  const sel = $('presetSelect');
  if (!sel) return;
  _selectedPreset = sel.value;
  const preset = PROVIDER_PRESETS.find(p => p.value === _selectedPreset);
  if (preset) {
    $('providerFormName').value = preset.label;
    $('providerFormName').disabled = true;
    $('providerFormBaseUrl').value = preset.base_url;
    $('providerFormBaseUrl').disabled = true;
    $('providerFormModel').value = preset.models[0] || '';
  } else {
    $('providerFormName').value = '';
    $('providerFormName').disabled = false;
    $('providerFormBaseUrl').value = '';
    $('providerFormBaseUrl').disabled = false;
  }
}

async function loadModelsProviders() {
  const container = $('modelsProviderList');
  if (!container) return;
  try {
    const data = await api('/api/models/provider');
    const groups = data.groups || [];
    const customProviders = data.custom_providers || [];
    // groups already contain named custom providers from get_available_models()
    // custom_providers list is used for Edit/Test/Delete operations only
    if (groups.length === 0) {
      container.innerHTML = `<div class="models-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity:.3">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
        </svg>
        <p>No providers configured. Add one above.</p>
      </div>`;
      return;
    }
    // Provider test status cache: persisted in localStorage
    const _saved = localStorage.getItem('hermes_provider_test_status');
    window._providerTestStatus = _saved ? JSON.parse(_saved) : {};
    container.innerHTML = groups.map(g => {
      // Named custom providers: g.provider = display name (e.g. "Test3"), g.label = null
      // Built-in providers: g.provider = internal name (e.g. "openrouter"), g.label = display name
      const gLabel = g.label || g.provider;
      const isCustom = customProviders.some(cp => cp.name === g.provider);
      // Get base_url from customProviders for custom, or g.base_url for built-in
      const cpEntry = customProviders.find(cp => cp.name === g.provider);
      const baseUrl = cpEntry ? cpEntry.base_url : (g.base_url || '');
      const models = g.models || [];
      const modelLabels = models.map(m => m.label || m.id);
      const modelPreview = modelLabels.length > 0
        ? modelLabels.slice(0, 8).join(', ') + (modelLabels.length > 8 ? '...' : '')
        : 'No models loaded';
      const testStatus = window._providerTestStatus[g.provider];
      const statusIcon = testStatus === 'pass' ? '&#10004;' : (testStatus === 'fail' ? '&#10060;' : '&#8212;');
      const statusTitle = testStatus === 'pass' ? 'Test passed' : (testStatus === 'fail' ? 'Test failed' : 'Not tested');
      return `<div class="provider-card">
        <div class="card-header">
          <h3 class="provider-name">${isCustom ? `<span class="test-status-icon ${testStatus ? 'status-' + testStatus : ''}" id="status-icon-${esc(g.provider)}" title="${statusTitle}">${statusIcon}</span>` : ''}${esc(gLabel)}</h3>
          <span class="type-badge ${isCustom ? 'custom' : 'builtin'}">${isCustom ? 'Custom' : 'Built-in'}</span>
        </div>
        <div class="card-body">
          <div class="info-row">
            <span class="info-label">Provider</span>
            <code class="info-value mono">${esc(g.provider)}</code>
          </div>
          <div class="info-row">
            <span class="info-label">Base URL</span>
            <code class="info-value mono">${esc(baseUrl || '—')}</code>
          </div>
          <div class="info-row">
            <span class="info-label">Models</span>
            <span class="info-value" title="${esc(modelPreview)}">${models.length} available</span>
          </div>
          <div class="models-chips" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
            ${modelLabels.slice(0, 12).map(m => `<span class="model-chip">${esc(m)}</span>`).join('')}
            ${modelLabels.length > 12 ? `<span class="model-chip" style="opacity:0.5">+${modelLabels.length - 12} more</span>` : ''}
          </div>
        </div>
        <div class="card-actions">
          ${isCustom ? `<button class="sm-btn" onclick="openEditProviderForm('${esc(g.provider)}')" style="width:auto;padding:4px 10px;font-size:10px">Edit</button>` : ''}
          ${isCustom ? `<button class="sm-btn" onclick="testProvider('${esc(g.provider)}')" style="width:auto;padding:4px 10px;font-size:10px" id="test-btn-${esc(g.provider)}">Test</button>` : ''}
          ${isCustom ? `<button class="sm-btn" onclick="confirmRemoveProvider('${esc(g.provider)}','${esc(gLabel)}')" style="width:auto;padding:4px 10px;font-size:10px;color:#e85">Delete</button>` : ''}
          ${!isCustom ? `<button class="sm-btn" onclick="setDefaultProvider('${esc(g.provider)}','${esc(gLabel)}')" style="width:auto;padding:4px 10px;font-size:10px">Set Default</button>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = `<div style="color:var(--accent);font-size:12px;text-align:center;padding:20px">Error: ${esc(e.message)}</div>`;
  }
}

function confirmRemoveProvider(provider, label) {
  showConfirmDialog({
    title: 'Delete Provider',
    message: `Delete "${label}"? This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  }).then(confirmed => {
    if (confirmed) removeProvider(provider);
  });
}

async function removeProvider(name) {
  const key = name.startsWith('custom:') ? name.slice(7) : name;
  try {
    const result = await api('/api/models/provider/' + encodeURIComponent(key), { method: 'DELETE' });
    if (result.error) { showToast('Error: ' + result.error); return; }
    showToast('Provider removed');
    loadModelsProviders();
  } catch(e) {
    showToast('Error: ' + e.message);
  }
}

function openEditProviderForm(name) {
  // Load the existing provider data into the add form and switch it to custom mode
  api('/api/models/provider').then(data => {
    const customProviders = data.custom_providers || [];
    const cfg = customProviders.find(p => p.name === name);
    if (!cfg) { showToast('Provider not found'); return; }
    openAddProviderForm();
    setProviderType('custom');
    $('providerFormName').value = name;
    $('providerFormName').disabled = true; // can't change name on edit
    $('providerFormBaseUrl').value = cfg.base_url || '';
    $('providerFormApiKey').value = cfg.api_key || '';
    $('providerFormModel').value = cfg.model || '';
    // Remove the "Add Provider" button and replace with "Update Provider"
    const addBtn = document.querySelector('[data-i18n="models_save_btn"]');
    if (addBtn) {
      addBtn.textContent = 'Update Provider';
      addBtn.dataset.editMode = name;
      addBtn.onclick = function() { submitEditProvider(name); };
    }
  }).catch(e => { showToast('Error: ' + e.message); });
}

async function submitEditProvider(originalName) {
  const base_url = $('providerFormBaseUrl').value.trim();
  const api_key = $('providerFormApiKey').value.trim();
  const model = $('providerFormModel').value.trim();
  if (!base_url) { showToast('Base URL is required'); return; }
  try {
    await api('/api/models/provider/' + encodeURIComponent(originalName), {
      method: 'PUT',
      body: JSON.stringify({ name: originalName, base_url, api_key, model })
    });
    showToast('Provider updated');
    closeAddProviderForm();
    loadModelsProviders();
    // Restore Add button
    const addBtn = document.querySelector('[data-i18n="models_save_btn"]');
    if (addBtn) {
      addBtn.textContent = 'Add Provider';
      delete addBtn.dataset.editMode;
      addBtn.onclick = submitAddProvider;
    }
  } catch(e) {
    showToast('Error: ' + e.message);
  }
}

async function testProvider(name) {
  const btn = $('test-btn-' + name);
  const origText = btn ? btn.textContent : 'Test';
  if (btn) { btn.disabled = true; btn.textContent = 'Testing...'; }
  try {
    const data = await api('/api/models/provider');
    const cfg = (data.custom_providers || []).find(p => p.name === name);
    if (!cfg) { showToast('Provider not found'); return; }
    const result = await api('/api/models/test', {
      method: 'POST',
      body: JSON.stringify({ base_url: cfg.base_url, api_key: cfg.api_key, model: cfg.model })
    });
    if (result.ok) {
      window._providerTestStatus[name] = 'pass';
      localStorage.setItem('hermes_provider_test_status', JSON.stringify(window._providerTestStatus));
      const icon = $('status-icon-' + name);
      if (icon) { icon.innerHTML = '&#10004;'; icon.className = 'test-status-icon status-pass'; icon.title = 'Test passed'; }
      showToast('Test successful! Received response from ' + name);
    } else {
      window._providerTestStatus[name] = 'fail';
      localStorage.setItem('hermes_provider_test_status', JSON.stringify(window._providerTestStatus));
      const icon = $('status-icon-' + name);
      if (icon) { icon.innerHTML = '&#10060;'; icon.className = 'test-status-icon status-fail'; icon.title = 'Test failed'; }
      const err = result.error || '';
      // Handle nested error object like {error: {message: "...", code: 401}}
      const msg = typeof err === 'object' ? (err.message || err.msg || JSON.stringify(err)) : err;
      showToast('Test failed: ' + msg);
    }
  } catch(e) {
    showToast('Test error: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}

function openAddProviderForm() {
  $('modelsAddForm').style.display = '';
  $('providerFormApiKey').value = '';
  $('fetchedModelsList').style.display = 'none';
  $('fetchModelsStatus').style.display = 'none';
  $('providerFormModel').value = '';
  $('providerFormName').value = '';
  $('providerFormName').disabled = false;
  setProviderType('preset');
  _selectedPreset = null;
  // Restore Add button in case we were in edit mode
  const addBtn = document.querySelector('[data-i18n="models_save_btn"]');
  if (addBtn) {
    addBtn.textContent = 'Add Provider';
    delete addBtn.dataset.editMode;
    addBtn.onclick = submitAddProvider;
  }
}

function closeAddProviderForm() {
  $('modelsAddForm').style.display = 'none';
  // Restore Add button in case we were in edit mode
  const addBtn = document.querySelector('[data-i18n="models_save_btn"]');
  if (addBtn) {
    addBtn.textContent = 'Add Provider';
    delete addBtn.dataset.editMode;
    addBtn.onclick = submitAddProvider;
  }
}

async function fetchModelsFromUrl() {
  const baseUrl = $('providerFormBaseUrl').value.trim();
  if (!baseUrl) return;
  const status = $('fetchModelsStatus');
  const list = $('fetchedModelsList');
  const btn = $('btnFetchModels');
  status.style.display = '';
  status.style.background = 'rgba(255,168,0,0.1)';
  status.style.color = 'var(--text)';
  status.textContent = 'Fetching models...';
  list.style.display = 'none';
  btn.disabled = true;
  try {
    const normalizedUrl = baseUrl.endsWith('/v1') ? baseUrl : baseUrl.replace(/\/$/, '') + '/v1';
    const resp = await fetch('/api/models/proxy-fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: normalizedUrl, api_key: $('providerFormApiKey').value.trim() })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    const models = data.models || [];
    if (models.length === 0) throw new Error('No models found');
    status.style.background = 'rgba(0,200,100,0.1)';
    status.style.color = '#0c8';
    status.textContent = `Found ${models.length} models — click one to select`;
    list.style.display = '';
    list.innerHTML = models.slice(0, 80).map(m =>
      `<div onclick="selectFetchedModel('${esc(m)}')" style="padding:4px 6px;font-size:11px;cursor:pointer;border-radius:4px;margin-bottom:2px" onmouseover="this.style.background='var(--border2)'" onmouseout="this.style.background='transparent'">${esc(m)}</div>`
    ).join('');
    if (models.length > 80) list.innerHTML += `<div style="padding:4px 6px;font-size:11px;color:var(--muted)">...and ${models.length - 80} more</div>`;
  } catch(e) {
    status.style.background = 'rgba(233,69,96,0.1)';
    status.style.color = 'var(--accent)';
    status.textContent = 'Fetch failed: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

function selectFetchedModel(modelId) {
  $('providerFormModel').value = modelId;
  $('fetchedModelsList').style.display = 'none';
  $('fetchModelsStatus').style.display = 'none';
}

async function submitAddProvider() {
  const name = $('providerFormName').value.trim();
  const base_url = $('providerFormBaseUrl').value.trim();
  const api_key = $('providerFormApiKey').value.trim();
  const model = $('providerFormModel').value.trim();
  if (!name || !base_url) {
    showToast('Name and Base URL are required');
    return;
  }
  try {
    await api('/api/models/provider', {
      method: 'POST',
      body: JSON.stringify({ name, base_url, api_key, model })
    });
    showToast('Provider added');
    closeAddProviderForm();
    loadModelsProviders();
  } catch(e) {
    showToast('Error: ' + e.message);
  }
}

// ── Channels/Proxy Tab ───────────────────────────────────────────────────────

const PROXY_PRESETS = {
  modal:    { base_url: 'https://api.us-west-2.modal.direct/v1', label: 'Modal' },
  openai:   { base_url: 'https://api.openai.com/v1', label: 'OpenAI' },
  openrouter: { base_url: 'https://openrouter.ai/api/v1', label: 'OpenRouter' },
  anthropic: { base_url: 'https://api.anthropic.com/v1', label: 'Anthropic' },
};

function applyProxyPreset(key) {
  const preset = PROXY_PRESETS[key];
  if (!preset) return;
  $('proxyBaseUrl').value = preset.base_url;
  $('proxyEnabled').checked = true;
  saveProxySettings();
  showToast(preset.label + ' preset applied');
}

let _proxySettingsCache = null;

async function loadProxySettings() {
  if (_proxySettingsCache) {
    $('proxyEnabled').checked = !!_proxySettingsCache.enabled;
    $('proxyBaseUrl').value = _proxySettingsCache.base_url || '';
    $('proxyApiKey').value = _proxySettingsCache.api_key || '';
    return;
  }
  try {
    const settings = await api('/api/settings');
    const proxy = settings.proxy || {};
    _proxySettingsCache = proxy;
    $('proxyEnabled').checked = !!proxy.enabled;
    $('proxyBaseUrl').value = proxy.base_url || '';
    $('proxyApiKey').value = proxy.api_key || '';
  } catch(e) {
    showToast('Error loading proxy settings: ' + e.message);
  }
}

async function saveProxySettings() {
  const enabled = $('proxyEnabled').checked;
  const base_url = $('proxyBaseUrl').value.trim();
  const api_key = $('proxyApiKey').value.trim();
  const proxy = { enabled, base_url, api_key };
  try {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ proxy })
    });
    _proxySettingsCache = proxy;
    showToast('Proxy settings saved');
  } catch(e) {
    showToast('Error saving proxy settings: ' + e.message);
  }
}

// ── Usage Tab ─────────────────────────────────────────────────────────────────

async function loadUsageStats() {
  function fmtTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }
  function fmtCost(n) {
    if (n === 0) return '$0.00';
    if (n < 0.01) return '<$0.01';
    return '$' + n.toFixed(2);
  }
  function fmtVal(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
  }
  try {
    const data = await api('/api/usage');
    const totalTokens = data.total_tokens || 0;
    const totalSessions = data.total_sessions || 0;
    const inputTokens = data.input_tokens || 0;
    const outputTokens = data.output_tokens || 0;
    const cacheTokens = data.cache_tokens || 0;
    const cacheRate = totalTokens > 0 ? ((cacheTokens / totalTokens) * 100).toFixed(1) : '0.0';
    const days = Object.keys(data.daily || {}).length || 1;
    const avgPerDay = totalSessions > 0 ? (totalSessions / days).toFixed(1) : '0';
    const estCost = inputTokens * 0.00001 + outputTokens * 0.00003;

    // 4 stat cards
    $('usageTotalTokens').textContent = fmtVal(totalTokens);
    $('usageTokenSub').textContent = inputTokens > 0 || outputTokens > 0
      ? fmtTokens(inputTokens) + ' in / ' + fmtTokens(outputTokens) + ' out'
      : '';
    $('usageTotalSessions').textContent = totalSessions.toLocaleString();
    $('usageSessionsSub').textContent = avgPerDay + ' / day';
    $('usageCost').textContent = estCost > 0 ? fmtCost(estCost) : '-';
    $('usageCacheRate').textContent = cacheRate + '%';
    $('usageCacheTokens').textContent = fmtVal(cacheTokens) + ' cache tokens';

    // Daily trend bars + table
    const dailyMap = data.daily || {};
    const today = new Date();
    const days30 = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days30.push({ date: key, tokens: dailyMap[key]?.tokens || 0, cache: dailyMap[key]?.cache || 0, sessions: dailyMap[key]?.sessions || 0, cost: dailyMap[key]?.cost || 0 });
    }
    const maxTokens = Math.max(...days30.map(d => d.tokens), 1);

    // Date range
    $('usageDateStart').textContent = days30[0] ? days30[0].date.slice(5) : '';
    $('usageDateEnd').textContent = days30[days30.length - 1] ? days30[days30.length - 1].date.slice(5) : '';

    // Bar chart with hover tooltips
    const barsHtml = days30.map(d => {
      const pct = (d.tokens / maxTokens * 100).toFixed(1);
      const isToday = d === days30[days30.length - 1];
      return `<div class="bar-col">
        <div class="bar-track">
          <div class="bar-fill" style="height:${pct}%;${isToday ? '' : 'opacity:0.55'}"></div>
        </div>
        <div class="bar-tooltip">
          <div class="tooltip-date">${d.date}</div>
          <div class="tooltip-row">Tokens: ${fmtTokens(d.tokens)}</div>
          <div class="tooltip-row">Sessions: ${d.sessions || '-'}</div>
          <div class="tooltip-row">Cost: ${fmtCost(d.cost)}</div>
        </div>
      </div>`;
    }).join('');
    $('usageDailyBars').innerHTML = barsHtml;

    // Trend table (reversed, newest first)
    const tableRows = [...days30].reverse().map(d => {
      return `<tr>
        <td>${d.date}</td>
        <td>${fmtTokens(d.tokens)}</td>
        <td>${fmtTokens(d.cache)}</td>
        <td>${d.sessions || '-'}</td>
        <td>${fmtCost(d.cost)}</td>
      </tr>`;
    }).join('');
    $('usageTrendTable').innerHTML = `<table>
      <thead><tr><th>Date</th><th>Tokens</th><th>Cache</th><th>Sessions</th><th>Cost</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;

    // By-model breakdown
    const byModel = data.by_model || [];
    if (byModel.length > 0) {
      const maxModel = Math.max(...byModel.map(m => m.total_tokens || 0));
      $('usageByModel').innerHTML = byModel
        .sort((a, b) => (b.total_tokens || 0) - (a.total_tokens || 0))
        .map(m => {
          const pct = maxModel > 0 ? ((m.total_tokens || 0) / maxModel * 100).toFixed(1) : 0;
          return `<div class="model-row">
            <span class="model-name" title="${esc(m.model)}">${esc(m.model)}</span>
            <div class="model-bar-wrap">
              <div class="model-bar" style="width:${pct}%"></div>
            </div>
            <span class="model-tokens">${fmtTokens(m.total_tokens || 0)}</span>
          </div>`;
        }).join('');
    } else {
      $('usageByModel').innerHTML = `<div style="color:var(--muted);font-size:11px">No data available.</div>`;
    }
  } catch(e) {
    $('usageTotalTokens').textContent = '—';
    $('usageTotalSessions').textContent = '—';
    $('usageCost').textContent = '—';
    $('usageCacheRate').textContent = '—';
    $('usageByModel').innerHTML = `<div style="color:var(--accent);font-size:11px">Error: ${esc(e.message)}</div>`;
  }
}

async function loadUsagePanel() {
  // Renders into the top-level Usage nav panel (up* IDs)
  const up = id => document.getElementById(id);
  function fmtTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }
  function fmtCost(n) {
    if (n === 0) return '$0.00';
    if (n < 0.01) return '<$0.01';
    return '$' + n.toFixed(2);
  }
  function fmtVal(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
  }
  try {
    const data = await api('/api/usage');
    const totalTokens = data.total_tokens || 0;
    const totalSessions = data.total_sessions || 0;
    const inputTokens = data.input_tokens || 0;
    const outputTokens = data.output_tokens || 0;
    const cacheTokens = data.cache_tokens || 0;
    const cacheRate = totalTokens > 0 ? ((cacheTokens / totalTokens) * 100).toFixed(1) : '0.0';
    const days = Object.keys(data.daily || {}).length || 1;
    const avgPerDay = totalSessions > 0 ? (totalSessions / days).toFixed(1) : '0';
    const estCost = inputTokens * 0.00001 + outputTokens * 0.00003;

    up('upTotalTokens').textContent = fmtVal(totalTokens);
    up('upTokenSub').textContent = inputTokens > 0 || outputTokens > 0
      ? fmtTokens(inputTokens) + ' in / ' + fmtTokens(outputTokens) + ' out' : '';
    up('upTotalSessions').textContent = totalSessions.toLocaleString();
    up('upSessionsSub').textContent = avgPerDay + ' / day';
    up('upCost').textContent = estCost > 0 ? fmtCost(estCost) : '-';
    up('upCacheRate').textContent = cacheRate + '%';
    up('upCacheTokens').textContent = fmtVal(cacheTokens) + ' cache tokens';

    const dailyMap = data.daily || {};
    const today = new Date();
    const days30 = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days30.push({ date: key,
        tokens: dailyMap[key]?.tokens || 0,
        cache: dailyMap[key]?.cache || 0,
        sessions: dailyMap[key]?.sessions || 0,
        cost: dailyMap[key]?.cost || 0 });
    }
    const maxTokens = Math.max(...days30.map(d => d.tokens), 1);

    up('upDateStart').textContent = days30[0] ? days30[0].date.slice(5) : '';
    up('upDateEnd').textContent = days30[days30.length - 1] ? days30[days30.length - 1].date.slice(5) : '';

    const barsHtml = days30.map(d => {
      const pct = (d.tokens / maxTokens * 100).toFixed(1);
      const isToday = d === days30[days30.length - 1];
      return `<div class="bar-col">
        <div class="bar-track">
          <div class="bar-fill" style="height:${pct}%;${isToday ? '' : 'opacity:0.55'}"></div>
        </div>
        <div class="bar-tooltip">
          <div class="tooltip-date">${d.date}</div>
          <div class="tooltip-row">Tokens: ${fmtTokens(d.tokens)}</div>
          <div class="tooltip-row">Sessions: ${d.sessions || '-'}</div>
          <div class="tooltip-row">Cost: ${fmtCost(d.cost)}</div>
        </div>
      </div>`;
    }).join('');
    up('upDailyBars').innerHTML = barsHtml;

    const tableRows = [...days30].reverse().map(d => {
      return `<tr><td>${d.date}</td><td>${fmtTokens(d.tokens)}</td><td>${fmtTokens(d.cache)}</td><td>${d.sessions || '-'}</td><td>${fmtCost(d.cost)}</td></tr>`;
    }).join('');
    up('upTrendTable').innerHTML = `<table>
      <thead><tr><th>Date</th><th>Tokens</th><th>Cache</th><th>Sessions</th><th>Cost</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;

    const byModel = data.by_model || [];
    if (byModel.length > 0) {
      const maxModel = Math.max(...byModel.map(m => m.total_tokens || 0));
      up('upByModel').innerHTML = byModel
        .sort((a, b) => (b.total_tokens || 0) - (a.total_tokens || 0))
        .map(m => {
          const pct = maxModel > 0 ? ((m.total_tokens || 0) / maxModel * 100).toFixed(1) : 0;
          return `<div class="model-row">
            <span class="model-name" title="${esc(m.model)}">${esc(m.model)}</span>
            <div class="model-bar-wrap">
              <div class="model-bar" style="width:${pct}%"></div>
            </div>
            <span class="model-tokens">${fmtTokens(m.total_tokens || 0)}</span>
          </div>`;
        }).join('');
    } else {
      up('upByModel').innerHTML = `<div style="color:var(--muted);font-size:11px">No data available.</div>`;
    }
  } catch(e) {
    up('upTotalTokens').textContent = '—';
    up('upTotalSessions').textContent = '—';
    up('upCost').textContent = '—';
    up('upCacheRate').textContent = '—';
    up('upByModel').innerHTML = `<div style="color:var(--accent);font-size:11px">Error: ${esc(e.message)}</div>`;
  }
}

// ── Channels Tab ─────────────────────────────────────────────────────────────────
// EKKOLearnAI-style: credentials → .env via PUT /api/hermes/config/credentials
//                    behavior config → config.yaml via PUT /api/hermes/config
// ─────────────────────────────────────────────────────────────────────────────────

// Per-field save with loading indicators.
// ─────────────────────────────────────────────────────────────────────────────────

// Env-var → platform.key mapping (matches hermes _apply_env_overrides)
const CREDENTIAL_FIELDS = {
  telegram:    { bot_token: 'TELEGRAM_BOT_TOKEN' },
  discord:     { bot_token: 'DISCORD_BOT_TOKEN' },
  slack:       { bot_token: 'SLACK_BOT_TOKEN', app_token: 'SLACK_APP_TOKEN' },
  whatsapp:    { enabled: 'WHATSAPP_ENABLED' },
  matrix:      { access_token: 'MATRIX_ACCESS_TOKEN', homeserver: 'MATRIX_HOMESERVER' },
  feishu:      { app_id: 'FEISHU_APP_ID', app_secret: 'FEISHU_APP_SECRET' },
  dingtalk:    { client_id: 'DINGTALK_CLIENT_ID', client_secret: 'DINGTALK_CLIENT_SECRET' },
  weixin:      { token: 'WEIXIN_TOKEN' },
  wecom:       { bot_id: 'WECOM_BOT_ID', bot_secret: 'WECOM_SECRET' },
};

// Platforms that support QR-code login
const QR_PLATFORMS = ['weixin'];

// Per-platform icon SVGs
const PLATFORM_ICONS = {
  telegram: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>',
  discord: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"/></svg>',
  slack: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 0a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V5.042zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1 2.523-2.52h6.313A2.528 2.528 0 0 1 24 18.956a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>',
  matrix: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M.632.55v22.9H2.28V24H0V0h2.28v.55zm7.043 7.26v1.157h.033c.309-.443.683-.784 1.117-1.024.433-.245.936-.365 1.5-.365.54 0 1.033.107 1.48.324.448.217.786.619 1.017 1.205.24-.376.558-.702.956-.98.398-.277.872-.414 1.424-.414.41 0 .784.065 1.122.194.34.13.629.325.87.588.241.263.428.59.56.984.132.393.198.85.198 1.368v5.89h-2.49v-4.893c0-.268-.016-.525-.048-.77a1.627 1.627 0 00-.2-.63 1.028 1.028 0 00-.392-.426 1.294 1.294 0 00-.616-.134c-.277 0-.508.05-.693.15a1.043 1.043 0 00-.43.41 1.768 1.768 0 00-.214.616 4.15 4.15 0 00-.06.74v4.937H9.29v-4.937c0-.25-.01-.498-.032-.742a1.84 1.84 0 00-.166-.638.998.998 0 00-.363-.448 1.206 1.206 0 00-.624-.154c-.26 0-.483.048-.67.144a1.055 1.055 0 00-.436.402 1.744 1.744 0 00-.227.616 4.108 4.108 0 00-.063.74v4.937H5.21V7.81zm15.693 15.64V.55H21.72V0H24v24h-2.28v-.55z"/></svg>',
  feishu: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.59 3.41a2.25 2.25 0 0 1 3.182 0L13.5 7.14l-3.182 3.182L6.59 7.59a2.25 2.25 0 0 1 0-3.182zm5.303 5.303L15.075 5.53a2.25 2.25 0 0 1 3.182 3.182L15.075 11.894 11.893 8.713zM3.41 6.59a2.25 2.25 0 0 1 3.182 0l3.182 3.182-3.182 3.182a2.25 2.25 0 0 1-3.182-3.182L3.41 6.59zm5.303 5.303L11.894 15.075a2.25 2.25 0 0 1-3.182 3.182L5.53 15.075 8.713 11.893zm5.303-5.303L17.478 9.778a2.25 2.25 0 0 1-3.182 3.182L10.53 10.075l3.182-3.182 0 .023z"/></svg>',
  dingtalk: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 14.573c-.012.39-.104.733-.276 1.03a2.548 2.548 0 0 1-.876.99 2.537 2.537 0 0 1-1.306.37 2.527 2.527 0 0 1-1.83-.753 2.567 2.567 0 0 1-.753-1.83c0-.39.103-.733.276-1.03.172-.297.4-.536.676-.717a2.54 2.54 0 0 1 1.306-.37c.34 0 .663.075.969.223.307.149.56.35.76.603.2.254.333.539.4.854h.004a2.59 2.59 0 0 1-.004.627zm-2.11-4.06a1.48 1.48 0 0 1-.428-.054 1.555 1.555 0 0 1-.388-.155 1.74 1.74 0 0 1-.328-.25 1.73 1.73 0 0 1-.25-.328 1.565 1.565 0 0 1-.155-.388 1.486 1.486 0 0 1-.054-.428c0-.157.018-.31.054-.457a1.56 1.56 0 0 1 .155-.389c.07-.12.157-.224.261-.313s.208-.155.328-.204.252-.07.388-.07c.157 0 .31.023.457.07a1.56 1.56 0 0 1 .777.517c.1.109.18.23.242.362a1.57 1.57 0 0 1 .156.89 1.54 1.54 0 0 1-.54.98 1.55 1.55 0 0 1-.49.267 1.54 1.54 0 0 1-.575.05zM15.3 9.5a1.48 1.48 0 0 1-.428-.054 1.555 1.555 0 0 1-.388-.155 1.74 1.74 0 0 1-.328-.25 1.73 1.73 0 0 1-.25-.328 1.565 1.565 0 0 1-.155-.388 1.486 1.486 0 0 1-.054-.428c0-.157.018-.31.054-.457a1.56 1.56 0 0 1 .155-.389c.07-.12.157-.224.261-.313s.208-.155.328-.204.252-.07.388-.07c.157 0 .31.023.457.07a1.56 1.56 0 0 1 .777.517c.1.109.18.23.242.362a1.57 1.57 0 0 1 .156.89 1.54 1.54 0 0 1-.54.98 1.55 1.55 0 0 1-.49.267 1.54 1.54 0 0 1-.575.05z"/></svg>',
  weixin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm3.68 4.025c-3.694 0-6.69 2.462-6.69 5.496 0 3.034 2.996 5.496 6.69 5.496.753 0 1.477-.1 2.158-.28a.66.66 0 0 1 .548.074l1.46.854a.25.25 0 0 0 .127.041.224.224 0 0 0 .221-.225c0-.055-.022-.109-.037-.162l-.298-1.131a.453.453 0 0 1 .163-.509C21.81 18.613 22.77 16.973 22.77 15.512c0-3.034-2.996-5.496-6.69-5.496h.198zm-2.454 3.347c.491 0 .889.404.889.902a.896.896 0 0 1-.889.903.896.896 0 0 1-.889-.903c0-.498.398-.902.889-.902zm4.912 0c.491 0 .889.404.889.902a.896.896 0 0 1-.889.903.896.896 0 0 1-.889-.903c0-.498.398-.902.889-.902z"/></svg>',
  wecom: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 14.573c-.012.39-.104.733-.276 1.03a2.548 2.548 0 0 1-.876.99 2.537 2.537 0 0 1-1.306.37 2.527 2.527 0 0 1-1.83-.753 2.567 2.567 0 0 1-.753-1.83c0-.39.103-.733.276-1.03.172-.297.4-.536.676-.717a2.54 2.54 0 0 1 1.306-.37c.34 0 .663.075.969.223.307.149.56.35.76.603.2.254.333.539.4.854h.004a2.59 2.59 0 0 1-.004.627zm-2.11-4.06a1.48 1.48 0 0 1-.428-.054 1.555 1.555 0 0 1-.388-.155 1.74 1.74 0 0 1-.328-.25 1.73 1.73 0 0 1-.25-.328 1.565 1.565 0 0 1-.155-.388 1.486 1.486 0 0 1-.054-.428c0-.157.018-.31.054-.457a1.56 1.56 0 0 1 .155-.389c.07-.12.157-.224.261-.313s.208-.155.328-.204.252-.07.388-.07c.157 0 .31.023.457.07a1.56 1.56 0 0 1 .777.517c.1.109.18.23.242.362a1.57 1.57 0 0 1 .156.89 1.54 1.54 0 0 1-.54.98 1.55 1.55 0 0 1-.49.267 1.54 1.54 0 0 1-.575.05zM15.3 9.5a1.48 1.48 0 0 1-.428-.054 1.555 1.555 0 0 1-.388-.155 1.74 1.74 0 0 1-.328-.25 1.73 1.73 0 0 1-.25-.328 1.565 1.565 0 0 1-.155-.388 1.486 1.486 0 0 1-.054-.428c0-.157.018-.31.054-.457a1.56 1.56 0 0 1 .155-.389c.07-.12.157-.224.261-.313s.208-.155.328-.204.252-.07.388-.07c.157 0 .31.023.457.07a1.56 1.56 0 0 1 .777.517c.1.109.18.23.242.362a1.57 1.57 0 0 1 .156.89 1.54 1.54 0 0 1-.54.98 1.55 1.55 0 0 1-.49.267 1.54 1.54 0 0 1-.575.05z"/></svg>',
};

// Per-platform config fields (stored in config.yaml, section = platform key)
const CONFIG_FIELDS = {
  telegram: [
    { key: 'require_mention',     label: "Require @Mention",        type: 'switch', hint: "Only respond when bot is mentioned" },
    { key: 'reactions',           label: "Reactions",               type: 'switch', hint: "React to messages with emoji" },
    { key: 'free_response_chats',  label: "Free Response Chats",    type: 'text',   hint: "Chat IDs that respond without @mention (comma-separated)" },
    { key: 'mention_patterns',     label: "Custom Mention Patterns", type: 'text',   hint: "Additional trigger patterns (comma-separated)" },
  ],
  discord: [
    { key: 'require_mention',         label: "Require @Mention",          type: 'switch', hint: "Only respond when bot is mentioned" },
    { key: 'reactions',               label: "Reactions",                   type: 'switch', hint: "React to messages with emoji" },
    { key: 'auto_thread',             label: "Auto Thread",                 type: 'switch', hint: "Auto-create reply threads after @mention" },
    { key: 'free_response_channels',   label: "Free Response Channels",      type: 'text',   hint: "Channel IDs that respond without @mention (comma-separated)" },
    { key: 'allowed_channels',        label: "Allowed Channels",           type: 'text',   hint: "Whitelist channel IDs (comma-separated)" },
    { key: 'ignored_channels',        label: "Ignored Channels",            type: 'text',   hint: "Channels where bot never responds (comma-separated)" },
    { key: 'no_thread_channels',     label: "No-Thread Channels",         type: 'text',   hint: "Channels where bot responds without threads (comma-separated)" },
  ],
  slack: [
    { key: 'require_mention',        label: "Require @Mention",         type: 'switch', hint: "Only respond when bot is mentioned" },
    { key: 'allow_bots',             label: "Allow Bot Messages",       type: 'switch', hint: "Respond to messages from other bots" },
    { key: 'free_response_channels', label: "Free Response Channels",   type: 'text',   hint: "Channel IDs that respond without @mention (comma-separated)" },
  ],
  whatsapp: [
    { key: 'require_mention',      label: "Require @Mention",        type: 'switch', hint: "Only respond when bot is mentioned" },
    { key: 'free_response_chats', label: "Free Response Chats",    type: 'text',   hint: "Chat IDs that respond without @mention (comma-separated)" },
    { key: 'mention_patterns',     label: "Custom Mention Patterns", type: 'text',   hint: "Additional trigger patterns (comma-separated)" },
  ],
  matrix: [
    { key: 'require_mention',      label: "Require @Mention",       type: 'switch', hint: "Only respond when bot is mentioned" },
    { key: 'auto_thread',          label: "Auto Thread",            type: 'switch', hint: "Auto-create reply threads" },
    { key: 'dm_mention_threads',   label: "DM Mention Threads",    type: 'switch', hint: "Use thread replies for mentions in DMs" },
    { key: 'free_response_rooms',  label: "Free Response Rooms",   type: 'text',   hint: "Room IDs that respond without @mention (comma-separated)" },
  ],
  feishu: [
    { key: 'require_mention',      label: "Require @Mention",       type: 'switch', hint: "Only respond when bot is mentioned" },
    { key: 'free_response_chats',  label: "Free Response Chats",   type: 'text',   hint: "Chat IDs that respond without @mention (comma-separated)" },
  ],
  dingtalk: [
    // Behavior config fields stored in config.yaml — add here when backend is ready
    // { key: 'require_mention', label: "Require @Mention", type: 'switch', hint: "Only respond when bot is mentioned" },
  ],
  weixin: [
    // No config fields for weixin — QR login is the only thing
  ],
  wecom: [
    // WeCom only has credentials, no extra config fields
  ],
};

const PLATFORM_META = {
  telegram:  { color: '#0088cc', label: 'Telegram',   note: null },
  discord:   { color: '#5865f2', label: 'Discord',    note: null },
  slack:     { color: '#4a154b', label: 'Slack',      note: null },
  whatsapp:  { color: '#25d366', label: 'WhatsApp',   note: 'WhatsApp uses QR code pairing. Run <code>hermes whatsapp</code> in terminal to pair.' },
  matrix:    { color: '#0dbd8b', label: 'Matrix',     note: null },
  feishu:    { color: '#1677ff', label: 'Feishu / Lark', note: null },
  dingtalk:  { color: '#1476ff', label: 'DingTalk',   note: null },
  weixin:    { color: '#07c160', label: 'Weixin',     note: null },
  wecom:     { color: '#07c160', label: 'WeCom',      note: null },
};

// ── State ─────────────────────────────────────────────────────────────────────────
let _channelCreds   = {};   // { platform: { credential values } }
let _channelConfig  = {};   // { platform: { config values } }
let _chSaving       = {};   // { `${platform}.${field}`: bool }
let _wechatQrTimer  = null;

// ── Per-field save ───────────────────────────────────────────────────────────────
// credential → PUT /api/hermes/config/credentials
// config     → PUT /api/hermes/config

async function saveCred(platform, field, value) {
  const key = `${platform}.${field}`;
  _chSaving[key] = true;
  renderChannelSaving(platform, field, true);
  try {
    await api('/api/hermes/config/credentials', {
      method: 'PUT',
      body: JSON.stringify({ platform, values: { [field]: value } }),
    });
    _channelCreds[platform] = _channelCreds[platform] || {};
    _channelCreds[platform][field] = value;
  } catch(e) {
    showToast(`Save failed: ${e.message}`);
  } finally {
    _chSaving[key] = false;
    renderChannelSaving(platform, field, false);
  }
}

async function saveConfig(platform, field, value) {
  const key = `${platform}.${field}`;
  _chSaving[key] = true;
  renderChannelSaving(platform, field, true);
  try {
    await api('/api/hermes/config', {
      method: 'PUT',
      body: JSON.stringify({ section: platform, values: { [field]: value } }),
    });
    _channelConfig[platform] = _channelConfig[platform] || {};
    _channelConfig[platform][field] = value;
  } catch(e) {
    showToast(`Save failed: ${e.message}`);
  } finally {
    _chSaving[key] = false;
    renderChannelSaving(platform, field, false);
  }
}

function renderChannelSaving(platform, field, saving) {
  const el = document.getElementById(`saving-${platform}-${field}`);
  if (!el) return;
  el.style.display = saving ? 'inline-block' : 'none';
}

function isCredField(platform, fieldKey) {
  return !!(CREDENTIAL_FIELDS[platform] || {})[fieldKey];
}

// ── Load ─────────────────────────────────────────────────────────────────────────
async function loadChannels() {
  const container = document.getElementById('channelsConfigContent');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:30px">Loading...</div>';
  try {
    const [credsResp, configResp] = await Promise.all([
      api('/api/hermes/config/credentials'),
      api('/api/hermes/config?section=telegram,discord,slack,whatsapp,matrix,feishu,dingtalk,weixin,wecom'),
    ]);
    _channelCreds  = credsResp.credentials || {};
    _channelConfig = {};
    for (const [platform, data] of Object.entries(configResp)) {
      if (data && typeof data === 'object') {
        _channelConfig[platform] = data;
      }
    }
    renderChannelsUI();
  } catch(e) {
    container.innerHTML = `<div style="color:var(--accent);font-size:12px;padding:20px">Error: ${esc(e.message)}</div>`;
  }
}

// ── Render ──────────────────────────────────────────────────────────────────────
function renderChannelsUI() {
  const container = document.getElementById('channelsConfigContent');
  if (!container) return;

  const platforms = ['telegram','discord','slack','whatsapp','matrix','feishu','dingtalk','weixin','wecom'];
  container.innerHTML = platforms.map(pid => renderPlatformCard(pid)).join('');
}

function renderPlatformCard(platformId) {
  const meta   = PLATFORM_META[platformId];
  const creds  = _channelCreds[platformId]  || {};
  const config  = _channelConfig[platformId] || {};
  const icon    = PLATFORM_ICONS[platformId] || '';
  const isConfigured = isPlatformConfigured(platformId, creds);

  let cardStyle = `margin-bottom:12px;border:1px solid var(--border2);border-radius:10px;overflow:hidden;${isConfigured ? `border-color:${meta.color}40` : ''}`;

  let bodyHtml = '';

  // ── Credential fields ──
  const credFields = CREDENTIAL_FIELDS[platformId] || {};
  for (const [fieldKey, envVar] of Object.entries(credFields)) {
    bodyHtml += renderCredField(platformId, fieldKey, creds[fieldKey]);
  }

  // ── Config fields ──
  const cfgFields = CONFIG_FIELDS[platformId] || [];
  for (const f of cfgFields) {
    bodyHtml += renderConfigField(platformId, f, config[f.key]);
  }

  // ── Platform-specific extras ──
  if (platformId === 'weixin') {
    bodyHtml += renderWeixinQrSection(creds);
  }

  // ── Note ──
  if (meta.note) {
    bodyHtml += `<div style="font-size:11px;color:var(--muted);margin-top:10px;padding:8px;background:var(--code-bg);border-radius:6px;line-height:1.5">${meta.note}</div>`;
  }

  return `
  <div class="channel-platform-card" style="${cardStyle}">
    <div class="ch-card-header" data-platform="${platformId}">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="ch-icon" style="color:${meta.color}">${icon}</span>
        <span style="font-size:14px;font-weight:600;color:${meta.color}">${meta.label}</span>
        <span class="ch-status-badge" style="font-size:10px;padding:2px 8px;border-radius:10px;background:${isConfigured ? meta.color+'28' : 'rgba(128,128,128,.15)'};color:${isConfigured ? meta.color : 'var(--muted)'};font-weight:500">
          ${isConfigured ? 'Configured' : 'Not configured'}
        </span>
      </div>
    </div>
    <div class="ch-card-body" style="padding:0 16px 14px;border-top:1px solid var(--border-light)">
      ${bodyHtml}
    </div>
  </div>`;
}

function renderCredField(platform, fieldKey, currentValue) {
  const savingId = `saving-${platform}-${fieldKey}`;
  const inputId  = `cred-${platform}-${fieldKey}`;
  const isBool = fieldKey === 'enabled';

  if (isBool) {
    return `
    <div class="setting-row" style="padding:10px 0;border-bottom:1px solid var(--border-light)">
      <div class="setting-info">
        <label class="setting-label">${fieldKey === 'enabled' ? 'Enable WhatsApp' : fieldKey}</label>
      </div>
      <div class="setting-control" style="display:flex;align-items:center;gap:8px">
        <span id="${savingId}" style="display:none;color:var(--accent);font-size:11px">Saving...</span>
        <label class="toggle-switch">
          <input type="checkbox" id="${inputId}" ${currentValue ? 'checked' : ''}
            onchange="saveCred('${platform}','${fieldKey}',this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>`;
  }

  // Password / text input for credential
  const inputType = fieldKey.includes('token') || fieldKey.includes('secret') || fieldKey.includes('password') ? 'password' : 'text';
  return `
  <div class="setting-row" style="padding:10px 0;border-bottom:1px solid var(--border-light)">
    <div class="setting-info">
      <label class="setting-label" for="${inputId}">${credFieldLabel(fieldKey)}</label>
    </div>
    <div class="setting-control" style="display:flex;align-items:center;gap:8px;flex-shrink:0">
      <input type="${inputType}" id="${inputId}" value="${esc(String(currentValue||''))}"
        placeholder="${credFieldPlaceholder(fieldKey)}"
        style="padding:6px 10px;background:var(--code-bg);color:var(--text);border:1px solid var(--border2);border-radius:6px;font-size:12px;width:220px"
        onchange="saveCred('${platform}','${fieldKey}',this.value)">
      <span id="${savingId}" style="display:none;color:var(--accent);font-size:11px">Saving...</span>
    </div>
  </div>`;
}

function renderConfigField(platform, fieldDef, currentValue) {
  const savingId = `saving-${platform}-${fieldDef.key}`;
  const inputId  = `cfg-${platform}-${fieldDef.key}`;

  if (fieldDef.type === 'switch') {
    return `
    <div class="setting-row" style="padding:10px 0;border-bottom:1px solid var(--border-light)">
      <div class="setting-info">
        <label class="setting-label">${fieldDef.label}</label>
        ${fieldDef.hint ? `<p class="setting-hint">${esc(fieldDef.hint)}</p>` : ''}
      </div>
      <div class="setting-control" style="display:flex;align-items:center;gap:8px">
        <span id="${savingId}" style="display:none;color:var(--accent);font-size:11px">Saving...</span>
        <label class="toggle-switch">
          <input type="checkbox" id="${inputId}" ${currentValue ? 'checked' : ''}
            onchange="saveConfig('${platform}','${fieldDef.key}',this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>`;
  }

  // Text input
  const displayValue = Array.isArray(currentValue) ? currentValue.join(', ') : (currentValue || '');
  return `
  <div class="setting-row" style="padding:10px 0;border-bottom:1px solid var(--border-light)">
    <div class="setting-info">
      <label class="setting-label" for="${inputId}">${fieldDef.label}</label>
      ${fieldDef.hint ? `<p class="setting-hint">${esc(fieldDef.hint)}</p>` : ''}
    </div>
    <div class="setting-control" style="display:flex;align-items:center;gap:8px;flex-shrink:0">
      <input type="text" id="${inputId}" value="${esc(String(displayValue))}"
        placeholder="${esc(fieldDef.hint || '')}"
        style="padding:6px 10px;background:var(--code-bg);color:var(--text);border:1px solid var(--border2);border-radius:6px;font-size:12px;width:220px"
        onchange="saveConfig('${platform}','${fieldDef.key}',this.value)">
      <span id="${savingId}" style="display:none;color:var(--accent);font-size:11px">Saving...</span>
    </div>
  </div>`;
}

function credFieldLabel(key) {
  const labels = {
    bot_token:'Bot Token', app_token:'App Token', access_token:'Access Token',
    homeserver:'Homeserver', app_id:'App ID', app_secret:'App Secret',
    client_id:'Client ID', client_secret:'Client Secret',
    bot_id:'Bot ID', bot_secret:'Bot Secret', token:'Token',
  };
  return labels[key] || key;
}

function credFieldPlaceholder(key) {
  const placeholders = {
    bot_token:'123456:ABC-DEF...', app_token:'xapp-...', access_token:'syt_...',
    homeserver:'https://matrix.org', app_id:'cli_...', app_secret:'App Secret',
    client_id:'Client ID', client_secret:'Client Secret',
    bot_id:'ww...', bot_secret:'Bot Secret', token:'Token',
  };
  return placeholders[key] || '';
}

function isPlatformConfigured(platformId, creds) {
  const keys = CREDENTIAL_FIELDS[platformId] || {};
  for (const k of Object.keys(keys)) {
    if (k === 'enabled') { if (creds[k]) return true; }
    else { if (creds[k]) return true; }
  }
  return false;
}

// ── WeChat QR ───────────────────────────────────────────────────────────────────
function renderWeixinQrSection(creds) {
  const isConnected = !!(creds.account_id || creds.token);
  if (isConnected) {
    return `
    <div style="margin-top:12px;padding:10px;background:var(--code-bg);border-radius:6px">
      <div style="color:#07c160;font-weight:600;font-size:13px">✓ Connected</div>
      <div style="color:var(--muted);font-size:12px;margin-top:4px">Account ID: ${esc(creds.account_id || 'N/A')}</div>
    </div>`;
  }
  return `
  <div style="margin-top:12px">
    <button id="wechat-qr-btn" onclick="startWeixinQrLogin()" style="padding:8px 16px;background:#07c160;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500">
      QR Login
    </button>
    <div id="wechat-qr-status" style="margin-top:8px;font-size:12px;color:var(--muted)"></div>
    <div id="wechat-qr-container" style="margin-top:10px;text-align:center;display:none">
      <img id="wechat-qr-img" style="width:200px;height:200px;border:1px solid var(--border2);border-radius:8px" alt="QR Code">
      <div style="font-size:11px;color:var(--muted);margin-top:6px">Scan with WeChat to connect</div>
    </div>
  </div>`;
}

async function startWeixinQrLogin() {
  const btn    = document.getElementById('wechat-qr-btn');
  const status = document.getElementById('wechat-qr-status');
  const img    = document.getElementById('wechat-qr-img');
  const container = document.getElementById('wechat-qr-container');
  if (!btn || !status) return;

  btn.disabled = true;
  btn.textContent = 'Fetching...';
  status.textContent = 'Fetching QR code...';
  try {
    const data = await api('/api/hermes/weixin/qrcode');
    if (data.error) { status.textContent = 'Error: ' + data.error; btn.disabled=false; btn.textContent='QR Login'; return; }
    // Open QR URL in new tab AND show inline
    window.open(data.qrcode_url, '_blank');
    img.src = data.qrcode_url;
    container.style.display = 'block';
    status.textContent = 'Waiting for scan...';
    btn.textContent = 'Scanning...';
    // Start polling
    if (_wechatQrTimer) clearInterval(_wechatQrTimer);
    _wechatQrTimer = setInterval(() => pollWeixinStatus(), 3000);
  } catch(e) {
    status.textContent = 'Error: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'QR Login';
  }
}

async function pollWeixinStatus() {
  try {
    const data = await api('/api/hermes/weixin/qrcode/status');
    const status = document.getElementById('wechat-qr-status');
    const btn    = document.getElementById('wechat-qr-btn');
    const img    = document.getElementById('wechat-qr-img');
    const container = document.getElementById('wechat-qr-container');
    if (!data || !data.status) return;
    // Status values: idle | scanning | scaned | confirmed | expired | error
    if (data.status === 'idle') {
      // Nothing happening
    } else if (data.status === 'scanning') {
      if (status) status.textContent = 'Waiting for scan...';
    } else if (data.status === 'scaned') {
      if (status) { status.textContent = '✓ Scanned! Please confirm in WeChat...'; status.style.color = '#07c160'; }
    } else if (data.status === 'confirmed') {
      if (_wechatQrTimer) { clearInterval(_wechatQrTimer); _wechatQrTimer = null; }
      if (status) status.textContent = '✓ Connected!';
      if (btn) { btn.textContent = 'Connected ✓'; btn.disabled = true; }
      if (container) container.style.display = 'none';
      // Reload settings to reflect connection
      const credsResp = await api('/api/hermes/config/credentials');
      _channelCreds = credsResp.credentials || {};
      renderChannelsUI();
      showToast('WeChat connected successfully');
    } else if (data.status === 'expired') {
      if (_wechatQrTimer) { clearInterval(_wechatQrTimer); _wechatQrTimer = null; }
      if (status) status.textContent = 'QR expired. Click Retry to get a new one.';
      if (btn) { btn.textContent = 'Retry'; btn.disabled = false; }
      if (img) img.src = '';
    } else if (data.status === 'error') {
      if (_wechatQrTimer) { clearInterval(_wechatQrTimer); _wechatQrTimer = null; }
      if (status) status.textContent = 'Error: ' + (data.error || 'Unknown');
      if (btn) { btn.textContent = 'Retry'; btn.disabled = false; }
    }
  } catch(e) {
    // Silently continue polling
  }
}

// Event wiring


// Event wiring
