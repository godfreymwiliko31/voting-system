# Ku-host mfumo mtandaoni (njia rahisi)

Mfumo huu ni **Node.js + SQLite** (data hudumu kwenye faili `voting.db`). Hakikisha `DB_PATH` ipo kwenye storage ya kudumu (home directory / persistent volume).

---

## Hosting bila malipo (free)

Hakuna “bure kamili” bila masharti: huduma nyingi za bure zina **usingizi** (cold start), **kikomo cha muda**, au **hifadhidata inaweza kupotea** ikiwa diski si ya kudumu.

### Njia A — Render.com (Web Service ya bure) — rahisi zaidi

1. Weka mradi kwenye **GitHub** (repo ya bure inatosha).
2. Fungua [render.com](https://render.com), sajili kwa **GitHub**.
3. **New +** → **Web Service** → chagua repo yako.
4. Mipangilio: **Runtime** Node, **Build Command** `npm install`, **Start Command** `npm start`.
5. **Environment** (Environment tab):

| Key | Value |
|-----|--------|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | siri refu (≥ herufi 24) |
| `DB_PATH` | path ya kudumu ya `voting.db` (mf: `/var/lib/uchaguzi/voting.db`) |
| `PORT` | `3000` (au chochote unachotaka) |

6. **Create Web Service**. Render hutoa **HTTPS** moja kwa moja (muhimu kwa kuki za session).

**Makini:** kwenye **free tier**, seva inaweza **kulala** baada ya kutokuwa na trafiki; maombi ya kwanza yanaweza kuwa **pole**. SQLite itadumu mradi `DB_PATH` ipo kwenye storage ya kudumu.

### Njia B — Oracle Cloud “Always Free” (VPS ya bure)

Akaunti ya Oracle inakupa **VPS ndogo ya bure** (kadi ya benki mara nyingi hutumika tu kwa uhakiki, si malipo ya kila mwezi). Diski ni ya kudumu — **SQLite salama zaidi** kuliko Render free. Mipangilio ni ngumu kidogo; hatua za jumla zifuata **Chaguo 1 (VPS)** hapo chini (Ubuntu + Node + PM2 + HTTPS).

### Njia C — PC yako + tunnel (bure, bila “host” ya wingu)

Endesha `npm start` kwenye kompyuta yako. Tumia [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) au [ngrok](https://ngrok.com/) kupeana **URL ya mtandao**. **PC lazima iwe wazi** na mtandao uwe hai wakati wote wa kura.

---

## Chaguo 1: VPS (DigitalOcean, Linode, Contabo, n.k.)

1. Tengeneza **Ubuntu** server (1 GB RAM inatosha kuanzia).
2. Sakinisha Node **LTS** na Git: `sudo apt update && sudo apt install -y git curl && curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install -y nodejs`
3. Rudisha mradi: `git clone <YOUR_REPO_URL> && cd mfumo-wa-uchaguzi` (au sftp faili za folda).
4. Ndani ya folda: `npm install --omit=dev`
5. Weka mazingira (mfano kwenye `~/.bashrc` au `.env`):

```bash
export PORT=3000
export NODE_ENV=production
export SESSION_SECRET='badili-hii-kuwa-siri-refu-zaidi-ya-herufi-24'
export DB_PATH='/var/lib/uchaguzi/voting.db'
```

6. Anza kwa **PM2** (haiwashi zima server ikizima SSH):

```bash
sudo npm install -g pm2
cd /path/to/mfumo-wa-uchaguzi
pm2 start server.js --name uchaguzi
pm2 save
pm2 startup
```

7. **HTTPS**: tumia **Caddy** (rahisi) au **Nginx** kama reverse proxy mbele ya `127.0.0.1:3000`.

---

## Chaguo 2: Railway / Render (PaaS)

1. Sogeza mradi kwenye **GitHub** (au zip upload kama huduma inaruhusu).
2. Unda **Web Service** mpya, uunganishe repo.
3. **Build command:** `npm install`  
   **Start command:** `npm start`
4. Weka **Environment variables** kwenye dashboard:

| Key | Value |
|-----|--------|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | siri refu (≥ herufi 24) |
| `DB_PATH` | path ya kudumu ya `voting.db` |
| `PORT` | `3000` (au chochote) |

5. **Data**: SQLite itadumu mradi `DB_PATH` ipo kwenye storage ya kudumu (mount/persistent disk).

---

## Kumbuka

- Kama hosting yako ni shared/cPanel, weka `DB_PATH` ndani ya home directory ya account (mf: `/home/USER/uchaguzi-data/voting.db`) ili isifutwe.
