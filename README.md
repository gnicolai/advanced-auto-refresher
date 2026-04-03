<p align="center">
  <img src="assets/icon128.png" alt="Auto Refresh & Page Monitor Logo" width="128" height="128">
</p>

<h1 align="center">Auto Refresh &amp; Page Monitor with Telegram Alerts</h1>

<p align="center">
  A geeky Chrome sidekick for relentless refresh loops, smart change detection, visual highlights, and instant Telegram pings.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.22-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/manifest-v3-green.svg" alt="Manifest V3">
  <img src="https://img.shields.io/badge/languages-9-orange.svg" alt="Languages">
  <img src="https://img.shields.io/badge/license-MIT-purple.svg" alt="License">
</p>

<p align="center">
  <code>refresh -> inspect -> highlight -> alert -> jump</code>
</p>

<p align="center">
  Built for people who watch pages like logs, hunt drops like loot, and want signals instead of noise.
</p>

---

## English

### Why it exists

Auto Refresh & Page Monitor with Telegram Alerts is a Manifest V3 Chrome extension for users who do not just want "auto refresh", but a proper monitoring tool.

Think of it as a lightweight page watcher for humans who need fast feedback:

- Amazon Vine and limited-availability product pages
- Stock or availability checks
- Ticket, booking, giveaway, and flash-sale pages
- Numeric counters that increase or decrease
- Text, keywords, phrases, or DOM/HTML changes after refresh

### Core loop

```text
Pick a target -> refresh on schedule -> detect a change -> highlight it -> alert you -> jump to it
```

### Feature set

#### Refresh engine

- Custom refresh interval per tab
- Manifest V3-safe scheduling based on alarms
- Improved countdown recovery after service worker suspension
- Optional stochastic mode to randomize refresh timing
- Uniform or Gaussian distribution for stochastic timing

#### Numeric watcher

- Monitor a selected element as a numeric value
- Visual picker or advanced CSS selector mode
- Alert modes:
  - increase
  - decrease
  - any numeric change
  - above threshold
  - below threshold
- Separate sound and volume for numeric alerts when using split alert mode

#### Text watcher

- Works in parallel with numeric monitoring, not as a replacement
- Monitor:
  - selected element text
  - full page text
  - full page HTML
- Text detection modes:
  - any appearance, disappearance, or text change
  - keyword state changes
  - text change or keyword change
  - keyword appearance/disappearance only
- Keywords and phrases are entered one per line
- Separate sound and volume for text alerts when using split alert mode

#### Alert routing

- Shared alert mode: one common sound for all triggers
- Separate alert mode: numeric and text alerts use different sounds
- When numeric and text triggers happen together, sounds are sequenced quickly instead of overlapping badly

#### Visual feedback

- Highlight the changed monitored element after refresh
- In-page toast with clickable actions
- Jump directly to:
  - the numeric target
  - the text target
  - the first keyword match when page-wide text/HTML monitoring is used
- Debug panel for text monitoring to inspect captured content

#### Telegram alerts

- Automatic Telegram alerts for numeric changes
- Automatic Telegram alerts for text changes and keyword hits
- When both numeric and text triggers happen together, Telegram sends one combined message
- Telegram messages follow the language selected inside the extension
- No backend required: use your own bot token and chat ID

#### Safety / control

- Optional "Stop refresh when user clicks on the page"
- Useful for time-sensitive interactions where refresh should pause immediately

#### Scope control

- Blacklist specific URLs from refresh
- Whitelist URLs that should bypass blacklist rules
- Wildcard support for flexible matching

#### Polyglot mode

Built-in UI language switching:

- English
- Italian
- French
- German
- Spanish
- Portuguese (Brazil)
- Polish
- Ukrainian
- Arabic

### Quick vibe check

- Want only a refresh timer: works
- Want numeric delta alerts: works
- Want keyword detection on full-page HTML: works
- Want in-page highlight + toast + Telegram + sound: works
- Want separate numeric and text alerts without audio chaos: works

### Installation

#### Chrome Web Store

