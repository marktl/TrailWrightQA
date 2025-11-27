import { useState } from 'react';
import { RecordModeSetup } from '../components/RecordModeSetup';
import { GenerationViewer } from '../components/GenerationViewer';

export function RecordModePage() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  const handleStart = async (config: {
    name: string;
    startUrl: string;
    description?: string;
  }) => {
    try {
      const response = await fetch('/api/generate/record/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        throw new Error('Failed to start recording');
      }

      const data = await response.json();
      setSessionId(data.sessionId);

      window.open(`/viewer/${data.sessionId}`, '_blank');
    } catch (error) {
      console.error('Failed to start recording:', error);
      alert('Failed to start recording. Please try again.');
    }
  };

  if (sessionId) {
    return <GenerationViewer sessionId={sessionId} />;
  }

  return <RecordModeSetup onStart={handleStart} />;
}

export default RecordModePage;
