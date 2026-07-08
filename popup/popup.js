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
  btnMaximize: document.getElementById('btn-maximize'),
};

// Deteksi & set mode fullscreen jika dibuka di tab baru
if (window.location.hash === '#fullscreen') {
  document.body.classList.add('fullscreen');
  if (els.btnMaximize) els.btnMaximize.style.display = 'none';
}

if (els.btnMaximize) {
  els.btnMaximize.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html#fullscreen') });
  });
}

let activeTabId = null;
let taskList = []; // [{id, name, project_id, project_name}]
let parsedEntries = []; // hasil parsing + validasi, siap ditampilkan & disubmit
let existingEntriesMap = {}; // map tanggal -> array entry existing di Talenta

const REQUIRED_HEADERS = ['Date', 'Clock In', 'Clock Out', 'Task Code', 'Work Detail'];

async function getActiveTalentaTab() {
  // Cek apakah extension berjalan sebagai tab sendiri (bukan popup)
  const currentTab = await new Promise((resolve) => {
    chrome.tabs.getCurrent(resolve);
  });

  if (currentTab) {
    // Jika di tab baru, cari tab hr.talenta.co mana saja yang sedang terbuka
    const tabs = await chrome.tabs.query({ url: 'https://hr.talenta.co/*' });
    if (tabs.length === 0) {
      throw new Error('Buka tab Talenta (hr.talenta.co) dulu di browser Anda, lalu coba lagi.');
    }
    return tabs[0];
  } else {
    // Jika di popup, cari tab aktif di window aktif saat ini
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.startsWith('https://hr.talenta.co')) {
      throw new Error('Buka tab Talenta (hr.talenta.co) dulu, lalu coba lagi.');
    }
    return tab;
  }
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

  // 1. Validasi Ekstensi File (.xlsx atau .xls)
  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
    alert('Format file tidak didukung! Hanya menerima file .xlsx atau .xls');
    e.target.value = ''; // Reset input file
    return;
  }

  // 2. Validasi Ukuran File (Maksimal 5 MB = 5 * 1024 * 1024 bytes)
  const maxSizeBytes = 5 * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    alert('Ukuran file terlalu besar! Maksimal ukuran file adalah 5 MB.');
    e.target.value = ''; // Reset input file
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Baca teks format secara langsung (raw: false) untuk menghindari bug konversi Date timezone
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    
    if (rawRows.length === 0) {
      throw new Error('File Excel kosong atau format tidak terbaca.');
    }

    // Cari index baris yang mengandung semua kolom wajib
    let headerRowIndex = -1;
    let actualHeaders = [];
    
    for (let i = 0; i < rawRows.length; i++) {
      const rowArr = rawRows[i].map(h => String(h || '').trim());
      const hasAllRequired = REQUIRED_HEADERS.every(req => rowArr.includes(req));
      if (hasAllRequired) {
        headerRowIndex = i;
        actualHeaders = rowArr;
        break;
      }
    }

    if (headerRowIndex === -1) {
      throw new Error(`Baris Header wajib tidak ditemukan. Pastikan ada kolom: ${REQUIRED_HEADERS.join(', ')}`);
    }

    // Ubah baris-baris di bawah header menjadi array of objects
    const rows = [];
    for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
      const rowData = rawRows[i];
      // Abaikan baris jika semuanya kosong
      if (rowData.every(cell => cell === '')) continue;
      
      const obj = {};
      actualHeaders.forEach((head, idx) => {
        if (head) obj[head] = rowData[idx];
      });
      rows.push(obj);
    }

    parsedEntries = rows.map((row, idx) => validateRow(row, idx));
    existingEntriesMap = {}; // Reset data existing sebelumnya
    renderPreview();
    els.stepPreview.classList.remove('hidden');
    checkExistingEntries();
  } catch (err) {
    alert(`Gagal membaca file: ${err.message}`);
  }
});

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseDateCell(value) {
  if (typeof value === 'string' && value.trim() !== '') {
    const trimmed = value.trim();
    
    // 1. Coba parse format YYYY-MM-DD atau YYYY/MM/DD secara langsung menggunakan Regex
    const matchYMD = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (matchYMD) {
      return `${matchYMD[1]}-${pad2(parseInt(matchYMD[2], 10))}-${pad2(parseInt(matchYMD[3], 10))}`;
    }

    // 2. Coba parse format DD-MM-YYYY atau DD/MM/YYYY secara langsung menggunakan Regex
    const matchDMY = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (matchDMY) {
      return `${matchDMY[3]}-${pad2(parseInt(matchDMY[2], 10))}-${pad2(parseInt(matchDMY[1], 10))}`;
    }

    // 3. Coba parse format teks seperti "Saturday, 01 August 2026" atau "01 Agustus 2026"
    const matchText = trimmed.match(/(?:[A-Za-z]+,\s*)?(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (matchText) {
      const d = parseInt(matchText[1], 10);
      const mStr = matchText[2].toLowerCase();
      const y = parseInt(matchText[3], 10);
      
      const months = {
        jan: 1, januari: 1, january: 1,
        feb: 2, februari: 2, february: 2,
        mar: 3, maret: 3, march: 3,
        apr: 4, april: 4,
        mei: 5, may: 5,
        jun: 6, juni: 6, june: 6,
        jul: 7, juli: 7, july: 7,
        agu: 8, ags: 8, agustus: 8, august: 8,
        sep: 9, september: 9,
        okt: 10, oktober: 10, oct: 10, october: 10,
        nov: 11, november: 11,
        des: 12, desember: 12, dec: 12, december: 12
      };
      
      const m = months[mStr] || months[mStr.substring(0, 3)];
      if (m) return `${y}-${pad2(m)}-${pad2(d)}`;
    }

    // Jika format string tidak standar, fallback menggunakan new Date dan ambil UTC
    // Catatan: Tambahkan ' UTC' agar JS tidak mengubahnya menjadi timezone lokal
    const d = new Date(trimmed + ' UTC');
    if (!isNaN(d.getTime())) {
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    }
    return null;
  }
  
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    // Mengambil komponen tanggal murni UTC (bebas pergeseran timezone lokal)
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  }

  return null;
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
    isSelected: errors.length === 0,
  };
}

