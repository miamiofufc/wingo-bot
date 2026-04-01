# 🔮 Wingo Oracle — Telegram Bot

AI prediction bot for Wingo 30s & 1min with 28-model fusion engine.  
Made by **GAINEO**

---

## 📁 Files

| File | Purpose |
|------|---------|
| `bot.js` | Main Telegram bot |
| `package.json` | Dependencies |
| `bot_admin.html` | Admin panel (open in browser) |
| `.env.example` | Environment variable template |
| `.gitignore` | Keeps secrets off GitHub |

---

## 🚀 Setup Guide

### Step 1 — Get a new Bot Token

> ⚠️ Your old token is compromised. Get a new one immediately.

1. Open Telegram → message **@BotFather**
2. Send `/newbot` or `/token` on existing bot
3. Copy the new token

---

### Step 2 — Firebase Service Account

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Project → Settings (gear icon) → **Service accounts**
3. Click **Generate new private key**
4. Download the JSON file
5. Rename it `serviceAccountKey.json` and place in same folder as `bot.js`

**Also set Firebase Rules:**
1. Realtime Database → Rules tab
2. Replace with:
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```
3. Click **Publish**

---

### Step 3 — Configure

1. Copy `.env.example` to `.env`
2. Fill in:
```
BOT_TOKEN=your_new_token_here
ADMIN_IDS=your_telegram_user_id
```
To get your Telegram ID: message **@userinfobot**

---

### Step 4 — Install & Run Locally

```bash
npm install
npm start
```

---

### Step 5 — Deploy to Railway (Free Hosting)

1. Push code to GitHub:
```bash
git init
git add bot.js package.json .gitignore README.md bot_admin.html
git commit -m "Initial commit"
git remote add origin https://github.com/YOURUSERNAME/YOURREPO.git
git push -u origin main
```

2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add environment variables in Railway dashboard:
   - `BOT_TOKEN` = your bot token
   - `FIREBASE_CRED` = paste the entire contents of serviceAccountKey.json as one line
4. Railway auto-deploys. Done!

**Alternative free hosts:** Render.com, Fly.io, Cyclic.sh

---

## 🤖 Bot Commands

| Command | Action |
|---------|--------|
| `/start` | Welcome + register |
| `/predict` | AI prediction (choose mode + server) |
| `/history` | Last 15 predictions |
| `/mode` | Switch 30s / 1min |
| `/server` | Switch server strategy |
| `/help` | Help |

---

## 🖥️ 4 Server Strategies

| Server | Mode | Description |
|--------|------|-------------|
| ⚔️ Server 1 | Aggressive | Always fires. Max momentum. Win-first. |
| 🛡️ Server 2 | Safe | Skips weak signals. Needs 72% consensus. |
| ⚖️ Server 3 | Balanced | Self-adjusting based on recent performance. |
| 🌐 Server 4 | Omega | All 28 models fused. Emergency reversal. |

---

## 🔧 Admin Panel (`bot_admin.html`)

Open `bot_admin.html` in your browser.  
Password: `Admin@123` (change in the HTML file)

**Features:**
- 🔴 **Maintenance Mode** toggle — turns bot offline with custom message
- 📢 **Broadcast** — send announcement to all users instantly
- 👥 **Users** — see who's online, last active, prediction count
- 📋 **Live Activity Log**

---

## 📊 Firebase Database Structure

```
gaineo-default-rtdb/
├── bot_users/
│   └── {chatId}/
│       ├── chatId, firstName, username
│       ├── online, lastActive, joinedAt
│       └── predictionCount
├── bot_predictions/
│   └── {chatId}/ → array of predictions
├── bot_maintenance/
│   ├── active: true/false
│   ├── message: "..."
│   └── updatedAt: timestamp
└── bot_broadcast/
    └── {pushId}/
        ├── message, active
        └── sentAt, recipients
```

---

## ⚠️ Important Notes

- **Never** commit `.env` or `serviceAccountKey.json` to GitHub
- Regenerate your bot token — the old one is exposed
- Firebase rules must be `true` for bot to read/write

---

_Made by GAINEO_
