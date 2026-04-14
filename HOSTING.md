# Ku-host mfumo mtandaoni (njia rahisi)

Mfumo huu ni **Node.js + SQLite**. Uhostishaji rahisi zaidi ni **VPS ndogo** au huduma inayokupa **disk isiyofutika** (si “ephemeral” tu).

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
| `SESSION_SECRET` | chapa siri refu (≥ 24 herufi) |

6. **Create Web Service**. Render hutoa **HTTPS** moja kwa moja (muhimu kwa kuki za session).

**Makini:** kwenye **free tier**, seva inaweza **kulala** baada ya kutokuwa na trafiki; maombi ya kwanza yanaweza kuwa **pole**. Pia **SQLite** kwenye diski ya chaguo-msingi inaweza **kupotea** baada ya redeploy au baadhi ya restart — usitumie kama hifadhi ya pekee ya data muhimu bila rudufu; kwa uchaguzi wa siku chache inaweza kutosha ikiwa hutadeploy tena wakati wa matumizi.

### Njia B — Oracle Cloud “Always Free” (VPS ya bure)

Akaunti ya Oracle inakupa **VPS ndogo ya bure** (kadi ya benki mara nyingi hutumika tu kwa uhakiki, si malipo ya kila mwezi). Diski ni ya kudumu — **SQLite salama zaidi** kuliko Render free. Mipangilio ni ngumu kidogo; hatua za jumla zifuata **Chaguo 1 (VPS)** hapo chini (Ubuntu + Node + PM2 + HTTPS).

### Njia C — PC yako + tunnel (bure, bila “host” ya wingu)

Endesha `node server.js` kwenye kompyuta yako (au `start-dev.cmd` kwa majaribio). Tumia [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) au [ngrok](https://ngrok.com/) (kikomo cha bure) kupeana **URL ya mtandao**. **PC lazima iwe wazi** na mtandao uwe hai wakati wote wa kura.

---

## Chaguo 1: VPS (DigitalOcean, Linode, Contabo, n.k.) — inapendekelewa kwa SQLite

1. Tengeneza **Ubuntu** server (1 GB RAM inatosha kuanzia).
2. Sakinisha Node **LTS** na Git: `sudo apt update && sudo apt install -y git curl && curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install -y nodejs`
3. Rudisha mradi: `git clone <YOUR_REPO_URL> && cd mfumo-wa-uchaguzi` (au sftp faili za folda).
4. Ndani ya folda: `npm install --omit=dev`
5. Weka mazingira (mfano kwenye `~/.bashrc` au faili `.env` unayosoma mwenyewe):

```bash
export NODE_ENV=production
export SESSION_SECRET='badili-hii-kuwa-siri-refu-zaidi-ya-herufi-24'
export PORT=3000
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
   Bila HTTPS, **kuki za session hazitafanya kazi** (`secure: true` katika production).

8. **Admin wa kwanza**: sajili mtu mmoja kupitia `/register`, kisha kwenye SQLite:  
   `UPDATE users SET role = 'admin' WHERE username = 'jina_lako';`

---

## Chaguo 2: Railway / Render (PaaS)

1. Sogeza mradi kwenye **GitHub** (au zip upload kama huduma inaruhusu).
2. Unda **Web Service** mpya, uunganishe repo.
3. **Build command:** `npm install`  
   **Start command:** `npm start` (au `node server.js`)
4. Weka **Environment variables** kwenye dashboard:

| Key | Value |
|-----|--------|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | chapa siri refu (≥ herufi 24) |

5. **SQLite kwenye PaaS**: diski ya chaguo-msingi mara nyingi **hifadhiwa kwa muda** tu. Ili data isipotee unapowasha upya:

   - Weka **Persistent Disk / Volume** na uelekeze `VOTING_DB_PATH` kwenye faili ndani ya volume (angalia docs za huduma yako), **au**
   - Tumia **VPS** (Chaguo 1).

---

## Kumbuka

- Usichague `NODE_ENV=production` kwenye PC yako bila `SESSION_SECRET` — seva haitawasha.
- Rudufu `voting.db` mara kwa mara ikiwa ndiyo hifadhidata yako ya pekee.
- Faili `Procfile` iko kwa huduma zinazotumia Heroku-style start command `web: node server.js`.

Kwa maswali ya huduma maalum (Railway disk, Render blueprint), soma docs rasmi za huduma hiyo na ubadilishe `VOTING_DB_PATH` kulingana na mount path.
