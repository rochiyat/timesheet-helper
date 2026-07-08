const els = {
  connectStatus: document.getElementById('connect-status'),
  btnCheckConnection: document.getElementById('btn-check-connection'),
  stepTaskList: document.getElementById('step-tasklist'),
  taskListTable: document.getElementById('task-list-table'),
  stepUpload: document.getElementById('step-upload'),
  fileInput: document.getElementById('file-input'),
  stepPreview: document.getElementById('step-preview'),
  previewSummary: document.getElementById('preview-summary'),
  previewTableBody: document.querySelector('#preview-table tbody'),
  btnSubmit: document.getElementById('btn-submit'),
  btnStop: document.getElementById('btn-stop'),
  stepProgress: document.getElementById('step-progress'),
  progressBar: document.getElementById('progress-bar'),
  progressText: document.getElementById('progress-text'),
  progressLog: document.getElementById('progress-log'),
};

let activeTabId = null;
let taskList = []; // [{id, name, project_id, project_name}]
let parsedEntries = []; // hasil parsing + validasi, siap ditampilkan & disubmit

const REQUIRED_HEADERS = ['Date', 'Clock In', 'Clock Out', 'Task Code', 'Work Detail'];

async function getActiveTalentaTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.startsWith('https://hr.talenta.co')) {
    throw new Error('Buka tab Talenta (hr.talenta.co) dulu, lalu coba lagi.');
  }
  return tab;
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

// ---------- Step 1: Cek koneksi & ambil task list ----------

els.btnCheckConnection.addEventListener('click', async () => {
  els.connectStatus.textContent = 'Menghubungkan...';
  els.connectStatus.className = 'status status-pending';

  try {
    const tab = await getActiveTalentaTab();
    activeTabId = tab.id;

    const res = await sendMessageToTab(activeTabId, { type: 'GET_TASK_LIST' });
    if (!res || !res.ok) {
      throw new Error((res && res.error) || 'Gagal mengambil daftar task.');
    }

    taskList = res.data;
    els.connectStatus.textContent = `Terhubung. ${taskList.length} task ditemukan.`;
    els.connectStatus.className = 'status status-ok';

    renderTaskList();
    els.stepTaskList.classList.remove('hidden');
    els.stepUpload.classList.remove('hidden');
  } catch (err) {
    els.connectStatus.textContent = `Gagal: ${err.message}`;
    els.connectStatus.className = 'status status-error';
  }
});

function extractTaskCode(fullName) {
  // Format nama task: "E2022DA009 - AIDO HIS - EMR" -> code = "E2022DA009"
  const parts = fullName.split(' - ');
  return parts[0].trim();
}

function renderTaskList() {
  els.taskListTable.innerHTML = '';
  taskList.forEach((task) => {
    const code = extractTaskCode(task.name);
    const row = document.createElement('div');
    row.className = 'task-row';
    row.innerHTML = `<span class="code">${code}</span><span class="name">${task.name}</span>`;
    els.taskListTable.appendChild(row);
  });
}

function findTaskByCode(code) {
  if (!code) return null;
  const normalized = String(code).trim().toLowerCase();
  return taskList.find((t) => extractTaskCode(t.name).toLowerCase() === normalized) || null;
}

// ---------- Step 2: Upload & parse Excel ----------

els.fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) {
      throw new Error('File Excel kosong atau format tidak terbaca.');
    }

    const headers = Object.keys(rows[0]);
    const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
    if (missing.length > 0) {
      throw new Error(`Kolom wajib tidak ditemukan: ${missing.join(', ')}`);
    }

    parsedEntries = rows.map((row, idx) => validateRow(row, idx));
    renderPreview();
    els.stepPreview.classList.remove('hidden');
  } catch (err) {
    alert(`Gagal membaca file: ${err.message}`);
  }
});

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseDateCell(value) {
  let d = null;
  if (typeof value === 'string' && value.trim() !== '') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    d = new Date(trimmed);
  } else if (value instanceof Date) {
    d = value;
  }
  if (!d || isNaN(d.getTime())) return null;

  // Tambahkan 12 jam untuk mengompensasi pergeseran zona waktu (timezone drift/Batavia time offset sejak 1900)
  const adjusted = new Date(d.getTime() + 12 * 60 * 60 * 1000);
  return `${adjusted.getFullYear()}-${pad2(adjusted.getMonth() + 1)}-${pad2(adjusted.getDate())}`;
}

function parseTimeCell(value) {
  // Bisa berupa Date object (dari cell time Excel) atau string "8:00" / "08:00"
  if (value instanceof Date) {
    return { h: value.getHours(), m: value.getMinutes() };
  }
  if (typeof value === 'string' && value.includes(':')) {
    const [h, m] = value.split(':').map((x) => parseInt(x, 10));
    if (!isNaN(h) && !isNaN(m)) return { h, m };
  }
  if (typeof value === 'number') {
    // Excel time serial: fraksi hari (0.5 = 12:00)
    const totalMinutes = Math.round(value * 24 * 60);
    return { h: Math.floor(totalMinutes / 60), m: totalMinutes % 60 };
  }
  return null;
}

