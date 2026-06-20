import { Duration } from '../music/types';
import { diatonicToY, TREBLE_MIDDLE } from '../music/layout';
import { SMUFL } from '../music/smufl';
import { GLYPH_FONT_SIZE, HALF_SPACE } from '../music/constants';

interface RestViewProps {
  duration: Duration;
  x: number;
  color: string;
  opacity?: number;
}

export function RestView({ duration, x, color, opacity = 1 }: RestViewProps) {
  const y = diatonicToY(TREBLE_MIDDLE); // rests sit on the treble middle line
  const glyph = SMUFL.rests[duration.value];
  const dotY = y - HALF_SPACE;
  return (
    <g opacity={opacity}>
      <text x={x} y={y} textAnchor="middle" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill={color}>
        {glyph}
      </text>
      {Array.from({ length: duration.dots }).map((_, k) => (
        <circle key={k} cx={x + 10 + k * 5} cy={dotY} r={2.1} fill={color} />
      ))}
    </g>
  );
}
