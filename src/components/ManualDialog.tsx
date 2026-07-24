/**
 * The application manual: a modal reachable from the "?" button next to the
 * Options gear. One <details> section per feature area.
 *
 * KEEP THIS UP TO DATE: whenever a feature is added or changed, update the
 * relevant section here (and the README) in the same commit.
 */

interface ManualDialogProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: [string, string][] = [
  ['1 – 6', 'durata: intero, metà, quarto, ottavo, sedicesimo, trentaduesimo'],
  ['.', 'strumento punto di valore (ripremere per tornare alle note)'],
  ['R', 'alterna Note / Pause'],
  ['E', 'gomma (ripremere per tornare alle note)'],
  ['Esc', 'torna allo strumento Note / chiude l’input di accordi e testi'],
  ['Spazio', 'play / stop'],
  ['← →', 'sposta il cursore di un sedicesimo · con Alt: di una battuta · con Ctrl: di un rigo di sistema'],
  ['↑ ↓', 'traspone le note selezionate di un semitono'],
  ['⌘/Ctrl + C', 'copia la selezione (battute o lazo note, con sigle e testi delle righe copiate)'],
  ['⌘/Ctrl + X', 'taglia la selezione'],
  ['⌘/Ctrl + V', 'incolla al punto di inserimento'],
  ['Backspace / Canc', 'elimina la selezione'],
  ['⌘/Ctrl + Z', 'annulla (anche il «✚ Nuovo»: recupera il brano intero)'],
  ['Alt + clic su una nota', 'la elimina (con qualunque strumento)'],
];

