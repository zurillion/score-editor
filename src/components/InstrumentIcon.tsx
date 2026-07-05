import { ReactElement } from 'react';
import { SYNTH_ID } from '../music/instruments';

// Icons ported from Harmonium's InstrumentIcon, plus a C64-palette icon for
// the built-in "8 bit sound" synth.
const ICONS: Record<string, ReactElement> = {
  piano: (
    <svg viewBox="0 0 100 100">
      <rect fill="#333" width="100" height="100" rx="10" />
      <rect fill="#fff" x="10" y="20" width="15" height="60" />
      <rect fill="#fff" x="30" y="20" width="15" height="60" />
      <rect fill="#fff" x="50" y="20" width="15" height="60" />
      <rect fill="#fff" x="70" y="20" width="15" height="60" />
      <rect fill="#000" x="22" y="20" width="10" height="40" />
      <rect fill="#000" x="42" y="20" width="10" height="40" />
      <rect fill="#000" x="62" y="20" width="10" height="40" />
    </svg>
  ),
  organ: (
    <svg viewBox="0 0 100 100">
      <rect fill="#A95C32" width="100" height="100" rx="10" />
      <rect fill="#F2D694" x="15" y="20" width="15" height="60" rx="5" />
      <rect fill="#F2D694" x="35" y="30" width="15" height="50" rx="5" />
      <rect fill="#F2D694" x="55" y="25" width="15" height="55" rx="5" />
      <rect fill="#F2D694" x="75" y="40" width="15" height="40" rx="5" />
    </svg>
  ),
  violin: (
    <svg viewBox="0 0 100 100">
      <rect fill="#602A2A" width="100" height="100" rx="10" />
      <path d="M 50 10 C 20 30, 20 70, 50 90 C 80 70, 80 30, 50 10 Z" fill="#D2B48C" />
      <circle cx="50" cy="50" r="5" fill="#602A2A" />
      <line x1="50" y1="10" x2="50" y2="90" stroke="#441E1E" strokeWidth="4" />
    </svg>
  ),
  trumpet: (
    <svg viewBox="0 0 100 100">
      <rect fill="#B8860B" width="100" height="100" rx="10" />
      <path d="M 20 40 L 50 40 Q 60 20 80 40 L 80 60 Q 60 80 50 60 L 20 60 Z" fill="#FFD700" />
    </svg>
  ),
  flute: (
    <svg viewBox="0 0 100 100">
      <rect fill="#A0A0A0" width="100" height="100" rx="10" />
      <rect x="10" y="45" width="80" height="10" fill="#D3D3D3" rx="5" />
      <circle cx="30" cy="50" r="4" fill="#555" />
      <circle cx="50" cy="50" r="4" fill="#555" />
      <circle cx="70" cy="50" r="4" fill="#555" />
    </svg>
  ),
  'guitar-nylon': (
    <svg viewBox="0 0 100 100">
      <rect fill="#8B4513" width="100" height="100" rx="10" />
      <path d="M 50 10 L 50 90" stroke="#D2B48C" strokeWidth="4" />
      <path d="M 30 50 Q 50 30 70 50 Q 50 70 30 50 Z" fill="#F5DEB3" />
      <circle cx="50" cy="50" r="10" fill="#8B4513" />
    </svg>
  ),
  'guitar-electric': (
    <svg viewBox="0 0 100 100">
      <rect fill="#DC143C" width="100" height="100" rx="10" />
      <path d="M 50 10 L 60 40 L 80 45 L 65 60 L 70 80 L 50 65 L 30 80 L 35 60 L 20 45 L 40 40 Z" fill="#FFF" />
      <line x1="50" y1="10" x2="50" y2="65" stroke="#333" strokeWidth="4" />
    </svg>
  ),
  harmonium: (
    <svg viewBox="0 0 100 100">
      <rect fill="#6D4C41" width="100" height="100" rx="10" />
      <rect fill="#4E342E" x="15" y="28" width="70" height="20" rx="4" />
      <rect fill="#FFF" x="18" y="54" width="64" height="18" rx="3" />
      <rect fill="#000" x="26" y="54" width="6" height="11" />
      <rect fill="#000" x="40" y="54" width="6" height="11" />
      <rect fill="#000" x="54" y="54" width="6" height="11" />
      <rect fill="#000" x="68" y="54" width="6" height="11" />
    </svg>
  ),
  'guitar-acoustic': (
    <svg viewBox="0 0 100 100">
      <rect fill="#A0522D" width="100" height="100" rx="10" />
      <path d="M 50 10 L 50 90" stroke="#F5DEB3" strokeWidth="4" />
      <path d="M 28 52 Q 50 28 72 52 Q 50 76 28 52 Z" fill="#DEB887" />
      <circle cx="50" cy="52" r="9" fill="#5C3317" />
    </svg>
  ),
  'bass-electric': (
    <svg viewBox="0 0 100 100">
      <rect fill="#1A237E" width="100" height="100" rx="10" />
      <path d="M 55 15 L 62 45 L 78 52 L 60 62 L 62 82 L 45 68 L 32 78 L 38 58 L 25 48 L 45 42 Z" fill="#ECEFF1" />
      <line x1="55" y1="15" x2="52" y2="68" stroke="#333" strokeWidth="5" />
    </svg>
  ),
  cello: (
    <svg viewBox="0 0 100 100">
      <rect fill="#5C3317" width="100" height="100" rx="10" />
      <path d="M 50 12 C 24 32, 24 72, 50 92 C 76 72, 76 32, 50 12 Z" fill="#B8763B" />
      <line x1="50" y1="12" x2="50" y2="92" stroke="#3E2210" strokeWidth="4" />
      <path d="M 40 45 Q 43 52 40 59" stroke="#3E2210" strokeWidth="2" fill="none" />
      <path d="M 60 45 Q 57 52 60 59" stroke="#3E2210" strokeWidth="2" fill="none" />
    </svg>
  ),
  contrabass: (
    <svg viewBox="0 0 100 100">
      <rect fill="#3E2723" width="100" height="100" rx="10" />
      <path d="M 50 8 C 20 30, 20 74, 50 94 C 80 74, 80 30, 50 8 Z" fill="#8D5524" />
      <line x1="50" y1="8" x2="50" y2="94" stroke="#2A1810" strokeWidth="5" />
    </svg>
  ),
  harp: (
    <svg viewBox="0 0 100 100">
      <rect fill="#B8860B" width="100" height="100" rx="10" />
      <path d="M 25 85 L 25 30 Q 45 8 75 20 L 75 85 Z" fill="none" stroke="#FFD700" strokeWidth="6" />
      <line x1="35" y1="24" x2="35" y2="85" stroke="#FFF8DC" strokeWidth="2" />
      <line x1="45" y1="18" x2="45" y2="85" stroke="#FFF8DC" strokeWidth="2" />
      <line x1="55" y1="16" x2="55" y2="85" stroke="#FFF8DC" strokeWidth="2" />
      <line x1="65" y1="17" x2="65" y2="85" stroke="#FFF8DC" strokeWidth="2" />
    </svg>
  ),
  saxophone: (
    <svg viewBox="0 0 100 100">
      <rect fill="#8B6914" width="100" height="100" rx="10" />
      <path d="M 62 15 L 62 60 Q 62 80 45 78 Q 30 76 32 62" stroke="#FFD700" strokeWidth="8" fill="none" strokeLinecap="round" />
      <circle cx="62" cy="30" r="3" fill="#8B6914" />
      <circle cx="62" cy="42" r="3" fill="#8B6914" />
    </svg>
  ),
  clarinet: (
    <svg viewBox="0 0 100 100">
      <rect fill="#37474F" width="100" height="100" rx="10" />
      <rect x="44" y="12" width="12" height="60" rx="4" fill="#212121" />
      <path d="M 44 72 Q 50 88 62 84 L 56 70 Z" fill="#212121" />
      <circle cx="50" cy="28" r="3" fill="#B0BEC5" />
      <circle cx="50" cy="42" r="3" fill="#B0BEC5" />
      <circle cx="50" cy="56" r="3" fill="#B0BEC5" />
    </svg>
  ),
  bassoon: (
    <svg viewBox="0 0 100 100">
      <rect fill="#4E342E" width="100" height="100" rx="10" />
      <rect x="40" y="10" width="9" height="75" rx="4" fill="#8D6E63" />
      <rect x="52" y="20" width="9" height="70" rx="4" fill="#A1887F" />
      <line x1="49" y1="30" x2="60" y2="26" stroke="#CFD8DC" strokeWidth="3" />
    </svg>
  ),
  'french-horn': (
    <svg viewBox="0 0 100 100">
      <rect fill="#7B5E00" width="100" height="100" rx="10" />
      <circle cx="50" cy="55" r="24" fill="none" stroke="#FFD700" strokeWidth="7" />
      <path d="M 30 30 Q 50 20 72 40" stroke="#FFD700" strokeWidth="5" fill="none" />
      <path d="M 68 70 L 84 82" stroke="#FFD700" strokeWidth="10" strokeLinecap="round" />
    </svg>
  ),
  trombone: (
    <svg viewBox="0 0 100 100">
      <rect fill="#8A6D1B" width="100" height="100" rx="10" />
      <line x1="15" y1="42" x2="72" y2="42" stroke="#FFD700" strokeWidth="6" />
      <line x1="15" y1="58" x2="72" y2="58" stroke="#FFD700" strokeWidth="6" />
      <path d="M 72 30 Q 90 50 72 70" stroke="#FFD700" strokeWidth="7" fill="none" />
    </svg>
  ),
  tuba: (
    <svg viewBox="0 0 100 100">
      <rect fill="#6B5310" width="100" height="100" rx="10" />
      <circle cx="50" cy="62" r="26" fill="#FFD700" />
      <circle cx="50" cy="62" r="16" fill="#6B5310" />
      <path d="M 50 12 Q 66 20 62 40" stroke="#FFD700" strokeWidth="7" fill="none" />
    </svg>
  ),
  xylophone: (
    <svg viewBox="0 0 100 100">
      <rect fill="#455A64" width="100" height="100" rx="10" />
      <rect x="14" y="25" width="12" height="55" rx="3" fill="#EF5350" />
      <rect x="30" y="30" width="12" height="45" rx="3" fill="#FFA726" />
      <rect x="46" y="35" width="12" height="35" rx="3" fill="#FFEE58" />
      <rect x="62" y="40" width="12" height="25" rx="3" fill="#66BB6A" />
      <rect x="78" y="45" width="10" height="15" rx="3" fill="#42A5F5" />
    </svg>
  ),
  // Pixel eighth-note on the classic Commodore 64 blue.
  [SYNTH_ID]: (
    <svg viewBox="0 0 100 100">
      <rect fill="#40318D" width="100" height="100" rx="10" />
      <rect fill="#7869C4" x="10" y="10" width="80" height="80" rx="4" />
      <rect fill="#40318D" x="16" y="16" width="68" height="68" />
      <rect fill="#A5A5FF" x="44" y="24" width="8" height="44" />
      <rect fill="#A5A5FF" x="52" y="24" width="12" height="8" />
      <rect fill="#A5A5FF" x="60" y="32" width="8" height="12" />
      <rect fill="#A5A5FF" x="28" y="60" width="16" height="14" />
      <rect fill="#A5A5FF" x="24" y="64" width="8" height="8" />
    </svg>
  ),
};

/** Small square icon for an instrument id (null if unknown). */
export function InstrumentIcon({ id }: { id: string }) {
  const icon = ICONS[id];
  if (!icon) return null;
  return <span className="inst-icon">{icon}</span>;
}
