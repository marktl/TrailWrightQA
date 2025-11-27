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

    // Handle unnamed SSE messages (like step_deleted, step_updated events)
    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'step_deleted' && typeof event.payload?.deletedStepNumber === 'number') {
          setSteps((prev) =>
            prev
              .filter((step) => step.stepNumber !== event.payload.deletedStepNumber)
              .map((step, index) => ({ ...step, stepNumber: index + 1 }))
          );
        } else if (event.type === 'step_updated' && event.payload?.stepNumber) {
          setSteps((prev) =>
            prev.map((step) =>
              step.stepNumber === event.payload.stepNumber
                ? { ...step, ...event.payload.updates }
                : step
            )
          );
        }
      } catch {
        // Ignore parsing errors for non-JSON messages
      }
    };

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

  const deleteStep = async (stepNumber: number): Promise<boolean> => {
    try {
      const response = await fetch(`/api/generate/${sessionId}/steps/${stepNumber}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete step');
      }

      const data = await response.json();

      // If response includes updated steps (for cached sessions), update directly
      if (data.steps && Array.isArray(data.steps)) {
        setSteps(data.steps);
      }

      return true;
    } catch (error) {
      console.error('Failed to delete step:', error);
      return false;
    }
  };

  return {
    state,
    steps,
    isConnected,
    stopRecording,
    deleteStep,
  };
}
