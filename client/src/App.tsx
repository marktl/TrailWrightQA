import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Settings from './pages/Settings';
import RunSession from './pages/RunSession';
import GenerationViewer from './pages/GenerationViewer';
import TestWorkspace from './pages/TestWorkspace';
import GenerateStart from './pages/GenerateStart';
import RecordModePage from './pages/RecordModePage';
import ViewerPage from './pages/ViewerPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/generate" element={<GenerateStart />} />
        <Route path="/record" element={<RecordModePage />} />
        <Route path="/tests/:testId" element={<TestWorkspace />} />
        <Route path="/runs/:runId" element={<RunSession />} />
        <Route path="/generate/:sessionId" element={<GenerationViewer />} />
        <Route path="/viewer/:sessionId" element={<ViewerPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