function validateRow(row, idx) {
  const errors = [];
  const warnings = [];

  const dateStr = parseDateCell(row['Date']);
  if (!dateStr) errors.push('Tanggal tidak valid');

  const clockIn = parseTimeCell(row['Clock In']);
  if (!clockIn) errors.push('Clock In tidak valid');

  const clockOut = parseTimeCell(row['Clock Out']);
  if (!clockOut) errors.push('Clock Out tidak valid');

  const taskCode = String(row['Task Code'] || '').trim();
  const task = findTaskByCode(taskCode);
  if (!taskCode) errors.push('Task Code kosong');
  else if (!task) errors.push(`Task Code "${taskCode}" tidak ditemukan di daftar task`);

  const workDetail = String(row['Work Detail'] || '').trim();
  if (!workDetail) errors.push('Work Detail kosong');

  let start_time = null;
  let end_time = null;
  let durationHours = null;

  if (dateStr && clockIn && clockOut) {
    start_time = `${dateStr} ${pad2(clockIn.h)}:${pad2(clockIn.m)}:00`;
    end_time = `${dateStr} ${pad2(clockOut.h)}:${pad2(clockOut.m)}:00`;

    const startMinutes = clockIn.h * 60 + clockIn.m;
    const endMinutes = clockOut.h * 60 + clockOut.m;
    durationHours = (endMinutes - startMinutes) / 60;

    if (durationHours <= 0) errors.push('Clock Out harus setelah Clock In');
    else if (durationHours > 12) warnings.push(`Durasi ${durationHours} jam, cek lagi`);
  }

  return {
    idx,
    raw: row,
    dateStr,
    taskCode,
    task,
    workDetail,
    start_time,
    end_time,
    durationHours,
    errors,
    warnings,
    isValid: errors.length === 0,
  };
}

function updateSummary() {
  const validCount = parsedEntries.filter((e) => e.isValid).length;
  const errorCount = parsedEntries.length - validCount;
  const totalHours = parsedEntries
    .filter((e) => e.isValid)
    .reduce((sum, e) => sum + (e.durationHours || 0), 0);

  els.previewSummary.innerHTML = `
    ✅ ${validCount} baris valid &middot; ${errorCount > 0 ? `❌ ${errorCount} baris error` : 'tidak ada error'}<br>
    Total jam (baris valid): <strong>${totalHours}</strong> jam
  `;

  els.btnSubmit.disabled = validCount === 0;
}

function buildTaskSelectHtml(selectedCode, idx) {
  let found = false;
  let optionsHtml = `<option value="">-- Pilih Task --</option>`;

  taskList.forEach((task) => {
    const code = extractTaskCode(task.name);
    const isSelected = code.toLowerCase() === String(selectedCode).trim().toLowerCase();
    if (isSelected) found = true;
    optionsHtml += `<option value="${code}" ${isSelected ? 'selected' : ''}>${task.name}</option>`;
  });

  if (selectedCode && !found) {
    optionsHtml += `<option value="${selectedCode}" selected>${selectedCode} (Tidak ditemukan)</option>`;
  }

  return `<select class="edit-input edit-task" data-idx="${idx}">${optionsHtml}</select>`;
}

function renderPreview() {
  updateSummary();

  els.previewTableBody.innerHTML = '';
  parsedEntries.forEach((entry) => {
    const tr = document.createElement('tr');
    let statusHtml = '';
    let rowClass = '';

    if (entry.errors.length > 0) {
      statusHtml = `❌ ${entry.errors.join('; ')}`;
      rowClass = 'row-error';
    } else if (entry.warnings.length > 0) {
      statusHtml = `⚠️ ${entry.warnings.join('; ')}`;
      rowClass = 'row-warn';
    } else {
      statusHtml = '✅ OK';
      rowClass = 'row-ok';
    }

    tr.className = rowClass;
    tr.setAttribute('data-idx', entry.idx);
    tr.innerHTML = `
      <td>${entry.idx + 1}</td>
      <td><input type="date" class="edit-input edit-date" data-idx="${entry.idx}" value="${entry.dateStr || ''}"></td>
      <td class="time-cell">${entry.start_time ? entry.start_time.slice(11, 16) : '?'} - ${entry.end_time ? entry.end_time.slice(11, 16) : '?'}</td>
      <td>${buildTaskSelectHtml(entry.taskCode, entry.idx)}</td>
      <td><input type="text" class="edit-input edit-work" data-idx="${entry.idx}" value="${entry.workDetail || ''}"></td>
      <td class="status-cell">${statusHtml}</td>
    `;
    els.previewTableBody.appendChild(tr);
  });
}

