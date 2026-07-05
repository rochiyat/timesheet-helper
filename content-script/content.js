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