async function checkExistingEntries() {
  const validDates = [...new Set(parsedEntries.filter(e => e.isValid && e.dateStr).map(e => e.dateStr))];
  if (validDates.length === 0) return;

  try {
    const tab = await getActiveTalentaTab();
    activeTabId = tab.id;
    
    // Tampilkan status loading
    els.previewSummary.innerHTML = `⏳ Mengecek data existing di Talenta...`;
    els.btnSubmit.disabled = true;
    
    const res = await sendMessageToTab(activeTabId, { type: 'CHECK_EXISTING', dates: validDates });
    if (res && res.ok) {
      existingEntriesMap = res.existing || {};
    }
  } catch (err) {
    console.error('Gagal mengecek data existing:', err);
  } finally {
    renderPreview();
  }
}

function updateSummary() {
  const validCount = parsedEntries.filter((e) => e.isValid).length;
  const selectedCount = parsedEntries.filter((e) => e.isValid && e.isSelected).length;
  const errorCount = parsedEntries.length - validCount;
  const totalHours = parsedEntries
    .filter((e) => e.isValid && e.isSelected)
    .reduce((sum, e) => sum + (e.durationHours || 0), 0);

  // Hitung jumlah data existing yang akan ditumpuk (replace)
  const uniqueSelectedDates = [...new Set(parsedEntries.filter(e => e.isValid && e.isSelected && e.dateStr).map(e => e.dateStr))];
  let replaceCount = 0;
  uniqueSelectedDates.forEach(date => {
    if (existingEntriesMap[date] && existingEntriesMap[date].length > 0) {
      replaceCount += existingEntriesMap[date].length;
    }
  });

  let replaceInfo = '';
  if (replaceCount > 0) {
    replaceInfo = `<br><span style="color: #1e40af; font-weight: 600;">🔄 ${replaceCount} data existing di ${uniqueSelectedDates.filter(d => existingEntriesMap[d] && existingEntriesMap[d].length > 0).length} tanggal akan di-replace</span>`;
  }

  els.previewSummary.innerHTML = `
    ✅ ${validCount} baris valid (${selectedCount} dipilih) &middot; ${errorCount > 0 ? `❌ ${errorCount} baris error` : 'tidak ada error'}<br>
    Total jam (dipilih): <strong>${totalHours}</strong> jam${replaceInfo}
  `;

  els.btnSubmit.disabled = selectedCount === 0;

  // Sinkronisasi checkbox "Select All" di header
  const checkAllCheckbox = document.getElementById('check-all');
  if (checkAllCheckbox) {
    const validEntries = parsedEntries.filter(e => e.isValid);
    checkAllCheckbox.checked = validEntries.length > 0 && validEntries.every(e => e.isSelected);
  }
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
    const hasExisting = entry.dateStr && existingEntriesMap[entry.dateStr] && existingEntriesMap[entry.dateStr].length > 0;

    if (entry.errors.length > 0) {
      statusHtml = `❌ ${entry.errors.join('; ')}`;
      rowClass = 'row-error';
    } else if (hasExisting && entry.isSelected) {
      const count = existingEntriesMap[entry.dateStr].length;
      statusHtml = `<span class="badge badge-replace" title="${existingEntriesMap[entry.dateStr].map(x => `${x.task_title}: ${x.activity}`).join('\n')}">🔄 Replace (${count} data)</span>`;
      rowClass = 'row-replace';
    } else if (entry.warnings.length > 0) {
      statusHtml = `⚠️ ${entry.warnings.join('; ')}`;
      rowClass = 'row-warn';
    } else {
      statusHtml = '✅ OK';
      rowClass = 'row-ok';
    }

    tr.className = rowClass;
    tr.setAttribute('data-idx', entry.idx);

    const checkboxHtml = `
      <input type="checkbox" class="entry-checkbox" data-idx="${entry.idx}" 
        ${entry.isSelected ? 'checked' : ''} 
        ${entry.isValid ? '' : 'disabled'} />
    `;

    tr.innerHTML = `
      <td>${checkboxHtml}</td>
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
  const validAndSelected = parsedEntries.filter((e) => e.isValid && e.isSelected);
  if (validAndSelected.length === 0) return;

  // Dapatkan semua ID data existing yang perlu dihapus (berdasarkan tanggal-tanggal unik yang dipilih)
  const uniqueSelectedDates = [...new Set(validAndSelected.map(e => e.dateStr))];
  const idsToDelete = [];
  uniqueSelectedDates.forEach(date => {
    const existing = existingEntriesMap[date] || [];
    existing.forEach(item => idsToDelete.push(item.id));
  });

  // Tampilkan dialog konfirmasi
  let confirmMsg = '';
  if (idsToDelete.length > 0) {
    confirmMsg = `⚠️ Ditemukan ${idsToDelete.length} data existing di ${uniqueSelectedDates.length} tanggal yang dipilih.\n` +
                 `Data lama di tanggal-tanggal tersebut akan DIHAPUS terlebih dahulu lalu DIGANTI dengan data baru.\n\n` +
                 `Apakah Anda yakin ingin melanjutkan?`;
  } else {
    confirmMsg = `${validAndSelected.length} entry akan disubmit ke Talenta. Lanjutkan?`;
  }

  if (!confirm(confirmMsg)) return;

  els.btnSubmit.disabled = true;
  els.btnStop.classList.remove('hidden');
  els.stepProgress.classList.remove('hidden');
  els.progressLog.innerHTML = '';
  els.progressBar.style.width = '0%';

  // Listener progress penghapusan data
  const deleteProgressListener = (message) => {
    if (message.type !== 'DELETE_PROGRESS') return;
    const pct = Math.round((message.done / message.total) * 100);
    els.progressBar.style.width = `${pct}%`;
    els.progressText.textContent = `Menghapus data lama: ${message.done} / ${message.total}`;

    const r = message.lastResult;
    
    // Cari tanggal dari ID yang dihapus untuk UI yang lebih ramah pengguna
    let dateStr = `ID ${r.id}`;
    for (const [date, entries] of Object.entries(existingEntriesMap)) {
      const found = entries.find(item => item.id === r.id);
      if (found && found.start_time) {
        dateStr = found.start_time.slice(0, 10);
        break;
      }
    }

    const line = document.createElement('div');
    if (r.ok) {
      line.style.color = '#1e40af';
      line.textContent = `🗑️ Sukses menghapus entry tanggal ${dateStr}`;
    } else {
      line.style.color = '#dc2626';
      line.textContent = `❌ Gagal menghapus entry tanggal ${dateStr}: ${r.error}`;
    }
    els.progressLog.appendChild(line);
    els.progressLog.scrollTop = els.progressLog.scrollHeight;
  };

  // Listener progress pengiriman data baru
  const progressListener = (message) => {
    if (message.type !== 'SUBMIT_PROGRESS') return;
    const pct = Math.round((message.done / message.total) * 100);
    els.progressBar.style.width = `${pct}%`;
    els.progressText.textContent = `Mengirim data baru: ${message.done} / ${message.total}`;

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

  chrome.runtime.onMessage.addListener(deleteProgressListener);
  chrome.runtime.onMessage.addListener(progressListener);

  try {
    // 1. Jalankan proses delete jika ada data existing
    if (idsToDelete.length > 0) {
      els.progressText.textContent = `Menghapus data lama: 0 / ${idsToDelete.length}`;
      const delRes = await sendMessageToTab(activeTabId, { type: 'DELETE_ENTRIES', ids: idsToDelete });
      if (!delRes || !delRes.ok) {
        throw new Error('Gagal menjalankan proses penghapusan data lama.');
      }
      
      // Beri sedikit jeda setelah selesai menghapus sebelum mulai meng-insert
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    // 2. Jalankan proses insert data baru
    const payload = validAndSelected.map((e) => ({
      task_id: e.task.id,
      activity: e.workDetail,
      start_time: e.start_time,
      end_time: e.end_time,
    }));

    els.progressText.textContent = `Mengirim data baru: 0 / ${payload.length}`;
    const res = await sendMessageToTab(activeTabId, { type: 'SUBMIT_ENTRIES', entries: payload });

    if (!res || !res.ok) {
      throw new Error('Gagal menjalankan proses submit data baru.');
    }

    const failedCount = res.results.filter((r) => !r.ok).length;
    const doneLine = document.createElement('div');
    doneLine.style.fontWeight = '600';
    doneLine.textContent = failedCount === 0
      ? '🎉 Semua proses (delete + insert) berhasil disubmit.'
      : `Selesai dengan ${failedCount} gagal. Cek log di atas.`;
    els.progressLog.appendChild(doneLine);

    // Tampilkan pop up pemberitahuan selesai
    setTimeout(() => {
      if (failedCount === 0) {
        alert('🎉 Semua data timesheet berhasil diproses dan disubmit!');
      } else {
        alert(`⚠️ Proses selesai dengan ${failedCount} data gagal disubmit. Silakan periksa log.`);
      }
    }, 100);
  } catch (err) {
    alert(`Terjadi kesalahan: ${err.message}`);
  } finally {
    chrome.runtime.onMessage.removeListener(deleteProgressListener);
    chrome.runtime.onMessage.removeListener(progressListener);
    els.btnStop.classList.add('hidden');
    // Refresh data existing setelah submit selesai
    checkExistingEntries();
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

  const oldDate = entry.dateStr;

  entry.raw['Date'] = dateInput.value;
  entry.raw['Task Code'] = taskInput.value;
  entry.raw['Work Detail'] = workInput.value;

  const validated = validateRow(entry.raw, idx);
  // Tetap pertahankan status isSelected yang diset user
  validated.isSelected = entry.isSelected;
  parsedEntries[idx] = validated;

  if (validated.dateStr !== oldDate) {
    checkExistingEntries();
  } else {
    renderPreview(); // Re-render untuk mengupdate class baris dan status badge
  }
}

els.previewTableBody.addEventListener('input', handleCellEdit);
els.previewTableBody.addEventListener('change', handleCellEdit);

// Listener untuk checkbox per baris
els.previewTableBody.addEventListener('change', (e) => {
  const target = e.target;
  if (target.classList.contains('entry-checkbox')) {
    const idx = parseInt(target.getAttribute('data-idx'), 10);
    if (!isNaN(idx) && parsedEntries[idx]) {
      parsedEntries[idx].isSelected = target.checked;
      renderPreview();
    }
  }
});

// Listener untuk checkbox "Select All" di header
document.addEventListener('change', (e) => {
  const target = e.target;
  if (target.id === 'check-all') {
    const checked = target.checked;
    parsedEntries.forEach(entry => {
      if (entry.isValid) {
        entry.isSelected = checked;
      }
    });
    renderPreview();
  }
});
