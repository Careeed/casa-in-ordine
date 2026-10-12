# Casa in Ordine

App Android (HTML/CSS/JS + Capacitor) per gestire insieme le faccende di casa su due telefoni.
Archivio condiviso: **Google Sheets**. Backend: **Google Apps Script**. APK: **GitHub Actions**.

## Cosa NON posso fare io (passaggi manuali tuoi)
Creare il Google Sheet, pubblicare lo script con il tuo account Google, creare la repository GitHub, lanciare la build, scaricare e installare l'APK. Sono tutti spiegati qui sotto.

## 1. Creare il Google Sheet
1. Vai su <https://sheets.google.com> e crea un foglio vuoto, per esempio "Casa in Ordine".
2. **Non condividerlo con nessuno**: resta privato, accessibile solo al tuo account.

## 2. Configurare Google Apps Script
1. Nel foglio: **Estensioni → Apps Script**.
2. Cancella il contenuto di `Code.gs` e incolla tutto il file `backend/Code.gs` di questo progetto. Salva.
3. Nel menu a tendina delle funzioni scegli **`setup`** e premi **Esegui**. Alla prima esecuzione Google chiede i permessi: *Rivedi autorizzazioni → scegli il tuo account → Avanzate → Vai a… (non sicuro) → Consenti*. È normale per script tuoi non verificati. `setup` crea i sei fogli (Mansioni, Occorrenze, Storico, Persone, Disponibilita, Impostazioni, più Operazioni per l'idempotenza) e le mansioni di partenza. Si può rilanciare senza cancellare nulla.
4. Scegli **`generaTokenAccesso`** ed **Esegui**. Poi apri **Visualizza → Log di esecuzione**: compaiono **due token lunghi**: il primo è tuo, il secondo di Paola. Copiali e conservali. Rilanciare la funzione genera token nuovi e **revoca subito i vecchi** (utile se perdi un telefono).
5. **Distribuisci → Nuova distribuzione → Tipo: App web**
   - Esegui come: **Me**
   - Chi ha accesso: **Chiunque**
   - Premi **Distribuisci** e copia l'**URL dell'app web** (finisce con `/exec`).
6. Quando modifichi `Code.gs` in futuro: **Distribuisci → Gestisci distribuzioni → Modifica → Nuova versione → Distribuisci** (l'URL resta lo stesso).

### Come funziona la sicurezza (leggi con attenzione)
- Un'app Android installata in modo semplice non può portare con sé un login Google verificabile da Apps Script, quindi l'app web va pubblicata con accesso "Chiunque". **L'URL da solo non basta**: ogni richiesta deve contenere un **token segreto** che il server verifica. Senza token valido risponde solo "Token non valido" e non restituisce dati.
- Il Google Sheet **non è condiviso** e non è pubblico: lo legge solo lo script, che gira col tuo account.
- Ogni persona ha un token diverso: il server sa chi è (non è una scelta fatta nell'app).
- I token non sono nel codice né nell'APK: li incolli nell'app al primo avvio e restano sul telefono (archiviazione locale dell'app). Dopo 10 token errati il server blocca i tentativi per 10 minuti.
- **Limiti onesti**: è un'autenticazione a token (come una chiave condivisa per persona), non un login Google. Chi ruba il telefono sbloccato o il token può leggere i dati finché non rigeneri i token. Il traffico è HTTPS. Per i dati di una coppia è un compromesso ragionevole, ma non è un sistema di livello bancario.

## 3. Verificare che il backend sia raggiungibile
1. Apri l'URL `/exec` nel browser del telefono: deve comparire `{"ok":true,"service":"casa-in-ordine",...}` (nessun dato).
2. Il vero collaudo è il passo 8: nell'app, "Salva e verifica" deve dire "Connesso come …".

## 4. Caricare il progetto su GitHub
1. Crea su <https://github.com/new> una repository **privata** (es. `casa-in-ordine`).
2. Estrai lo ZIP sul computer e carica **tutto il contenuto della cartella** (non la cartella stessa):
   - con Git: `git init && git add -A && git commit -m "Prima versione" && git branch -M main && git remote add origin <URL> && git push -u origin main`;
   - oppure con **GitHub Desktop**;
   - oppure dal sito (*Add file → Upload files*): attenzione, i browser a volte saltano le cartelle che iniziano con un punto. Se dopo il caricamento non vedi `.github/workflows/android.yml`, crealo a mano: *Add file → Create new file*, nome `.github/workflows/android.yml`, incolla il contenuto del file omonimo.
3. Non esistono segreti da inserire in GitHub: l'app non ne contiene.

## 5. Avviare GitHub Actions
- Parte da sola a ogni push su `main`/`master`. Oppure: scheda **Actions → "Build APK debug" → Run workflow**.
- Durata tipica: 5-10 minuti. Il workflow esegue: `npm install` → test → `npm run build` → crea il progetto Android (`npx cap add android`, solo se la cartella `android/` non esiste) → `npx cap sync android` → `./gradlew assembleDebug` → pubblica l'APK.

## 6. Scaricare l'APK
1. **Actions →** apri l'esecuzione completata (spunta verde).
2. In fondo, sezione **Artifacts**: scarica **`casa-in-ordine-debug-apk`** (è uno ZIP).
3. Estrai: dentro c'è `app-debug.apk`.

## 7. Installare l'APK sui due telefoni
1. Trasferisci `app-debug.apk` sul telefono (cavo, Drive, email…).
2. Aprilo; se Android lo chiede, consenti "Installa app sconosciute" per l'app che stai usando (File/Drive/Chrome).
3. Conferma l'installazione. È un APK **debug**: va bene per usarla in due. Se compare un avviso di Play Protect, scegli "Installa comunque".

## 8. Primo avvio su ogni telefono
1. Apri **Casa in Ordine**. Incolla **URL** (`/exec`) e il **token** (il tuo sul tuo telefono, quello di Paola sul suo). Premi **Salva e verifica**.
2. In *Impostazioni → Persone* rinomina "Persona 1" con il tuo nome (basta farlo su un telefono).
3. In *Impostazioni → Disponibilità* controlla gli orari: all'inizio ho messo, **come esempio da modificare**, il tuo lavoro lun-ven 09:00-18:00 e Paola non disponibile lunedì e mercoledì. Adatta tutto.

## 9. Verificare la sincronizzazione tra i due telefoni
1. Sul telefono A: *Mansioni → ＋* crea "Prova", scadenza oggi, salva.
2. Sul telefono B: tocca ⟳ in alto (oppure aspetta fino a 45 secondi): "Prova" deve comparire in **Oggi**.
3. Su B completa "Prova" con ✓; su A aggiorna: sparisce da Oggi e compare in *Statistiche → Storico*.
4. Prova offline: modalità aereo, completa un'attività → compare il banner "non ancora confermata"; riattiva la rete e la modifica viene inviata e confermata.

## Come funzionano alcune cose
- **Offline**: Google Sheets non è un database offline. Senza rete l'app mostra l'ultima copia dei dati (sola lettura, con ora dell'ultimo aggiornamento). Le modifiche fatte restano in una **coda locale** marcata "in attesa" e **non sono considerate sincronizzate finché il server non conferma**. Puoi riprovare o scartarle dal banner.
- **Scritture simultanee**: ogni riga ha una `version`. Se due telefoni modificano la stessa cosa, il secondo riceve "modificata nel frattempo" e vede i dati aggiornati; non sovrascrive in silenzio. Il server serializza le scritture con un lock.
- **Idempotenza**: ogni modifica ha un `opId`; se una richiesta viene ripetuta (rete instabile) il server riconosce l'`opId` e non duplica storico né occorrenze.
- **Ricorrenze**: al completamento nasce la prossima occorrenza (sempre nel futuro) solo se non ce n'è già una aperta. Le scadute restano visibili finché non le risolvi o le sposti.
- **Statistiche**: calcolate sul momento dallo Storico (nessun contatore), dedotte per `id` per non contare due volte. "Entrambi" conta metà a testa. Quantità, durata e impegno sono mostrati separatamente. *Equilibrio* confronta il carico con la disponibilità dichiarata, senza obiettivo 50/50.
- **Eliminare una mansione** la nasconde ma lo storico resta (eliminazione logica; i dati restano nel foglio).
- **Esporta CSV**: da *Statistiche → Storico* (condivisione o appunti, separatore `;` per Excel italiano). In alternativa scarica il foglio "Storico" da Google Sheets (*File → Scarica → CSV*).
- **Backup**: il Google Sheet è l'archivio: *File → Cronologia versioni* ti protegge da errori.

## Build "release" (opzionale, non inclusa)
Il workflow produce solo l'APK **debug**. Se un giorno vorrai una release firmata, genera il keystore sul tuo computer, **non committarlo mai** (`.gitignore` blocca `*.keystore`/`*.jks`) e salvalo come GitHub *Secrets* (keystore in base64, password, alias) da leggere nel workflow.

## Struttura
```
.github/workflows/android.yml   build APK (debug) + artifact
backend/Code.gs                 Google Apps Script
src/                            frontend (index.html, styles.css, app.js)
scripts/build.mjs               copia src/ → www/
capacitor.config.json           configurazione Capacitor (webDir: www)
tests/                          test backend (Sheets simulato) e test di fumo UI
android/                        NON incluso: generato dalla build con `npx cap add android`
```
Per provare in locale: `npm install && npm test && npm run build && npx cap add android && npx cap sync android` (serve Java 17 e Android SDK per compilare).
