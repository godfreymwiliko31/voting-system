# Mfumo wa Uchaguzi (Voting System)

Mfumo wa kisasa na salama wa kura za kidijitali uliouzwa kwa lugha ya Kiswahili.

## Features

- **Usajili wa Watumiaji**: Watumiaji wanaweza kusajili akaunti zao
- **Uthibitisho**: Mfumo salama wa kuingia na kutoka
- **Uundaji wa Uchaguzi**: Admin wanaweza kuunda na kudhibiti uchaguzi
- **Udhibiti wa Wagombea**: Ongeza na usimamie wagombea kwa kila uchaguzi
- **Kupiga Kura**: Mfumo rahisi na salama wa kupiga kura
- **Matokeo ya Wakati**: Angalia matokeo ya uchaguzi kwa njia ya picha na chati
- **Usalama**: Kila mtumiaji anaweza kupiga kura moja tu kwa kila uchaguzi

## Teknolojia Zilizotumika

- **Backend**: Node.js, Express.js
- **Database**: SQLite (data hudumu kwenye faili)
- **Frontend**: HTML5, CSS3, JavaScript, Bootstrap 5
- **Usalama**: bcryptjs, express-session (cookies)
- **Chati**: Chart.js

## Usakinishaji

1. Hakikisha una Node.js iliyosakinishwa kwenye kompyuta yako
2. Pakia faili za mradi
3. Fungua terminal/Command Prompt kwenye folda ya mradi
4. Endesha amri zifuatazo:

```bash
# Sakinisha dependencies
npm install

# Endesha seva kwa ajili ya maendeleo
npm run dev

# Au endesha seva ya kawaida
npm start
```

5. Fungua kivinjari chako na nenda kwa: `http://localhost:3000`

## Matumizi

### Kwa Wapiga Kura

1. **Jisajili**: Nenda kwa `http://localhost:3000/register` na jisajili akaunti
2. **Ingia**: Tumia jina la mtumiaji na nenosiri lako kuingia
3. **Piga Kura**: Chagua uchaguzi unaendelea na uchague mgombea wako
4. **Angalia Matokeo**: Nenda kwa `http://localhost:3000/results` kuona matokeo

### Kwa Admin

1. **Ingia kama Admin**: Tumia akaunti ya admin (itahitaji kuundwa kwanza)
2. **Unda Uchaguzi**: Nenda kwa paneli ya admin kuunda uchaguzi mpya
3. **Ongeza Wagombea**: Ongeza wagombea kwa kila uchaguzi
4. **Dhibiti Uchaguzi**: Fungua au funga uchaguzi
5. **Angalia Takwimu**: Fuatilia matokeo na takwimu za uchaguzi

## Muundo wa Database

Mfumo hutumia SQLite na hutengeneza schema moja kwa moja kwenye startup.

## Usalama

- Nenosiri huhifadhiwa kwa kutumia bcrypt
- Kila mtumiaji anaweza kupiga kura moja tu kwa kila uchaguzi
- Sessions zinatumika kwa ajili ya uthibitisho
- SQL injection inazuiliwa kwa kutumia prepared statements

## Hosting / production (muhtasari)

Kwa ku-host toleo hili rahisi:

- Tumia `npm install` kisha `npm start` (itaitumia `server.js`).
- Weka `PORT` ukihitaji kubadili port.
- Weka `DB_PATH` kama unataka kubadili path ya `voting.db` (angalia `.env.example`).
- Kwa production: weka `NODE_ENV=production` na `SESSION_SECRET` (≥ herufi 24).

Mwongozo mfupi wa ku-host mtandaoni: soma [HOSTING.md](HOSTING.md).

## API Endpoints

### Watumiaji
- `POST /api/register` - Usajili wa mtumiaji mpya
- `POST /api/login` - Kuingia kwenye akaunti
- `POST /api/logout` - Kutoka kwenye akaunti

### Uchaguzi
- `GET /api/elections` - Pata orodha ya uchaguzi zote
- `GET /api/elections/active` - Pata uchaguzi unaendelea
- `POST /api/elections` - Unda uchaguzi mpya (admin)
- `PUT /api/elections/:id/toggle` - Badilisha hali ya uchaguzi (admin)

### Wagombea
- `GET /api/elections/:id/candidates` - Pata wagombea wa uchaguzi
- `POST /api/elections/:id/candidates` - Ongeza mgombea (admin)

### Kura
- `POST /api/vote/batch` - Save votes (per category) for the signed-in user
- `GET /api/elections/:id/results` - Pata matokeo (hesabu ya kura kwa mteule / jamii)

## Maelezo ya Kiufundi

- Port ya chaguo-msingi: 3000
- Database file: `data/voting.db` (itatengenezwa otomatiki)
- Static files: `public/` directory
- Session secret: unaweza kuweka `SESSION_SECRET` kwenye mazingira

## Matengenezo

- Funga database mara kwa mara
- Weka kumbukumbu za backup za database
- Badilisha secrets za JWT na session kwa ajili ya usalama
- Fuatilia logi za server kwa ajili ya matatizo

## License

MIT License

## Msaada

Kwa msaada au maswali, tafadhali wasiliana kupitia:
- GitHub Issues
- Barua pepe: [your-email@example.com]

---

**Muundo wa Uchaguzi** - Kura za Kidijitali Salama na Rahisi