// ---------- Step 3: Submit ----------

els.btnSubmit.addEventListener('click', async () => {
  const validEntries = parsedEntries.filter((e) => e.isValid);
  if (validEntries.length === 0) return;

  const skipped = parsedEntries.length - validEntries.length;
  const confirmMsg = skipped > 0
    ? `${validEntries.length} entry akan disubmit, ${skipped} baris error akan dilewati. Lanjutkan?`
    : `${validEntries.length} entry akan disubmit ke Talenta. Lanjutkan?`;

  if (!confirm(confirmMsg)) return;

  els.btnSubmit.disabled = true;
  els.btnStop.classList.remove('hidden');
  els.stepProgress.classList.remove('hidden');
  els.progressLog.innerHTML = '';
  els.progressBar.style.width = '0%';
  els.progressText.textContent = `0 / ${validEntries.length}`;

  const payload = validEntries.map((e) => ({
    task_id: e.task.id,
    activity: e.workDetail,
    start_time: e.start_time,
    end_time: e.end_time,
  }));

  const progressListener = (message) => {
    if (message.type !== 'SUBMIT_PROGRESS') return;
    const pct = Math.round((message.done / message.total) * 100);
    els.progressBar.style.width = `${pct}%`;
    els.progressText.textContent = `${message.done} / ${message.total}`;

    const r = message.lastResult;
    const line = document.createElement('div');
    if (r.ok) {
      line.textContent = `✅ ${r.entry.start_time.slice(0, 10)} - ${r.entry.activity}`;
    } else {
      line.textContent = `❌ ${r.entry.start_time.slice(0, 10)} - ${r.error}`;
    }
    els.progressLog.appendChild(line);
    els.progressLog.scrollTop = els.progressLog.scrollHeight;
  };

  chrome.runtime.onMessage.addListener(progressListener);

  try {
    const res = await sendMessageToTab(activeTabId, { type: 'SUBMIT_ENTRIES', entries: payload });
    chrome.runtime.onMessage.removeListener(progressListener);

    if (!res || !res.ok) {
      throw new Error('Gagal menjalankan proses submit.');
    }

    const failedCount = res.results.filter((r) => !r.ok).length;
    const doneLine = document.createElement('div');
    doneLine.style.fontWeight = '600';
    doneLine.textContent = failedCount === 0
      ? '🎉 Semua entry berhasil disubmit.'
      : `Selesai dengan ${failedCount} gagal. Cek log di atas.`;
    els.progressLog.appendChild(doneLine);
  } catch (err) {
    chrome.runtime.onMessage.removeListener(progressListener);
    alert(`Terjadi kesalahan: ${err.message}`);
  } finally {
    els.btnStop.classList.add('hidden');
  }
});

els.btnStop.addEventListener('click', async () => {
  if (!activeTabId) return;
  await sendMessageToTab(activeTabId, { type: 'STOP_SUBMIT' });
  els.btnStop.disabled = true;
});

function handleCellEdit(e) {
  const target = e.target;
  if (!target.classList.contains('edit-input')) return;

  const idx = parseInt(target.getAttribute('data-idx'), 10);
  const tr = target.closest('tr');
  if (!tr || isNaN(idx)) return;

  const entry = parsedEntries[idx];
  if (!entry) return;

  const dateInput = tr.querySelector('.edit-date');
  const taskInput = tr.querySelector('.edit-task');
  const workInput = tr.querySelector('.edit-work');

  entry.raw['Date'] = dateInput.value;
  entry.raw['Task Code'] = taskInput.value;
  entry.raw['Work Detail'] = workInput.value;

  const validated = validateRow(entry.raw, idx);
  parsedEntries[idx] = validated;

  let statusHtml = '';
  let rowClass = '';

  if (validated.errors.length > 0) {
    statusHtml = `❌ ${validated.errors.join('; ')}`;
    rowClass = 'row-error';
  } else if (validated.warnings.length > 0) {
    statusHtml = `⚠️ ${validated.warnings.join('; ')}`;
    rowClass = 'row-warn';
  } else {
    statusHtml = '✅ OK';
    rowClass = 'row-ok';
  }

  tr.className = rowClass;

  const statusCell = tr.querySelector('.status-cell');
  if (statusCell) {
    statusCell.innerHTML = statusHtml;
  }

  const timeCell = tr.querySelector('.time-cell');
  if (timeCell) {
    timeCell.textContent = `${validated.start_time ? validated.start_time.slice(11, 16) : '?'} - ${validated.end_time ? validated.end_time.slice(11, 16) : '?'}`;
  }

  updateSummary();
}

els.previewTableBody.addEventListener('input', handleCellEdit);
els.previewTableBody.addEventListener('change', handleCellEdit);
