/**
 * MiniMediaPlayer – Compact audio player for the header
 *
 * Shows a minimal control surface with Play/Pause (with fill-progress
 * background) and optional Previous/Next (based on a global media queue).
 * Auto-advances to next queue item when an episode completes.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
} from 'react-native';
import AudioPlayerModule, { AudioPlayerEvents, type AudioStatus } from '../native/AudioPlayerModule';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MEDIA_QUEUE_KEY, AUDIO_PERSIST_KEY, getSavedPositionSeconds, type StoredQueue } from '../tools/media-constants';

interface MiniMediaPlayerProps {
  isDark: boolean;
}

export function MiniMediaPlayer({ isDark }: MiniMediaPlayerProps): React.JSX.Element {
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [restored, setRestored] = useState(false);
  const [queue, setQueue] = useState<StoredQueue | null>(null);
  const [barWidth, setBarWidth] = useState(0);
  // Ref to access latest queue inside event listeners without re-subscribing
  const queueRef = useRef<StoredQueue | null>(null);
  queueRef.current = queue;

  const loadQueue = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(MEDIA_QUEUE_KEY);
      if (!raw) {
        setQueue(null);
        return;
      }
      const parsed = JSON.parse(raw) as StoredQueue;
      if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
        setQueue(null);
        return;
      }
      const idx =
        typeof parsed.currentIndex === 'number'
          ? Math.min(Math.max(0, Math.floor(parsed.currentIndex)), parsed.items.length - 1)
          : 0;
      setQueue({ items: parsed.items, currentIndex: idx });
    } catch (err) {
      console.error('Failed to load media queue:', err);
      setQueue(null);
    }
  }, []);

  // Update status periodically
  useEffect(() => {
    const updateStatus = async () => {
      try {
        const currentStatus = await AudioPlayerModule.getStatus();
        setStatus(currentStatus);
        // Persist status (lightweight)
        try {
          await AsyncStorage.setItem(
            AUDIO_PERSIST_KEY,
            JSON.stringify({
              url: currentStatus.url,
              status: currentStatus.status,
              position: currentStatus.position,
              updatedAt: Date.now(),
            }),
          );
        } catch {}
        // Keep queue in sync
        await loadQueue();
      } catch (err) {
        console.error('Failed to get audio status:', err);
      }
    };

    // Initial status check
    updateStatus();

    // Poll every 1 second
    const interval = setInterval(updateStatus, 1000);

    return () => clearInterval(interval);
  }, [loadQueue]);

  // Restore last known status on mount if native reports stopped
  useEffect(() => {
    const tryRestore = async () => {
      if (restored) return;
      try {
        const persisted = await AsyncStorage.getItem(AUDIO_PERSIST_KEY);
        if (persisted) {
          const data = JSON.parse(persisted) as {
            url: string | null;
            status: AudioStatus['status'];
            position: number;
          };
          if (data?.url) {
            const native = await AudioPlayerModule.getStatus();
            if ((!native.url || native.status === 'stopped') && data.url) {
              setStatus({
                status: 'paused',
                url: data.url,
                position: data.position || 0,
                duration: native.duration || 0,
              });
            }
          }
        }
      } catch {
        // ignore
      } finally {
        setRestored(true);
        loadQueue().catch(() => {});
      }
    };
    tryRestore();
  }, [restored, loadQueue]);

  /**
   * Auto-advance: when the current track completes, play the next item
   * in the queue (if available). Uses a ref to read latest queue state.
   */
  const autoAdvance = useCallback(async () => {
    const q = queueRef.current;
    if (!q || q.items.length <= 1) return; // nothing to advance to

    const nextIndex = (q.currentIndex + 1) % q.items.length;
    const nextItem = q.items[nextIndex];

    try {
      const updated: StoredQueue = { items: q.items, currentIndex: nextIndex };
      await AsyncStorage.setItem(MEDIA_QUEUE_KEY, JSON.stringify(updated));
      setQueue(updated);
      const startPos = await getSavedPositionSeconds(nextItem.url);
      await AudioPlayerModule.play(nextItem.url, startPos);
    } catch (err) {
      console.error('Auto-advance failed:', err);
    }
  }, []);

  // Listen to audio events
  useEffect(() => {
    const startedListener = AudioPlayerEvents.addListener('audio_started', (data: { url: string }) => {
      AsyncStorage.setItem(
        AUDIO_PERSIST_KEY,
        JSON.stringify({ url: data.url, status: 'playing', position: 0, updatedAt: Date.now() }),
      ).catch(() => {});
      loadQueue().catch(() => {});
    });

    const pausedListener = AudioPlayerEvents.addListener('audio_paused', () => {
      (async () => {
        try {
          const s = await AudioPlayerModule.getStatus();
          if (s.url) {
            await AsyncStorage.setItem(
              AUDIO_PERSIST_KEY,
              JSON.stringify({ url: s.url, status: 'paused', position: s.position, updatedAt: Date.now() }),
            );
          }
        } catch {}
      })();
    });

    const completedListener = AudioPlayerEvents.addListener('audio_completed', () => {
      // Try auto-advance; if no queue or single item, just clear status
      autoAdvance().catch(() => {
        setStatus(null);
        AsyncStorage.setItem(
          AUDIO_PERSIST_KEY,
          JSON.stringify({ url: null, status: 'stopped', position: 0, updatedAt: Date.now() }),
        ).catch(() => {});
      });
    });

    const stoppedListener = AudioPlayerEvents.addListener('audio_stopped', () => {
      // Position saving is handled by PlayAudioTool's listener; here just reload queue
      loadQueue().catch(() => {});
    });

    return () => {
      startedListener.remove();
      pausedListener.remove();
      completedListener.remove();
      stoppedListener.remove();
    };
  }, [loadQueue, autoAdvance]);

  // Don't show if we have no audio to show
  if (!status || !status.url) {
    return <View />;
  }

  const hasQueue = !!queue && Array.isArray(queue.items) && queue.items.length > 0;
  const canNavigate = hasQueue && queue!.items.length > 1;
  const currentIndex = hasQueue ? queue!.currentIndex : 0;

  const handlePlayPause = async () => {
    try {
      if (status.status === 'playing') {
        await AudioPlayerModule.pause();
      } else if (status.status === 'paused') {
        try {
          await AudioPlayerModule.resume();
        } catch {
          if (status.url) {
            const startPos = status.position > 0 ? status.position : await getSavedPositionSeconds(status.url);
            await AudioPlayerModule.play(status.url, startPos);
          }
        }
      } else {
        if (status.url) {
          const startPos = status.position > 0 ? status.position : await getSavedPositionSeconds(status.url);
          await AudioPlayerModule.play(status.url, startPos);
        }
      }
    } catch (err) {
      console.error('Failed to toggle play/pause:', err);
    }
  };

  const setQueueIndex = async (newIndex: number) => {
    if (!hasQueue) return;
    const clamped = Math.min(Math.max(0, newIndex), queue!.items.length - 1);
    try {
      const updated: StoredQueue = { items: queue!.items, currentIndex: clamped };
      await AsyncStorage.setItem(MEDIA_QUEUE_KEY, JSON.stringify(updated));
      setQueue(updated);
    } catch (err) {
      console.error('Failed to update media queue index:', err);
    }
  };

  const handleNext = async () => {
    if (!hasQueue) return;
    const nextIndex = (currentIndex + 1) % queue!.items.length;
    await setQueueIndex(nextIndex);
    const nextItem = queue!.items[nextIndex];
    try {
      const startPos = await getSavedPositionSeconds(nextItem.url);
      await AudioPlayerModule.play(nextItem.url, startPos);
    } catch (err) {
      console.error('Failed to play next item:', err);
    }
  };

  const handlePrev = async () => {
    if (!hasQueue) return;
    const prevIndex = (currentIndex - 1 + queue!.items.length) % queue!.items.length;
    await setQueueIndex(prevIndex);
    const prevItem = queue!.items[prevIndex];
    try {
      const startPos = await getSavedPositionSeconds(prevItem.url);
      await AudioPlayerModule.play(prevItem.url, startPos);
    } catch (err) {
      console.error('Failed to play previous item:', err);
    }
  };

  const progress = status.duration > 0 ? Math.max(0, Math.min(1, status.position / status.duration)) : 0;

  // Colors
  const bgColor = isDark ? '#2C2C2E' : '#E5E5EA';
  const fillColor = isDark ? 'rgba(255, 159, 10, 0.35)' : 'rgba(0, 122, 255, 0.25)';
  const emojiStyle = { fontSize: 18 };

  return (
    <View
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: 36,
        borderRadius: 10,
        backgroundColor: bgColor,
        overflow: 'hidden',
        paddingHorizontal: 6,
      }}>
      {/* Progress fill – spans the entire toolbar, pixel-based */}
      {barWidth > 0 && progress > 0 ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: Math.round(barWidth * progress),
            backgroundColor: fillColor,
          }}
        />
      ) : null}

      {canNavigate ? (
        <TouchableOpacity
          onPress={handlePrev}
          activeOpacity={0.6}
          style={{
            width: 24,
            height: 36,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text style={emojiStyle}>⏮️</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        onPress={handlePlayPause}
        activeOpacity={0.6}
        style={{
          width: 24,
          height: 36,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Text style={emojiStyle}>
          {status.status === 'playing' ? '⏸️' : '▶️'}
        </Text>
      </TouchableOpacity>

      {canNavigate ? (
        <TouchableOpacity
          onPress={handleNext}
          activeOpacity={0.6}
          style={{
            width: 24,
            height: 36,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text style={emojiStyle}>⏭️</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