[Install from Chrome Web Store](https://chromewebstore.google.com/detail/advanced-auto-refresher/nlbbaebjkapiehbblacfeedacioioaoc)

#### Manual installation

1. Clone or download this repository.
2. Open `chrome://extensions/`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the extension folder.

### Quick usage

#### Basic auto-refresh

1. Open the page you want to monitor.
2. Click the extension icon.
3. Set the refresh interval.
4. Optionally enable stochastic mode.
5. Click `Start`.

#### Numeric monitoring

1. Enable `Monitor number`.
2. Select an element with the picker or enter a CSS selector manually.
3. Choose the numeric alert mode.
4. Set sound and volume.

#### Text monitoring

1. Enable `Monitor text or keywords`.
2. Choose the source:
   - selected element text
   - full page text
   - full page HTML
3. Choose the text detection mode.
4. Enter keywords or phrases one per line if needed.
5. Optionally enable debug to show captured content on the page after refresh.

#### Telegram

1. Create your Telegram bot with `@BotFather`.
2. Get your `chat_id`.
3. Paste bot token and chat ID into the extension.
4. Use the Telegram test button.

### Telegram notification layout

Numeric-only example:

```text
Alert title

Value: old -> new

URL: page link

Time: local timestamp

Auto Refresh & Page Monitor with Telegram Alerts
```

Text-only example:

```text
Alert title

Preview: detected text excerpt

Source: selected element text / full page text / full page HTML

Keywords found: keyword1, keyword2

URL: page link

Time: local timestamp

Auto Refresh & Page Monitor with Telegram Alerts
```

Combined example:

```text
Alert title

Value: old -> new

Preview: detected text excerpt

Source: selected element text / full page text / full page HTML

Keywords found: keyword1, keyword2

URL: page link

Time: local timestamp

Auto Refresh & Page Monitor with Telegram Alerts
```

### Privacy

- No analytics
- No external backend
- No account required
- Settings stored locally in Chrome storage
- Telegram uses your own bot credentials directly

[Read the Privacy Policy](PRIVACY_POLICY.md)

---

## Italiano

### Perche esiste

Auto Refresh & Page Monitor with Telegram Alerts e una estensione Chrome Manifest V3 pensata per chi non vuole solo un refresh automatico, ma un vero watcher di pagina.

Pensala come uno strumento leggero ma cattivo per chi ha bisogno di segnali rapidi:

- Amazon Vine e pagine con disponibilita limitata
- Controllo stock e disponibilita
- Ticket, prenotazioni, giveaway e flash sale
- Contatori numerici che aumentano o diminuiscono
- Testo, parole chiave, frasi o cambiamenti DOM/HTML dopo il refresh

### Loop principale

```text
Scegli il target -> fai refresh -> rileva il cambio -> evidenzialo -> avvisa -> portami li
```

### Set di funzionalita

#### Motore refresh

- Intervallo personalizzato per ogni tab
- Scheduling compatibile con Manifest V3 basato su `chrome.alarms`
- Recupero migliore del countdown dopo sospensione del service worker
- Modalita stocastica opzionale per variare il refresh
- Distribuzione uniforme o gaussiana

#### Watcher numerico

- Monitoraggio di un elemento come valore numerico
- Selettore visuale oppure modalita avanzata con CSS selector
- Modalita allarme:
  - aumento
  - diminuzione
  - qualsiasi cambio numerico
  - sopra soglia
  - sotto soglia
- Suono e volume separati per il monitor numerico quando usi gli allarmi separati

#### Watcher testuale

- Funziona in parallelo al monitor numerico, non lo sostituisce
- Puoi monitorare:
  - testo dell'elemento selezionato
  - testo dell'intera pagina
  - HTML dell'intera pagina
- Modalita monitor testo:
  - qualsiasi comparsa, scomparsa o cambio testo
  - cambio stato parole chiave
  - cambio testo o parole chiave
  - solo comparsa o scomparsa parole chiave
- Parole chiave e frasi da inserire una per riga
- Suono e volume separati per il monitor testuale quando usi gli allarmi separati

#### Routing allarmi

- Modalita condivisa: un solo suono comune
- Modalita separata: numero e testo usano suoni diversi
- Se numero e testo scattano insieme, i suoni vengono messi in sequenza rapida invece di accavallarsi

#### Feedback visivo

- Highlight dell'elemento cambiato dopo il refresh
- Toast in pagina con azioni cliccabili
- Salto diretto a:
  - target numerico
  - target testuale
  - primo match di keyword quando monitori testo/HTML dell'intera pagina
- Pannello debug per vedere il contenuto realmente catturato dal monitor testo

#### Telegram

- Notifiche automatiche Telegram per cambiamenti numerici
- Notifiche automatiche Telegram anche per cambiamenti testuali e parole chiave trovate
- Se numero e testo scattano insieme, Telegram invia un solo messaggio combinato
- I messaggi Telegram seguono la lingua scelta dentro l'estensione
- Nessun backend esterno: usi direttamente il tuo bot e il tuo chat ID

#### Sicurezza / controllo

- Opzione `Ferma il refresh quando l'utente clicca sulla pagina`
- Utile quando devi interagire velocemente senza rischiare un refresh immediato

#### Controllo scope

- Blacklist per escludere URL dal refresh
- Whitelist con priorita sulla blacklist
- Supporto wildcard

#### Modalita multilingua

- English
- Italiano
- Francais
- Deutsch
- Espanol
- Portugues (Brasil)
- Polski
- Ukrainska
- العربية

### Vibe check rapido

- Vuoi solo un timer di refresh: c'e
- Vuoi allarmi numerici: c'e
- Vuoi keyword detection su HTML intera pagina: c'e
- Vuoi highlight + toast + Telegram + audio: c'e
- Vuoi numero e testo separati senza caos audio: c'e

### Installazione

#### Chrome Web Store

[Installa dal Chrome Web Store](https://chromewebstore.google.com/detail/advanced-auto-refresher/nlbbaebjkapiehbblacfeedacioioaoc)

#### Installazione manuale

1. Clona o scarica questo repository.
2. Apri `chrome://extensions/`.
3. Abilita la `Modalita sviluppatore`.
4. Clicca `Carica estensione non pacchettizzata`.
5. Seleziona la cartella dell'estensione.

### Utilizzo rapido

#### Auto-refresh base

1. Apri la pagina da monitorare.
2. Clicca l'icona dell'estensione.
3. Imposta l'intervallo di refresh.
4. Se vuoi, abilita la modalita stocastica.
5. Clicca `Avvia`.

#### Monitor numerico

1. Abilita `Monitora numero`.
2. Seleziona un elemento con il picker oppure inserisci un CSS selector manualmente.
3. Scegli la modalita allarme numerica.
4. Imposta suono e volume.

#### Monitor testuale

1. Abilita `Monitora testo o parole chiave`.
2. Scegli la sorgente:
   - testo elemento selezionato
   - testo intera pagina
   - HTML intera pagina
3. Scegli la modalita monitor testo.
4. Inserisci parole chiave o frasi una per riga se ti servono.
5. Se vuoi, abilita il debug per vedere in pagina il contenuto catturato dopo il refresh.

#### Telegram

1. Crea il bot con `@BotFather`.
2. Recupera il tuo `chat_id`.
3. Inserisci bot token e chat ID nell'estensione.
4. Usa il pulsante di test Telegram.

### Layout notifiche Telegram

Solo numero:

```text
Titolo avviso

Valore: vecchio -> nuovo

URL: link pagina

Ora: timestamp locale

Auto Refresh & Page Monitor with Telegram Alerts
```

Solo testo:

```text
Titolo avviso

Anteprima: estratto del testo rilevato

Sorgente: testo elemento selezionato / testo intera pagina / HTML intera pagina

Parole chiave trovate: keyword1, keyword2

URL: link pagina

Ora: timestamp locale

Auto Refresh & Page Monitor with Telegram Alerts
```

Numero + testo:

```text
Titolo avviso

Valore: vecchio -> nuovo

Anteprima: estratto del testo rilevato

Sorgente: testo elemento selezionato / testo intera pagina / HTML intera pagina

Parole chiave trovate: keyword1, keyword2

URL: link pagina

Ora: timestamp locale

Auto Refresh & Page Monitor with Telegram Alerts
```

### Privacy

- Nessun analytics
- Nessun backend esterno
- Nessun account richiesto
- Impostazioni salvate localmente nello storage di Chrome
- Telegram usa direttamente le tue credenziali bot

[Leggi la Privacy Policy](PRIVACY_POLICY.md)

---

## Tech Stack

- Manifest V3
- Service Worker
- Chrome Storage API
- Chrome Alarms API
- Offscreen Document per l'audio
- Content script con highlighting e debug in-page

## License

MIT

## Author

**Giulio Nicolai**

- Website: [giulionicolai.com](https://giulionicolai.com)
- Support: [Buy me a coffee](https://www.paypal.com/donate/?hosted_button_id=RZKA34HTGKGJG)
