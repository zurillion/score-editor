// Client for the piece-storage API (Netlify Function + Blobs, see
// netlify/functions/api.mts). Reads are public; writes need the admin
// password, sent as the `x-admin-key` header.
import { ScoreState } from './music/types';
import { PiecePlayback } from './music/playback';

export interface PieceSummary {
  id: string;
  title: string;
  inMenu: boolean; // shown in the editor's Libreria dropdown
}

export interface StoredPiece {
  id: string;
  title: string;
  bpm: number;
  score: ScoreState;
  playback?: PiecePlayback; // per-staff instruments / volumes / transposes
  updatedAt?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/${path}`, init);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = `${message}: ${body.error}`;
    } catch {
      /* not json */
    }
    throw new Error(message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const adminInit = (key: string, method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'x-admin-key': key, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

export async function listPieces(): Promise<PieceSummary[]> {
  return (await request<{ pieces: PieceSummary[] }>('pieces')).pieces;
}

export function getPiece(id: string): Promise<StoredPiece> {
  return request(`pieces/${id}`);
}

/** True when the given password is accepted by the server. */
export async function checkAdmin(key: string): Promise<boolean> {
  const res = await fetch('/api/auth', { headers: { 'x-admin-key': key } });
  return res.status === 204;
}

export async function createPiece(key: string, piece: { title: string; bpm: number; score: ScoreState; playback?: PiecePlayback }): Promise<string> {
  return (await request<{ id: string }>('pieces', adminInit(key, 'POST', piece))).id;
}

export function updatePiece(key: string, id: string, patch: { title?: string; bpm?: number; score?: ScoreState; playback?: PiecePlayback; inMenu?: boolean }): Promise<void> {
  return request(`pieces/${id}`, adminInit(key, 'PUT', patch));
}

export function deletePiece(key: string, id: string): Promise<void> {
  return request(`pieces/${id}`, adminInit(key, 'DELETE'));
}

export function reorderPieces(key: string, order: string[]): Promise<void> {
  return request('pieces', adminInit(key, 'PUT', { order }));
}

export interface LibraryPieceExport {
  id: string;
  title: string;
  inMenu: boolean;
  bpm: number;
  score: ScoreState;
  playback?: PiecePlayback;
  updatedAt?: string;
}

/** Replaces the entire library (pieces + order) — a restore from a backup. */
export async function replaceLibrary(key: string, pieces: LibraryPieceExport[]): Promise<number> {
  return (await request<{ count: number }>('library', adminInit(key, 'PUT', { pieces }))).count;
}

/** Shareable play-only URL for a piece. */
export function playUrl(id: string): string {
  return `${location.origin}${location.pathname}#/play/${id}`;
}
