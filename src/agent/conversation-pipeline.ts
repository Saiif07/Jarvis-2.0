/**
 * ConversationPipeline – Orchestrates the full voice interaction flow
 *
 * Flow: Wake Word → STT → LLM (tool loop) → TTS
 *
 * Responsibilities:
 *   - Manage the agent's conversation history (with context management)
 *   - Build system prompt from skill loader + tool registry
 *   - Run the LLM tool loop
 *   - Speak responses via TTS in driving mode
 */
import type { LLMProvider, Message } from '../llm/types';
import type { ToolRegistry } from './tool-registry';
import type { SkillLoader } from './skill-loader';
import { runToolLoop } from './tool-loop';
import { buildSystemPrompt } from './system-prompt';
import type { TTSService } from '../audio/tts-service';
import { DebugLogger } from './debug-logger';
import { PersonalMemoryStore } from './personal-memory-store';
import { ContextManager } from './context-manager';

export type PipelineState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error';

export interface PipelineConfig {
  provider: LLMProvider;
  model: string;
  tools: ToolRegistry;
  skillLoader: SkillLoader;
  ttsService: TTSService;
  drivingMode: boolean;
  maxIterations?: number;
  maxHistoryMessages?: number;
  language?: string;
  soul?: string;
  personalMemory?: string;
}

export interface PipelineHistorySnapshot {
  history: Message[];
  summary: string | null;
  count: number;
}

export type StateChangeCallback = (state: PipelineState) => void;
export type ErrorCallback = (error: string) => void;
export type TranscriptCallback = (role: 'user' | 'assistant', text: string) => void;

export class ConversationPipeline {
  private config: PipelineConfig;
  private contextManager: ContextManager;
  private enabledSkillNames: string[] = [];
  private onStateChange?: StateChangeCallback;
  private onError?: ErrorCallback;
  private onTranscript?: TranscriptCallback;
  private state: PipelineState = 'idle';

  constructor(config: PipelineConfig) {
    this.config = config;
    this.contextManager = new ContextManager({
      summarizeProvider: config.provider,
      summarizeModel: config.model,
      maxMessages: Math.max(6, config.maxHistoryMessages ?? 20),
      keepRecentCount: 6,
    });
  }

  setCallbacks(callbacks: {
    onStateChange?: StateChangeCallback;
    onError?: ErrorCallback;
    onTranscript?: TranscriptCallback;
  }): void {
    this.onStateChange = callbacks.onStateChange;
    this.onError = callbacks.onError;
    this.onTranscript = callbacks.onTranscript;
  }

  setEnabledSkills(skillNames: string[]): void {
    this.enabledSkillNames = skillNames;
  }

  setDrivingMode(enabled: boolean): void {
    this.config.drivingMode = enabled;
  }

  setSoul(soul: string): void {
    this.config.soul = soul;
  }

  setPersonalMemory(personalMemory: string): void {
    this.config.personalMemory = personalMemory;
  }

  getState(): PipelineState {
    return this.state;
  }

  /** Clear conversation history */
  clearHistory(): void {
    this.contextManager.clear();
  }

  /**
   * Start listening state. Used when STT is starting.
   * Only sets state if currently idle or speaking.
   * If already listening, this is a no-op (prevents duplicate calls).
   */
  startListening(): void {
    if (this.state === 'idle' || this.state === 'speaking') {
      this.setState('listening');
    }
    // If already listening, ignore (no-op)
    // If in processing/error, don't override (let current operation finish)
  }

  /**
   * Stop listening and return to idle.
   * Used when STT is cancelled or fails.
   * Also handles cleanup if called from unexpected states.
   */
  stopListening(): void {
    if (this.state === 'listening') {
      this.setState('idle');
    }
    // If not listening, this is a no-op (safe to call multiple times)
  }

  /**
   * Set state to idle explicitly.
   * Used for error recovery or manual state reset.
   */
  setIdle(): void {
    this.setState('idle');
  }

