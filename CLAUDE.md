# Score Composer — istruzioni per Claude

App React + Vite + TypeScript: editor di spartiti con riproduzione Web Audio/MIDI.
Lingua dell'interfaccia e dei commit: **italiano**.

## Regole di lavoro

- Si lavora e si pusha direttamente su `main` (richiesta esplicita dell'utente).
- Ogni funzionalità: implementare → verificare con E2E Playwright → `npm run build` → commit (messaggio in italiano) → push.

## MANUALE UTENTE — da tenere aggiornato

Il manuale dell'app è `src/components/ManualDialog.tsx` (aperto dal pulsante «?»
accanto all'ingranaggio delle Opzioni, e dal footer).

**Ogni volta che si aggiunge o si modifica una funzionalità visibile
all'utente, aggiornare NELLO STESSO COMMIT:**

1. la sezione pertinente di `src/components/ManualDialog.tsx` (comprese le
   scorciatoie nella tabella `SHORTCUTS` se cambiano);
2. il `README.md` (sezione «Funzionalità» e, se serve, «Scorciatoie da tastiera»).

## Note tecniche ricorrenti

- Modello a tick: `TICKS_PER_QUARTER = 192`; posizioni verticali diatoniche
  (Do centrale = 28).
- Multi-rigo: `ScoreState.staves` (alto→basso); righe di rendering in
  `layoutStaves` (`src/music/staves.ts`); sigle accordi (`Measure.chords`) e
  testi (`Measure.texts`) appartengono a un rigo (`staff`), con fallback
  legacy delle sigle sul rigo più in basso al LOAD.
- La cronologia di undo (`historyReducer`) traccia solo lo ScoreState:
  titolo/BPM/mixer vivono in stati React separati in `App.tsx`.
- Autosave del brano in `localStorage` (`autosave.piece`); password admin in
  `localStorage` (`admin.key`).
- E2E: script Playwright nello scratchpad della sessione; Vite su
  `127.0.0.1:5199` (da `/home/user/score-editor`), harness API su `:8788`
  (`api-server.mjs`, password `testpass123`). Nel sandbox il browser non può
  scaricare campioni remoti (usare il synth `8bit` o asset same-origin).
