/**
 * ConversationStore – Two-key AsyncStorage persistence for conversation history
 *
 * Key design principle: each key has exactly ONE writer, eliminating race conditions.
 *
 * Key: 'conversation_history'
 *   Writer: Main app only (saveHistory, called after each turn)
 *   Reader: Main app only (loadHistory, called on startup)
 *   Max:    MAX_HISTORY entries (oldest dropped)
 *
 * Key: 'background_pending'
 *   Writer: Background HeadlessJS tasks only (appendPending)
 *   Reader: Main app only (drainPending, called when app comes to foreground)
 *   Max:    MAX_PENDING entries (oldest dropped)
 *
 * Both keys store StoredMessage[] in JSON.
 * Only clean user/assistant messages are stored (no tool calls, no tool results).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Message } from '../llm/types';

// ── Constants ────────────────────────────────────────────────────────────────

const HISTORY_KEY = 'conversation_history';
const CONTEXT_KEY = 'conversation_context';
const PENDING_KEY = 'background_pending';

/** Default max messages stored in conversation_history (shown in UI) */
const DEFAULT_MAX_HISTORY = 50;

/** Max messages stored in background_pending (usually drained quickly) */
const MAX_PENDING = 10;

// ── Types ────────────────────────────────────────────────────────────────────

export interface StoredMessage {
  role: 'user' | 'assistant';
  text: string;
  /** ISO-8601 timestamp string */
  timestamp: string;
}

export interface StoredContextSnapshot {
  history: Message[];
  summary: string | null;
  count: number;
}

// ── ConversationStore ─────────────────────────────────────────────────────────

export class ConversationStore {
  /**
   * Lock to prevent concurrent drainPending() calls (race condition protection).
   * If drainPending() is already running, subsequent calls return empty array.
   */
  private static drainingLock = false;

  /**
   * Save the full conversation history (called by main app after each turn).
   * Truncates to the last `maxMessages` entries.
   */
  static async saveHistory(messages: StoredMessage[], maxMessages = DEFAULT_MAX_HISTORY): Promise<void> {
    const safeMax = Math.max(1, maxMessages);
    const truncated = messages.slice(-safeMax);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(truncated));
  }

  /**
   * Persist LLM context as "last X raw messages + condensed summary of older turns".
   * This lets us preserve long-run context across app restarts without keeping
   * every historical message verbatim.
   */
  static async saveContextSnapshot(
    snapshot: StoredContextSnapshot,
    maxMessages = DEFAULT_MAX_HISTORY,
  ): Promise<void> {
    const safeMax = Math.max(1, maxMessages);
    const payload: StoredContextSnapshot = {
      history: Array.isArray(snapshot.history) ? snapshot.history.slice(-safeMax) : [],
      summary: typeof snapshot.summary === 'string' ? snapshot.summary : null,
      count: Number.isFinite(snapshot.count) ? snapshot.count : 0,
    };
    await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify(payload));
  }

  /**
   * Load the persisted conversation history (called by main app on startup).
   * Returns an empty array if nothing is stored yet.
   */
  static async loadHistory(maxMessages = DEFAULT_MAX_HISTORY): Promise<StoredMessage[]> {
    try {
      const json = await AsyncStorage.getItem(HISTORY_KEY);
      if (!json) return [];
      const parsed = JSON.parse(json) as unknown;
      if (!Array.isArray(parsed)) return [];
      // Validate shape – filter out any malformed entries
      const valid = (parsed as StoredMessage[]).filter(
        m => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string',
      );
      const safeMax = Math.max(1, maxMessages);
      return valid.slice(-safeMax);
    } catch {
      return [];
    }
  }

  /**
   * Load previously persisted LLM context snapshot.
   * Returns null when unavailable or malformed.
   */
  static async loadContextSnapshot(
    maxMessages = DEFAULT_MAX_HISTORY,
  ): Promise<StoredContextSnapshot | null> {
    try {
      const json = await AsyncStorage.getItem(CONTEXT_KEY);
      if (!json) return null;

      const parsed = JSON.parse(json) as unknown;
      if (!parsed || typeof parsed !== 'object') return null;

      const obj = parsed as Partial<StoredContextSnapshot>;
      if (!Array.isArray(obj.history)) return null;

      const validHistory = obj.history.filter(
        m =>
          m &&
          typeof m === 'object' &&
          typeof m.role === 'string' &&
          typeof m.content === 'string' &&
          ['system', 'user', 'assistant', 'tool'].includes(m.role),
      ) as Message[];

      const safeMax = Math.max(1, maxMessages);
      return {
        history: validHistory.slice(-safeMax),
        summary: typeof obj.summary === 'string' ? obj.summary : null,
        count: Number.isFinite(obj.count) ? (obj.count as number) : 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Append a message to the background pending queue.
   * Called by HeadlessJS tasks (e.g. accessibility automation, scheduler).
   * Truncates the queue to the last MAX_PENDING messages.
   */
  static async appendPending(role: 'user' | 'assistant', text: string): Promise<void> {
    try {
      let current: StoredMessage[] = [];
      const json = await AsyncStorage.getItem(PENDING_KEY);
      if (json) {
        const parsed = JSON.parse(json) as unknown;
        if (Array.isArray(parsed)) {
          current = parsed as StoredMessage[];
        }
      }

      const newEntry: StoredMessage = {
        role,
        text,
        timestamp: new Date().toISOString(),
      };

      const updated = [...current, newEntry].slice(-MAX_PENDING);
      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(updated));
    } catch {
      // Non-fatal: background task can't update UI – TTS is the fallback
    }
  }

  /**
   * Read and delete all pending messages (called by main app on foreground).
   * Returns the messages so they can be merged into the conversation.
   * Returns an empty array if nothing is pending.
   * 
   * Thread-safe: Uses a lock to prevent concurrent execution. If drainPending()
   * is already running, subsequent calls return an empty array to avoid duplicate
   * processing of the same messages.
   */
  static async drainPending(): Promise<StoredMessage[]> {
    // Prevent concurrent execution - if already draining, return empty
    if (ConversationStore.drainingLock) {
      return [];
    }

    try {
      ConversationStore.drainingLock = true;

      const json = await AsyncStorage.getItem(PENDING_KEY);
      if (!json) return [];

      const parsed = JSON.parse(json) as unknown;
      if (!Array.isArray(parsed) || parsed.length === 0) return [];

      // Delete first so we don't show duplicates if the app crashes between drain+merge
      await AsyncStorage.removeItem(PENDING_KEY);

      return (parsed as StoredMessage[]).filter(
        m => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string',
      );
    } catch {
      return [];
    } finally {
      ConversationStore.drainingLock = false;
    }
  }

  /**
   * Clear the full conversation history (e.g. when user clears chat).
   */
  static async clearHistory(): Promise<void> {
    await AsyncStorage.multiRemove([HISTORY_KEY, CONTEXT_KEY]);
  }
}
