import { useEffect, useState } from 'react';
import type { LiveGenerationState, RecordedStep } from '../../../shared/types';

export function useGenerationStream(sessionId: string) {
  const [state, setState] = useState<LiveGenerationState | null>(null);
  const [steps, setSteps] = useState<RecordedStep[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    const eventSource = new EventSource(`/api/generate/${sessionId}/events`);

    eventSource.addEventListener('state', (e) => {
      const newState = JSON.parse(e.data);
      setState(newState);
    });

    eventSource.addEventListener('step', (e) => {
      const step = JSON.parse(e.data);
      setSteps((prev) => [...prev, step]);
    });

    eventSource.addEventListener('open', () => {
      setIsConnected(true);
    });

    eventSource.addEventListener('error', () => {
      setIsConnected(false);
      eventSource.close();
    });

    return () => {
      eventSource.close();
    };
  }, [sessionId]);

  const stopRecording = async () => {
    if (!sessionId || state?.mode !== 'record') return;

    await fetch(`/api/generate/${sessionId}/record/stop`, {
      method: 'POST',
    });
  };

  return {
    state,
    steps,
    isConnected,
    stopRecording,
  };
}
