# Maelekezo ya Usakinishaji

## Hatua za Kwanza: Sakinisha Node.js

Kabla ya kuendesha mfumo wa uchaguzi, unahitaji kusakinisha Node.js kwenye kompyuta yako.

### Kwa Windows:

1. Nenda kwa tovuti rasmi ya Node.js: https://nodejs.org/
2. Pakia toleo la LTS (Long Term Support)
3. Endesha faili la usakinishaji
4. Fuata maelekezo ya usakinishaji
5. Fungua terminal/Command Prompt upya baada ya usakinishaji

### Kuthibitisha Usakinishaji:

Fungua terminal/Command Prompt na endesha amri zifuatazo:

```bash
node --version
npm --version
```

Ikiwa unaona matoleo (k.m. v18.17.0), basi Node.js imesakinishwa vizuri.

## Hatua za Pili: Usakinishaji wa Mfumo wa Uchaguzi

1. Fungua terminal/Command Prompt
2. Nenda kwenye folda ya mradi:
   ```bash
   cd "c:\MFUMO WA UCHAGUZI"
   ```

3. Sakinisha dependencies:
   ```bash
   npm install
   ```

4. Endesha seva:
   ```bash
   npm start
   ```

5. Fungua kivinjari chako na nenda kwa: http://localhost:3000

## Ikiwa Unakumbana na Tatizo

### Tatizo: "npm" halitambuiki
- Hakikisha Node.js imesakinishwa vizuri
- Fungua terminal upya
- Jaribu amri `node --version` kuthibitisha

### Tatizo: "Port 3000 inatumika"
- Badilisha port kwenye faili la `server.js`
- Au badilisha port kwa kutumia:
  ```bash
  set PORT=3001 && npm start
  ```

### Tatizo: Database haifunguki
- Hakikisha una ruhusa ya kuandika kwenye folda ya mradi
- Futa faili `voting.db` ikiwa inatumika na uanze upya

## Msaada Zaidi

Kwa msaada zaidi, tafadhali:
- Angalia faili la README.md kwa maelezo kamili
- Wasiliana na msaada wa kiufundi
- Angalia logi za server kwa ajili ya matatizo
