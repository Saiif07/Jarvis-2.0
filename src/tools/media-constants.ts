/**
 * Shared constants and types for the audio/media subsystem.
 *
 * Used by: PlayAudioTool, MediaQueueTool, MiniMediaPlayer
 */
import { FileStorageTool } from './file-storage-tool';

/** AsyncStorage key for the global media queue (playlist). */
export const MEDIA_QUEUE_KEY = 'sanna_media_queue';

/** file_storage filename for per-URL position tracking. */
export const POSITIONS_FILENAME = 'audio_positions';

/** AsyncStorage key for persisted player UI state (url, status, position). */
export const AUDIO_PERSIST_KEY = 'audio_current_status';

/** A single item in the media queue. */
export interface MediaQueueItem {
  url: string;
  title: string;
  subtitle?: string;
}

/** Persisted queue shape. */
export interface StoredQueue {
  items: MediaQueueItem[];
  currentIndex: number;
}

// ---- Shared position helpers ----

/** Lazy singleton FileStorageTool for position reads. */
let _posFileStorage: FileStorageTool | null = null;
function posFileStorage(): FileStorageTool {
  if (!_posFileStorage) { _posFileStorage = new FileStorageTool(); }
  return _posFileStorage;
}

/**
 * Read saved playback position (seconds) for a URL.
 * Returns 0 if nothing saved. Shared across tools & UI.
 */
export async function getSavedPositionSeconds(url: string): Promise<number> {
  try {
    const result = await posFileStorage().execute({
      action: 'read',
      filename: POSITIONS_FILENAME,
      type: 'text',
    });
    if (result.isError || !result.forLLM.includes('Content of')) return 0;
    const contentMatch = result.forLLM.match(/Content of[^:]*:\s*(.+)/s);
    if (!contentMatch) return 0;
    const positions = JSON.parse(contentMatch[1]) as Record<string, { position_seconds: number }>;
    return positions[url]?.position_seconds ?? 0;
  } catch {
    return 0;
  }
}
