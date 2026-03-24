/**
 * MediaQueueTool – Manage a global audio playlist/queue with auto-play
 *
 * Actions:
 *   set        – Set entire queue and auto-play currentIndex item
 *   get        – Get current queue and index
 *   clear      – Clear queue and stop playback
 *   set_index  – Jump to index and auto-play
 *   next       – Advance to next and auto-play
 *   prev       – Go to previous and auto-play
 *
 * Auto-play: set/set_index/next/prev automatically start playback via
 * AudioPlayerModule. Position restore is handled the same way as PlayAudioTool.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Tool, ToolResult } from './types';
import { errorResult, successResult } from './types';
import AudioPlayerModule from '../native/AudioPlayerModule';
import { MEDIA_QUEUE_KEY, getSavedPositionSeconds, type StoredQueue, type MediaQueueItem } from './media-constants';

type Action = 'set' | 'get' | 'clear' | 'set_index' | 'next' | 'prev';

export class MediaQueueTool implements Tool {
  constructor() {}


  name(): string {
    return 'media_queue';
  }

  description(): string {
    return (
      'Manage a global audio playlist (queue) with automatic playback. ' +
      'Actions: set (replace queue & play), get, clear (stop & clear), ' +
      'set_index (jump & play), next (advance & play), prev (back & play). ' +
      'Items: { url, title, subtitle? }. ' +
      'Use this instead of play_audio when playing from a list (e.g. podcast episodes).'
    );
  }

  parameters(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['set', 'get', 'clear', 'set_index', 'next', 'prev'],
          description:
            'set: replace entire queue and auto-play the currentIndex item. ' +
            'get: read current queue. ' +
            'clear: stop playback and empty queue. ' +
            'set_index: jump to index and auto-play. ' +
            'next/prev: move within queue and auto-play (wraps around).',
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              title: { type: 'string' },
              subtitle: { type: 'string' },
            },
            required: ['url', 'title'],
          },
          description: 'Array of media items for action=set.',
        },
        currentIndex: {
          type: 'number',
          description: 'Optional initial index for action=set (defaults to 0).',
        },
        index: {
          type: 'number',
          description: 'Target index for action=set_index.',
        },
      },
      required: ['action'],
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const action = args.action as Action;
    try {
      switch (action) {
        case 'set': {
          const items = (args.items as unknown) as MediaQueueItem[] | undefined;
          const initialIndex = (args.currentIndex as number | undefined) ?? 0;
          if (!Array.isArray(items) || items.length === 0) {
            return errorResult('media_queue.set requires non-empty "items" array');
          }
          const sanitized = items
            .filter(it => it && typeof it.url === 'string' && typeof it.title === 'string')
            .map(it => ({
              url: String(it.url),
              title: String(it.title),
              subtitle: typeof it.subtitle === 'string' ? it.subtitle : undefined,
            }));
          if (sanitized.length === 0) {
            return errorResult('media_queue.set received no valid items');
          }
          const idx = Math.min(Math.max(0, initialIndex), sanitized.length - 1);
          const queue: StoredQueue = { items: sanitized, currentIndex: idx };
          await this.save(queue);

          // Auto-play the selected item
          const playItem = sanitized[idx];
          await this.playUrl(playItem.url);

          return successResult(
            `media_queue set (${sanitized.length} items, playing index ${idx}: "${playItem.title}")`,
            `Spiele "${playItem.title}"`,
          );
        }
        case 'get': {
          const q = await this.load();
          if (!q) {
            return successResult('media_queue is empty');
          }
          return successResult(JSON.stringify(q));
        }
        case 'clear': {
          await AsyncStorage.removeItem(MEDIA_QUEUE_KEY);
          try {
            await AudioPlayerModule.stop();
          } catch {
            // Ignore if nothing playing
          }
          return successResult('media_queue cleared and playback stopped', 'Playlist gelöscht.');
        }
        case 'set_index': {
          const index = args.index as number | undefined;
          if (typeof index !== 'number' || Number.isNaN(index)) {
            return errorResult('media_queue.set_index requires numeric "index"');
          }
          const q = await this.ensureQueue();
          if (!q) {
            return errorResult('media_queue is empty');
          }
          const clamped = Math.min(Math.max(0, Math.floor(index)), q.items.length - 1);
          q.currentIndex = clamped;
          await this.save(q);

          const item = q.items[clamped];
          await this.playUrl(item.url);

          return successResult(
            `media_queue index set to ${clamped}, playing "${item.title}"`,
            `Spiele "${item.title}"`,
          );
        }
        case 'next': {
          const q = await this.ensureQueue();
          if (!q) return errorResult('media_queue is empty');
          q.currentIndex = (q.currentIndex + 1) % q.items.length;
          await this.save(q);

          const item = q.items[q.currentIndex];
          await this.playUrl(item.url);

          return successResult(
            `media_queue next → index ${q.currentIndex}, playing "${item.title}"`,
            `Nächste: "${item.title}"`,
          );
        }
        case 'prev': {
          const q = await this.ensureQueue();
          if (!q) return errorResult('media_queue is empty');
          q.currentIndex = (q.currentIndex - 1 + q.items.length) % q.items.length;
          await this.save(q);

          const item = q.items[q.currentIndex];
          await this.playUrl(item.url);

          return successResult(
            `media_queue prev → index ${q.currentIndex}, playing "${item.title}"`,
            `Vorherige: "${item.title}"`,
          );
        }
        default:
          return errorResult(`Unknown action: ${String(action)}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult(`media_queue error: ${message}`);
    }
  }

  /** Play a URL, restoring saved position natively (no audible glitch). */
  private async playUrl(url: string): Promise<void> {
    const startPos = await getSavedPositionSeconds(url);
    await AudioPlayerModule.play(url, startPos);
  }

  private async load(): Promise<StoredQueue | null> {
    const raw = await AsyncStorage.getItem(MEDIA_QUEUE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredQueue;
      if (!parsed || !Array.isArray(parsed.items)) return null;
      const items = parsed.items
        .filter(it => it && typeof it.url === 'string' && typeof it.title === 'string')
        .map(it => ({
          url: String(it.url),
          title: String(it.title),
          subtitle: typeof it.subtitle === 'string' ? it.subtitle : undefined,
        }));
      if (items.length === 0) return null;
      const currentIndex =
        typeof parsed.currentIndex === 'number'
          ? Math.min(Math.max(0, Math.floor(parsed.currentIndex)), items.length - 1)
          : 0;
      return { items, currentIndex };
    } catch {
      return null;
    }
  }

  private async ensureQueue(): Promise<StoredQueue | null> {
    const q = await this.load();
    if (!q) return null;
    if (q.currentIndex < 0 || q.currentIndex >= q.items.length) {
      q.currentIndex = 0;
      await this.save(q);
    }
    return q;
  }

  private async save(queue: StoredQueue): Promise<void> {
    const toStore: StoredQueue = {
      items: queue.items.map(it => ({
        url: it.url,
        title: it.title,
        subtitle: it.subtitle,
      })),
      currentIndex: Math.min(Math.max(0, Math.floor(queue.currentIndex)), Math.max(0, queue.items.length - 1)),
    };
    await AsyncStorage.setItem(MEDIA_QUEUE_KEY, JSON.stringify(toStore));
  }
}
