import { ScoreState } from '../music/types';
import { scoreMeta } from '../music/meta';
import { layoutSystems } from '../music/layout';
import { layoutStaves, scoreStaves } from '../music/staves';
import { resolveTies } from '../music/ties';
import { System } from './System';

const noop = () => {};

/**
 * Non-interactive thumbnail of a piece: its first measures on one system,
 * scaled down to fit the given width (the admin list previews).
 */
export function MiniScore({ score, measures = 3, width = 300 }: { score: ScoreState; measures?: number; width?: number }) {
  const truncated: ScoreState = { ...score, measures: score.measures.slice(0, measures) };
  const meta = scoreMeta(truncated);
  const systems = layoutSystems(truncated.measures, meta.measures, 'horizontal', width);
  const stavesLayout = layoutStaves(scoreStaves(truncated));
  const sys = systems[0];
  if (!sys) return null;
  const scale = Math.min(width / sys.width, 0.62);
  return (
    <div className="mini-score" style={{ width, height: Math.ceil(stavesLayout.height * scale) }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <System
          layout={sys}
          stavesLayout={stavesLayout}
          headerTs={sys.headerTs}
          headerKeySig={sys.headerKeySig}
          showTimeSig
          diagonalBeams
          tool={{ kind: 'select-measures' }}
          duration={{ value: 4, dots: 0 }}
          previewOnCreate={false}
          selection={null}
          playheadX={null}
          showHandle={false}
          playOnly
          onAction={noop}
          onAfterApply={noop}
          onPreviewNote={noop}
          onSetCursor={noop}
          onHoverNote={noop}
          ties={resolveTies(truncated, meta)}
        />
      </div>
    </div>
  );
}