export function ManualDialog({ open, onClose }: ManualDialogProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal manual" role="dialog" aria-modal="true" aria-label="Manuale" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Manuale di Score Composer</h2>
          <button className="modal-close" onClick={onClose} aria-label="Chiudi">
            ✕
          </button>
        </header>

        <div className="modal-body manual-body">
          <details open>
            <summary>Panoramica</summary>
            <p>
              Score Composer è un editor di spartiti con riproduzione integrata. Si parte da un <strong>endecalineo</strong> (violino +
              basso con graffa) e si possono aggiungere altri righi, batterie incluse. Due viste: <strong>Orizzontale</strong> (un rigo
              unico che scorre) e <strong>Pagina</strong> (le battute vanno a capo in più sistemi).
            </p>
            <p>
              Il brano in lavorazione è <strong>salvato di continuo nel browser</strong>: chiudendo o ricaricando la pagina si riparte da
              dove si era. Il pulsante <strong>✚ Nuovo</strong> nell’intestazione chiude il brano corrente (con conferma) e ne inizia uno
              vuoto; un <kbd>⌘Z</kbd> subito dopo lo recupera per intero (note, titolo, BPM, mixer).
            </p>
          </details>

          <details>
            <summary>Note e pause</summary>
            <ul>
              <li>
                Nella palette scegli <strong>Note</strong> o <strong>Pause</strong> e la <strong>durata</strong>; i <strong>punti</strong> di
                valore si aggiungono con lo strumento punto (o tasto <kbd>.</kbd>).
              </li>
              <li>
                Muovendo il mouse sul rigo appare l’<strong>anteprima</strong>: grigio = inserisce, blu = aggiunge al’accordo, rosso =
                elimina, azzurro = cambia il valore della nota.
              </li>
              <li>Clic su spazio libero → nuova nota; clic su una nota ad altra altezza nello stesso punto → <strong>accordo</strong>.</li>
              <li>
                Clic su una nota esistente con una <strong>durata diversa</strong> → ne cambia il valore, se lo spazio a destra lo consente
                (accorciando compare una pausa; allungando può «mangiare» pause, mai note). Clic con la stessa durata → la elimina.
              </li>
              <li>Con lo strumento pausa, il clic su una nota di pari valore la sostituisce; la gomma cancella anche le pause inserite.</li>
              <li>Trascina una nota in verticale per cambiarne l’altezza; <kbd>Alt</kbd>+clic la elimina al volo.</li>
              <li>
                <strong>Battute</strong>: «+» aggiunge in coda, il pulsante «+▤» inserisce N battute vuote al punto di inserimento;
                divisione (2/4 … 12/8), tonalità e <strong>anacrusi</strong> (battuta in levare) si impostano dalla toolbar e valgono dal
                punto attivo in poi.
              </li>
            </ul>
          </details>

          <details>
            <summary>Strumenti della palette</summary>
            <p>
              Gli strumenti «one-shot» seguono tutti la stessa convenzione: <strong>1 click</strong> = si applica una volta e si torna alle
              note; <strong>doppio click</strong> = resta fisso finché non lo si disattiva.
            </p>
            <ul>
              <li><strong>Freccia</strong> — non crea note: trascina una nota per intonarla; clic nel vuoto sposta il cursore di playback/inserimento.</li>
              <li><strong>Alterazioni</strong> (𝄫 ♭ ♮ ♯ 𝄪) — clic su una nota; l’anteprima suona con lo strumento del suo rigo.</li>
              <li><strong>Gomma</strong> — elimina note e pause (tasto <kbd>E</kbd>).</li>
              <li><strong>Punto</strong> — imposta i punti di valore di una nota esistente.</li>
              <li><strong>Terzina</strong> — trasforma una nota nel primo elemento di una terzina.</li>
              <li>
                <strong>Legatura di valore</strong> — clic su una nota per legarla alla successiva della stessa altezza (anche tra battute);
                nel playback suonano come un’unica nota.
              </li>
              <li>
                <strong>Accordo</strong> (C⁷) — scrive il nome dell’accordo <em>sotto il rigo su cui si clicca</em>: ogni rigo può avere la
                sua linea di accordi (griglia di ottavi, testo centrato). Clic su una sigla esistente per modificarla; testo vuoto la
                elimina.
              </li>
              <li>
                <strong>Testo</strong> (T) — testo libero <em>sopra</em> un rigo (didascalie, in corsivo) o <em>sotto</em> (testo della
                canzone): parte dal punto cliccato e si sviluppa verso destra. Gli <strong>spazi iniziali sono conservati</strong>, utili
                per l’allineamento fine delle sillabe. Se sotto lo stesso rigo ci sono anche gli accordi, questi scendono <em>sotto</em> il
                testo.
              </li>
              <li><strong>Arpeggio</strong> — trascina in verticale sulle note da arpeggiare (anche su entrambi i righi: rullano insieme dal grave all’acuto); ripetere il gesto lo toglie.</li>
              <li><strong>Staccato</strong> — puntino di staccato su nota o accordo; suona una frazione della durata (regolabile nelle Opzioni).</li>
              <li>
                <strong>Ritornello</strong> — clic a sinistra della battuta per «|:», a destra per «:|». Trascinando in verticale sul segno
                di inizio si imposta il numero di esecuzioni; sotto l’1 diventa <strong>∞</strong> (loop). Doppio clic su un segno per
                eliminarlo.
              </li>
              <li><strong>Lazo note</strong> e <strong>Seleziona battute</strong> — selezioni per copia/taglia/incolla/elimina.</li>
            </ul>
          </details>

          <details>
            <summary>Righi e mixer</summary>
            <ul>
              <li>
                L’icona del <strong>mixer</strong> apre il pannello dei righi: per ciascuno <strong>strumento</strong> (prioritario su
                quello generale), <strong>volume</strong>, <strong>M</strong> (mute) e <strong>S</strong> (solo: con più S premuti suonano
                tutti gli S), <strong>trasposizione</strong> in semitoni, <strong>canale MIDI</strong> («—» usa quello generale) e, per i
                righi extra, <strong>chiave</strong> e <strong>tonalità propria</strong> («= brano» segue il brano). I controlli agiscono
                <em>in tempo reale</em> anche durante il playback.
              </li>
              <li>
                <strong>+ Rigo</strong>, <strong>+ Endecalineo</strong> e <strong>+ Batteria</strong> aggiungono righi sopra o sotto; ogni
                rigo si può <strong>mostrare/nascondere</strong> (nascosto continua a suonare) e si <strong>riordina trascinando</strong> la
                maniglia ⋮⋮ (i due righi di un endecalineo si muovono insieme).
              </li>
              <li>La <strong>trasposizione generale</strong> in fondo al mixer si somma a quelle di rigo.</li>
              <li>Il mixer (solo parte audio) c’è anche nella pagina di ascolto condivisa.</li>
            </ul>
          </details>

          <details>
            <summary>Batteria</summary>
            <ul>
              <li>
                «+ Batteria» aggiunge un rigo di percussione (chiave neutra, senza armatura). Il menu <strong>Batteria</strong> nella
                palette sceglie la voce: grancassa, rullante, rim shot, hi-hat chiuso/aperto/pedale, crash, ride, tom alto/medio/basso.
              </li>
              <li>Ogni voce va alla sua posizione standard con la testa corretta (✕ hi-hat e piatti, ⊗ rim shot); più voci sullo stesso movimento si impilano su un gambo unico.</li>
              <li>Trascinare una nota di batteria la sposta sulla <em>voce</em> più vicina (mai su una nota intonata).</li>
              <li>
                Nel mixer si sceglie il <strong>kit</strong>: <strong>Sintetico</strong> (offline) o <strong>Acustico</strong> (campioni
                reali inclusi nell’app); accanto al selettore un indicatore mostra lo stato dei campioni (✓ pronti).
              </li>
              <li>Sull’uscita MIDI le voci viaggiano sul <strong>canale 10</strong> con le note General-MIDI.</li>
            </ul>
          </details>

          <details>
            <summary>Riproduzione e strumenti</summary>
            <ul>
              <li><strong>▶ Play / ■ Stop</strong> (o <kbd>Spazio</kbd>); <strong>BPM</strong> regolabile anche durante il playback; <strong>Loop</strong> con opzione anacrusi solo alla prima ripetizione.</li>
              <li>Il <strong>cursore</strong> segue le note con auto-scroll; con la Freccia (o le frecce della tastiera) lo si posiziona dove ripartire.</li>
              <li>
                Lo <strong>strumento generale</strong> si sceglie accanto al Play (piano, archi, fiati, chitarre, … o il synth «8 bit
                sound»); i campioni si scaricano al primo uso. Ogni rigo può sovrascriverlo dal mixer.
              </li>
              <li>«Suona la nota all’inserimento» (nelle Opzioni della toolbar) fa sentire ogni nota inserita con lo strumento, volume e trasposizione del suo rigo.</li>
              <li>I <strong>ritornelli</strong> vengono espansi nel playback (audio e MIDI); una sezione ∞ va in loop.</li>
              <li>Con il gruppo <strong>MIDI</strong> attivo il brano esce su un dispositivo MIDI esterno (canale generale + canali per rigo dal mixer).</li>
            </ul>
          </details>

          <details>
            <summary>Copia, incolla e annulla</summary>
            <ul>
              <li><strong>Seleziona battute</strong>: trascina sulle battute; copia/taglia intere battute (con sigle e testi) e le incolla al cursore come battute nuove.</li>
              <li>
                <strong>Lazo note</strong>: rettangolo sulle note; l’incolla ricrea le note al punto di inserimento spostando a destra ciò
                che c’è già, e porta con sé <strong>sigle e testi</strong> delle righe comprese nella selezione (l’endecalineo conta come
                una riga sola).
              </li>
              <li><kbd>⌘Z</kbd> annulla qualunque modifica allo spartito, sigle e testi compresi.</li>
            </ul>
          </details>

          <details>
            <summary>Salvataggio, libreria e condivisione</summary>
            <ul>
              <li><strong>⤓ Salva</strong> scarica il brano in <strong>JSON</strong> (tutto compreso: righi, mixer, sigle, testi) o in <strong>MusicXML</strong>; <strong>⤒ Carica</strong> riapre entrambi.</li>
              <li>L’<strong>autosalvataggio</strong> nel browser protegge il lavoro corrente; per archiviare o condividere usa Salva o la libreria.</li>
              <li>Il menu <strong>Libreria</strong> apre i brani pubblicati nella lista condivisa.</li>
              <li>
                La pagina <strong>Gestione brani</strong> (link in alto; richiede la password, ricordata sul browser fino al Logout)
                permette di aggiungere il brano corrente, <strong>⤴ Aggiornare</strong> un brano esistente con la versione corrente
                (il link di condivisione resta lo stesso), rinominare, riordinare, eliminare, importare/esportare singoli brani o
                l’intera libreria e copiare il <strong>link di solo ascolto</strong>. Il campo <strong>🔍 Cerca</strong> filtra la lista
                per nome in tempo reale (durante la ricerca il riordino ↑↓ è sospeso).
              </li>
              <li>
                La pagina di ascolto condivisa mostra partitura, trasporto e mixer audio, senza strumenti di modifica; la scheda del
                browser prende il <strong>titolo del brano</strong> (come l’editor col brano corrente). Il link di condivisione
                (<code>/p/…</code>) incorpora il titolo anche nell’<strong>anteprima</strong> di WhatsApp, Telegram e social.
              </li>
            </ul>
          </details>

          <details>
            <summary>Opzioni</summary>
            <ul>
              <li><strong>Travature diagonali</strong> — travature inclinate secondo l’andamento delle note.</li>
              <li><strong>Anacrusi solo alla prima ripetizione</strong> — nel loop la battuta in levare suona solo la prima volta.</li>
              <li><strong>Velocità dell’arpeggiato</strong> e <strong>durata dello staccato</strong>.</li>
            </ul>
          </details>

          <details>
            <summary>Scorciatoie da tastiera</summary>
            <table className="manual-shortcuts">
              <tbody>
                {SHORTCUTS.map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <kbd>{k}</kbd>
                    </td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      </div>
    </div>
  );
}
