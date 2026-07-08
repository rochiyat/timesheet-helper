<div align="center">

# ⏱️ Talenta Timesheet Helper

**Automate your Talenta timesheet from an Excel template — fast, private, and reliable.**

[![Chrome Extension](https://img.shields.io/badge/Platform-Chrome_Extension-4285F4?logo=googlechrome&logoColor=white)](#installation)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853?logo=googlechrome&logoColor=white)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## ✨ Overview

Talenta Timesheet Helper is a lightweight Chrome extension that fills your [Talenta HR](https://hr.talenta.co) timesheet automatically from an Excel spreadsheet. It calls Talenta's own API endpoints using your existing browser session — no scraping, no backend, no third-party servers.

### Key Features

| Feature | Description |
|---------|-------------|
| 📋 **Excel Import** | Upload `.xlsx` files with your timesheet data |
| 🔍 **Live Preview & Validation** | Inspect every row before submitting — errors highlighted in red |
| ✏️ **Inline Editing** | Edit dates, tasks, and work details directly in the preview table |
| 📝 **Task Dropdown** | Pick tasks from a live dropdown synced with your Talenta account |
| 🚀 **Batch Submit** | Submit all entries to Talenta with real-time progress tracking |
| ⏹️ **Stop Anytime** | Abort mid-submission if something looks wrong |
| 🔒 **100% Private** | Zero data leaves your browser — no external servers, no telemetry |

---

## 📦 Installation

> **Note:** This extension is not published on the Chrome Web Store. Install it in Developer Mode.

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the `timesheet-helper` folder (the one containing `manifest.json`)
5. Pin the extension from the puzzle icon in the toolbar for easy access

---

## 🚀 Usage

### Step 1 — Connect to Talenta

1. Log in to [Talenta HR](https://hr.talenta.co) in any Chrome tab
2. Click the extension icon in your toolbar
3. Click **"Cek Koneksi & Ambil Daftar Task"** to fetch your available tasks

### Step 2 — Prepare Your Excel File

Use the provided template at [`docs/template-timesheet.xlsx`](docs/template-timesheet.xlsx) or create your own with these **required columns**:

| Column | Format | Example |
|--------|--------|---------|
| `Date` | Any recognizable date format | `Tuesday, 01 July 2026` |
| `Clock In` | `HH:MM` | `09:00` |
| `Clock Out` | `HH:MM` | `17:00` |
| `Task Code` | Code from the task list | `E2022DA009` |
| `Work Detail` | Free text description | `Sprint planning & code review` |

### Step 3 — Upload, Review & Edit

1. Upload your Excel file in the extension popup
2. Review the **preview table** — each row shows validation status:
   - ✅ **Green** — valid and ready to submit
   - ❌ **Red** — error with a specific reason
   - ⚠️ **Yellow** — warning (e.g., unusually long hours)
3. **Edit inline** if needed — change dates, pick a different task from the dropdown, or update the work detail directly in the table

### Step 4 — Submit

1. Click **"Submit Semua ke Talenta"** to begin batch submission
2. Watch the progress bar and per-entry status in real time
3. Click **Stop** at any time to abort

---

## 📁 Project Structure

```
timesheet-helper/
├── manifest.json            # Chrome Extension manifest (V3)
├── content-script/
│   └── content.js           # Injected into Talenta — handles API calls
├── popup/
│   ├── popup.html           # Extension popup UI
│   ├── popup.css            # Popup styles
│   └── popup.js             # Popup logic (parsing, validation, editing)
├── lib/
│   └── xlsx.full.min.js     # SheetJS library for Excel parsing
├── docs/
│   └── template-timesheet.xlsx  # Excel template
└── LICENSE
```

---

## 🔒 Security & Privacy

This extension is designed with a **zero-trust, local-only** philosophy:

- **No external servers** — all `fetch()` requests go directly from your browser to `hr.talenta.co`, identical to manual usage
- **No data storage** — nothing is persisted outside your browser session
- **No telemetry** — no analytics, no tracking, no third-party scripts
- **Fully auditable** — the entire source code is in `content-script/content.js` and `popup/popup.js`

---

## ⚠️ Known Limitations

- If Talenta changes their API structure, the extension may need an update (see `API_BASE` in `content-script/content.js`)
- Single-sheet / single-month per file — multi-sheet support is not yet available
- No automated deadline reminders (planned for a future release)

---

## 🤝 Contributing

This is a personal-use tool, but contributions are welcome. Feel free to open an issue or submit a pull request.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">
  <sub>Built with ☕ for anyone who'd rather not click 160 form fields every month.</sub>
</div>
