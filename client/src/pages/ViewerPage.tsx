import { useParams } from 'react-router-dom';
import { GenerationViewer } from '../components/GenerationViewer';

export default function ViewerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();

  if (!sessionId) {
    return <div className="p-4">Missing session ID</div>;
  }

  return <GenerationViewer sessionId={sessionId} />;
}
