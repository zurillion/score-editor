import { useCallback, useEffect, useRef, useState } from 'react';
import { StoredPiece, getPiece } from '../api';
import { Player } from '../music/audio';
import { DEFAULT_INSTRUMENT_ID, INSTRUMENTS, ensureInstrument, getLoadedSampler, isSynth } from '../music/instruments';
import { PiecePlayback, defaultPlayback, effectiveInstrumentId, sanitizePlayback, staffGain, staffTranspose } from '../music/playback';
import { scoreStaves } from '../music/staves';
import { InstrumentIcon } from './InstrumentIcon';
import { MixerPanel } from './MixerPanel';
import { Score } from './Score';

/**
 * Listen-only view for a shared piece (#/play/:id): the score plus the
 * transport controls, with every editing affordance removed. Clicking the
 * score just repositions the playback cursor.
 */
export function PlayPage({ id }: { id: string }) {
  const [piece, setPiece] = useState<StoredPiece | null>(null);
  const [piecePlayback, setPiecePlayback] = useState<PiecePlayback>(() => defaultPlayback(''));
  const [error, setError] = useState<string | null>(null);

  const [bpm, setBpm] = useState(96);
  const [loop, setLoop] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadTick, setPlayheadTick] = useState<number | null>(null);
  const [cursorTick, setCursorTick] = useState(0);
  const playerRef = useRef<Player | null>(null);
  const playheadTickRef = useRef<number | null>(null);
  const playReqRef = useRef(0);

  const [instrument, setInstrument] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('opt.instrument');
      return stored && INSTRUMENTS.some((i) => i.id === stored) ? stored : DEFAULT_INSTRUMENT_ID;
    } catch {
      return DEFAULT_INSTRUMENT_ID;
    }
  });
  const [instrumentLoading, setInstrumentLoading] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);
  useEffect(() => {
    if (isSynth(instrument)) return;
    let alive = true;
    setInstrumentLoading(true);
    ensureInstrument(instrument)
      .catch(() => {})
      .finally(() => {
        if (alive) setInstrumentLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [instrument]);

  useEffect(() => {
    let alive = true;
    getPiece(id)
      .then((p) => {
        if (!alive) return;
        setPiece(p);
        setBpm(p.bpm);
        const pb = sanitizePlayback(p.playback) ?? defaultPlayback('');
        setPiecePlayback(pb);
        if (pb.instrument) setInstrument(pb.instrument); // '—' keeps the listener's choice
      })
      .catch(() => alive && setError('Brano non trovato (il link potrebbe non essere più valido).'));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (playerRef.current?.playing) playerRef.current.setBpm(bpm);
  }, [bpm]);

  // push mixer changes (volume, M/S, transpose, instrument) into a running player
  const [samplersReady, setSamplersReady] = useState(0);
  useEffect(() => {
    if (!piece) return;
    const pb: PiecePlayback = { ...piecePlayback, instrument };
    const ids = scoreStaves(piece.score).map((s) => s.id);
    // fetch any sampled instrument the routing now needs; re-sync once loaded
    for (const iid of new Set(ids.map((s) => effectiveInstrumentId(pb, s)))) {
      if (!isSynth(iid) && !getLoadedSampler(iid)) void ensureInstrument(iid).then(() => setSamplersReady((n) => n + 1)).catch(() => {});
    }
    if (!playerRef.current) return;
    playerRef.current.staves = Object.fromEntries(
      ids.map((s) => {
        const iid = effectiveInstrumentId(pb, s);
        return [s, { sampler: isSynth(iid) ? null : getLoadedSampler(iid), gain: staffGain(pb, s), transpose: staffTranspose(pb, s) }];
      }),
    );
  }, [piece, piecePlayback, instrument, samplersReady]);

  const handleStop = useCallback(() => {
    playReqRef.current++;
    playerRef.current?.stop();
    const at = playheadTickRef.current;
    playheadTickRef.current = null;
    if (at !== null) setCursorTick(Math.max(0, Math.round(at)));
    setIsPlaying(false);
    setPlayheadTick(null);
  }, []);

  const handlePlay = useCallback(async () => {
    if (!piece) return;
    const pb: PiecePlayback = { ...piecePlayback, instrument };
    const staffIds = scoreStaves(piece.score).map((s) => s.id);
    const need = [...new Set(staffIds.map((s) => effectiveInstrumentId(pb, s)).filter((id) => !isSynth(id)))];
    if (need.length > 0) {
      const req = ++playReqRef.current;
      setInstrumentLoading(true);
      try {
        await Promise.all(need.map((id) => ensureInstrument(id)));
      } catch {
        window.alert('Impossibile scaricare i campioni di uno degli strumenti.\nControlla la connessione, oppure scegli "8 bit sound".');
        return;
      } finally {
        setInstrumentLoading(false);
      }
      if (req !== playReqRef.current) return; // stop pressed while loading
    }
    const player = playerRef.current ?? new Player();
    playerRef.current = player;
    player.staves = Object.fromEntries(
      staffIds.map((s) => {
        const iid = effectiveInstrumentId(pb, s);
        return [s, { sampler: isSynth(iid) ? null : getLoadedSampler(iid), gain: staffGain(pb, s), transpose: staffTranspose(pb, s) }];
      }),
    );
    player.loop = loop;
    player.onTick = (tick) => {
      playheadTickRef.current = tick;
      setPlayheadTick(tick);
    };
    player.onEnd = () => {
      playheadTickRef.current = null;
      setIsPlaying(false);
      setPlayheadTick(null);
      setCursorTick(0);
    };
    player.play(piece.score, bpm, Math.max(0, Math.round(cursorTick)));
    setIsPlaying(true);
  }, [piece, piecePlayback, bpm, loop, cursorTick, instrument]);

  useEffect(
    () => () => {
      playerRef.current?.stop();
    },
    [],
  );

  // spacebar = play / stop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      e.preventDefault();
      isPlaying ? handleStop() : void handlePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPlaying, handlePlay, handleStop]);

  const handleSetLoop = (v: boolean) => {
    setLoop(v);
    if (playerRef.current) playerRef.current.loop = v;
  };

  const noop = useCallback(() => {}, []);

  return (
    <div className="app play-page">
      <header className="app-header">
        <h1>Score Composer</h1>
        <span className="subtitle">ascolto</span>
        {piece && <span className="piece-name">{piece.title}</span>}
      </header>

      <div className="toolbar play-toolbar">
        <fieldset className="group transport">
          <legend>Playback{instrumentLoading ? ' · carico strumento…' : ''}</legend>
          <div className="btn-row">
            <button onClick={() => setCursorTick(0)} title="Torna all'inizio del brano" aria-label="Torna all'inizio" disabled={!piece}>
              ⏮
            </button>
            <button className={`play ${isPlaying ? 'stop' : ''}`} onClick={isPlaying ? handleStop : handlePlay} disabled={!piece}>
              {isPlaying ? '■ Stop' : '▶ Play'}
            </button>
            <label className="instrument" title="Strumento usato dal playback">
              <InstrumentIcon id={instrument} />
              <select
                value={instrument}
                onChange={(e) => {
                  setInstrument(e.target.value);
                  try {
                    localStorage.setItem('opt.instrument', e.target.value);
                  } catch {
                    /* ignore */
                  }
                  e.currentTarget.blur();
                }}
                disabled={isPlaying}
                aria-label="Strumento"
              >
                {INSTRUMENTS.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
            {piece && (
              <MixerPanel
                open={mixerOpen}
                onToggle={() => setMixerOpen(!mixerOpen)}
                playback={{ ...piecePlayback, instrument }}
                onChange={(pb) => setPiecePlayback(pb)}
                staves={scoreStaves(piece.score)}
                manage={false}
              />
            )}
            <button className={loop ? 'on' : ''} onClick={() => handleSetLoop(!loop)} title="Ripeti il brano in loop">
              ↻ Loop
            </button>
            <label className="bpm">
              BPM
              <input
                type="number"
                min={30}
                max={300}
                value={bpm}
                onChange={(e) => setBpm(Math.max(30, Math.min(300, Number(e.target.value) || 0)))}
              />
            </label>
            <input type="range" min={30} max={300} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} aria-label="BPM" />
          </div>
        </fieldset>
      </div>

      {error && <div className="page-message">{error}</div>}
      {!error && !piece && <div className="page-message">Caricamento…</div>}
      {piece && (
        <Score
          state={piece.score}
          mode="page"
          tool={{ kind: 'select-measures' }}
          duration={{ value: 4, dots: 0 }}
          diagonalBeams
          previewOnCreate={false}
          selection={null}
          playheadTick={playheadTick}
          cursorTick={cursorTick}
          playOnly
          onAction={noop}
          onAfterApply={noop}
          onPreviewNote={noop}
          onSelectMeasures={noop}
          onSelectNotes={noop}
          onClearSelection={noop}
          onSetCursor={(t) => setCursorTick(Math.max(0, t))}
          onHoverNote={noop}
          onLayout={noop}
          drumVoiceId="snare"
        />
      )}

      <footer className="hint">
        Clicca sulla partitura per spostare il punto di partenza · <kbd>Spazio</kbd> play/stop.
      </footer>
    </div>
  );
}