  /**
   * Interrupt ongoing TTS playback and return to idle.
   * Safe to call at any time; no-op if not currently speaking.
   */
  async stopSpeaking(): Promise<void> {
    if (this.state === 'speaking') {
      await this.config.ttsService.stop();
      this.setState('idle');
    }
  }

  /**
   * Process a user utterance through the full pipeline:
   * text → system prompt + history → LLM tool loop → TTS response
   *
   * Options:
   *   - silent: if true, the user text is NOT shown as a bubble in the UI
   *             (used for system-injected messages like notifications)
   */
  async processUtterance(
    userText: string,
    options?: { silent?: boolean },
  ): Promise<string> {
    // Allow processing if idle or listening (listening means STT just finished)
    // If currently listening, stop listening first and proceed
    if (this.state === 'listening') {
      this.setState('processing');
    } else if (this.state !== 'idle') {
      return '';
    } else {
      this.setState('processing');
    }

    try {
      if (!options?.silent) {
        this.onTranscript?.('user', userText);
      }
      DebugLogger.logUserMessage(userText);

      // Always read personal memory fresh from storage so the system prompt
      // reflects any facts written by memory_personal_upsert during this
      // session without requiring an external state-relay mechanism.
      const freshPersonalMemory = await PersonalMemoryStore.getMemory();

      // Build system prompt
      const systemPrompt = buildSystemPrompt({
        skillLoader: this.config.skillLoader,
        toolRegistry: this.config.tools,
        enabledSkillNames: this.enabledSkillNames,
        drivingMode: this.config.drivingMode,
        language: this.config.language,
        soul: this.config.soul,
        personalMemory: freshPersonalMemory,
      });
      DebugLogger.logSystemPrompt(systemPrompt);

      // Save user message and run condensation before building final LLM context.
      const systemMsg: Message = { role: 'system', content: systemPrompt };
      const userMsg: Message = { role: 'user', content: userText };
      this.contextManager.add(userMsg);
      await this.maybeCompressContext();
      const messages: Message[] = [systemMsg, ...this.contextManager.getMessages()];
      DebugLogger.logRegisteredTools(
        this.config.tools.list(),
        this.config.tools.definitions(),
      );

      // Run the agent tool loop
      const result = await runToolLoop(
        {
          provider: this.config.provider,
          tools: this.config.tools,
          maxIterations: this.config.maxIterations ?? 10,
        },
        messages,
      );

      const assistantText = result.content || 'Task started.';

      // Check for silent reply token (e.g., from accessibility tool waiting for background result)
      const isSilent = assistantText.includes('__SILENT__');

      // Save intermediate tool call messages + final assistant response into context.
      result.newMessages.forEach(msg => this.contextManager.add(msg));
      this.contextManager.add({ role: 'assistant', content: assistantText });
      await this.maybeCompressContext();

      // If silent, don't show bubble or speak - the actual result will come via appendPending
      if (isSilent) {
        this.setState('idle');
        return '';
      }

      // Show the final response as a bubble.
      // In driving mode: also speak it via TTS (pipeline-controlled, no tts tool needed).
      // In normal mode: silent – only the bubble is shown.
      if (assistantText) {
        this.onTranscript?.('assistant', assistantText);
        if (this.config.drivingMode) {
          this.setState('speaking');
          // Start TTS - wait for completion
          try {
            await this.config.ttsService.speak(assistantText, this.config.language ?? 'en-US');
          } catch (ttsErr) {
            // TTS error - log but don't fail the whole pipeline
            DebugLogger.logError('TTS', `TTS error: ${ttsErr instanceof Error ? ttsErr.message : String(ttsErr)}`);
          }
          // After speak() completes (or errors), TTS is done, so set idle
          // The tts_done listener in App.tsx should also set it, but this is a fallback
          // Don't override 'listening' state - user might have started listening
          if (this.getState() !== 'listening') {
            this.setState('idle');
          }
        } else {
          // Normal mode: no TTS, so we can set idle immediately
          // Don't override 'listening' state - user might have started listening
          if (this.getState() !== 'listening') {
            this.setState('idle');
          }
        }
      } else {
        // No assistant text, set idle immediately
        // Don't override 'listening' state - user might have started listening
        if (this.getState() !== 'listening') {
          this.setState('idle');
        }
      }

      return assistantText;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      DebugLogger.logError('PIPELINE', message);
      this.setState('error');
      this.onError?.(message);

      // Save an error assistant message so the LLM has context on the next turn
      this.contextManager.add({
        role: 'assistant',
        content: `[Error: ${message}] I was unable to process the request.`,
      });
      await this.maybeCompressContext();

      // Try to speak error in driving mode
      if (this.config.drivingMode) {
        this.config.ttsService.speakAsync(
          'An error has occurred.',
          this.config.language ?? 'en-US',
        );
      }

      this.setState('idle');
      return '';
    }
  }

