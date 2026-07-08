// Content script ini jalan di context halaman hr.talenta.co,
// jadi fetch() otomatis bawa cookie sesi user (credentials: 'include')
// dan kita ambil CSRF token langsung dari meta tag halaman.

const API_BASE = 'https://hr.talenta.co/api/web/time-sheet';

function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (!meta) {
    throw new Error('CSRF token tidak ditemukan di halaman. Pastikan kamu sudah login dan berada di halaman Talenta.');
  }
  return meta.getAttribute('content');
}

async function fetchTaskList() {
  const res = await fetch(`${API_BASE}/task-list`, {
    method: 'GET',
    credentials: 'include',
    headers: { accept: 'application/json, text/plain, */*' },
  });
  if (!res.ok) throw new Error(`Gagal ambil task list (HTTP ${res.status})`);
  const json = await res.json();
  if (json.status !== 200) throw new Error(json.message || 'Gagal ambil task list');
  return json.data; // [{id, name, project_id, project_name}]
}

async function submitEntry({ task_id, activity, start_time, end_time }) {
  const csrfToken = getCsrfToken();
  const res = await fetch(`${API_BASE}/store`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({ task_id, activity, start_time, end_time }),
  });

  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error(`Response tidak valid (HTTP ${res.status})`);
  }

  if (!res.ok || json.status !== 200) {
    throw new Error(json.message || `Gagal submit (HTTP ${res.status})`);
  }
  return json.data;
}

async function fetchTimesheetByDate(date) {
  const res = await fetch(`${API_BASE}/report?assigneeid=&date=${date}`, {
    method: 'GET',
    credentials: 'include',
    headers: { accept: 'application/json, text/plain, */*' },
  });
  if (!res.ok) throw new Error(`Gagal mengambil data timesheet (HTTP ${res.status})`);
  const json = await res.json();
  if (json.status !== 200) throw new Error(json.message || 'Gagal mengambil data timesheet');
  return json.data;
}

async function deleteEntryById(id) {
  const csrfToken = getCsrfToken();
  const res = await fetch(`${API_BASE}/delete`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({ id }),
  });

  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error(`Response delete tidak valid (HTTP ${res.status})`);
  }

  if (!res.ok || json.status !== 200) {
    throw new Error(json.message || `Gagal menghapus entry (HTTP ${res.status})`);
  }
  return json.data;
}

function getMonday(dateStr) {
  const parts = dateStr.split('-');
  const d = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setUTCDate(diff));
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let stopRequested = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'STOP_SUBMIT') {
    stopRequested = true;
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'GET_TASK_LIST') {
    fetchTaskList()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (message.type === 'CHECK_EXISTING') {
    (async () => {
      try {
        const mondays = [...new Set(message.dates.map(getMonday))];
        const resultsMap = {};
        
        for (const monday of mondays) {
          const reportData = await fetchTimesheetByDate(monday);
          if (reportData && reportData.daily) {
            reportData.daily.forEach(day => {
              if (day.data && day.data.length > 0) {
                resultsMap[day.date] = day.data.map(item => ({
                  id: item.id,
                  task_id: item.task_id,
                  activity: item.activity,
                  task_title: item.task_title,
                  start_time: item.start_time,
                  end_time: item.end_time
                }));
              }
            });
          }
        }
        sendResponse({ ok: true, existing: resultsMap });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true; // keep channel open
  }

  if (message.type === 'DELETE_ENTRIES') {
    (async () => {
      const ids = message.ids;
      const results = [];
      stopRequested = false;

      for (let i = 0; i < ids.length; i++) {
        if (stopRequested) {
          results.push({ id: ids[i], ok: false, error: 'Dihentikan oleh user' });
          break;
        }
        const id = ids[i];
        try {
          await deleteEntryById(id);
          results.push({ id, ok: true });
        } catch (err) {
          results.push({ id, ok: false, error: err.message });
        }

        chrome.runtime.sendMessage({
          type: 'DELETE_PROGRESS',
          done: i + 1,
          total: ids.length,
          lastResult: results[results.length - 1]
        }).catch(() => {});

        if (i < ids.length - 1) {
          await sleep(500 + Math.random() * 300);
        }
      }
      sendResponse({ ok: true, results });
    })();
    return true; // keep channel open
  }

  if (message.type === 'SUBMIT_ENTRIES') {
    (async () => {
      const entries = message.entries;
      const results = [];
      stopRequested = false;

      for (let i = 0; i < entries.length; i++) {
        if (stopRequested) {
          results.push({ index: i, ok: false, entry: entries[i], error: 'Dihentikan oleh user' });
          break;
        }
        const entry = entries[i];
        try {
          const data = await submitEntry(entry);
          results.push({ index: i, ok: true, entry, data });
        } catch (err) {
          results.push({ index: i, ok: false, entry, error: err.message });
        }

        // Kirim progress ke popup (kalau masih terbuka)
        chrome.runtime.sendMessage({
          type: 'SUBMIT_PROGRESS',
          done: i + 1,
          total: entries.length,
          lastResult: results[results.length - 1],
        }).catch(() => {
          // popup mungkin sudah tertutup, abaikan
        });

        // Delay natural antar submit, hindari pola submit terlalu cepat/beruntun
        if (i < entries.length - 1) {
          await sleep(700 + Math.random() * 600);
        }
      }

      sendResponse({ ok: true, results });
    })();
    return true; // keep channel open for async response
  }
});