  private setState(state: PipelineState): void {
    this.state = state;
    this.onStateChange?.(state);
  }

  /**
   * Trim conversation history to prevent context overflow.
   * Keeps the most recent messages, but ensures we never break tool-call chains.
   *
   * OpenAI requires that every message with role 'tool' is preceded by an
   * 'assistant' message that contains the matching tool_calls. A naive slice
   * can cut off the assistant message while keeping orphaned tool results,
   * causing a 400 error.
   *
   * Strategy: slice to ~maxMessages, then advance the start index past any
   * orphaned 'tool' or 'assistant-with-toolCalls' messages so the history
   * always begins with a clean 'user' or plain 'assistant' message.
   */
  private trimHistory(maxMessages: number): void {
    const exported = this.contextManager.export();
    const history = [...exported.history];
    if (history.length === 0) {
      return;
    }

    const safeMax = Math.max(1, maxMessages);
    let start = history.length > safeMax ? history.length - safeMax : 0;

    // Advance past any orphaned messages at the cut point:
    // - 'tool' messages without their preceding assistant+toolCalls
    // - 'assistant' messages with toolCalls whose tool results follow
    while (start < history.length) {
      const msg = history[start];
      if (msg.role === 'tool') {
        // Orphaned tool result – skip
        start++;
      } else if (
        msg.role === 'assistant' &&
        msg.toolCalls &&
        msg.toolCalls.length > 0
      ) {
        // Assistant with tool calls – the following tool results belong to it,
        // but we'd also need those. Safest to skip the whole group.
        start++;
      } else {
        break;
      }
    }

    this.contextManager.import({
      history: history.slice(start),
      summary: exported.summary,
      count: exported.count,
    });
  }

  /**
   * Run safety trimming and optional context condensation.
   * The trim pass remains as a guard so compression never leaves an invalid
   * tool-call boundary at the start of the retained recent history.
   */
  private async maybeCompressContext(): Promise<void> {
    this.trimHistory(this.config.maxHistoryMessages ?? 20);
    await this.contextManager.maybeCompress();
    this.trimHistory(this.config.maxHistoryMessages ?? 20);
  }

  /** Export history for session persistence */
  exportHistory(): PipelineHistorySnapshot {
    return this.contextManager.export();
  }

  /**
   * Import saved history (replaces current history).
   * Supports both legacy Message[] and the new snapshot format with summary.
   */
  importHistory(history: Message[] | PipelineHistorySnapshot): void {
    if (Array.isArray(history)) {
      this.contextManager.import({
        history: [...history],
        summary: null,
        count: 0,
      });
    } else {
      this.contextManager.import({
        history: [...history.history],
        summary: history.summary,
        count: history.count,
      });
    }
    this.trimHistory(this.config.maxHistoryMessages ?? 20);
  }

  /**
   * Append messages to the existing history without replacing it.
   * Used by App.tsx to inject restored background messages (e.g. from HeadlessJS tasks)
   * into the LLM context after the pipeline is already running.
   */
  appendToHistory(messages: Message[]): void {
    messages.forEach(msg => this.contextManager.add(msg));
    this.maybeCompressContext().catch(err => {
      const msg = err instanceof Error ? err.message : String(err);
      DebugLogger.logError('PIPELINE', `Failed to condense appended history: ${msg}`);
    });
  }
}
