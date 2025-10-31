import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Settings from './pages/Settings';
import RunSession from './pages/RunSession';
import GenerationViewer from './pages/GenerationViewer';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/runs/:runId" element={<RunSession />} />
        <Route path="/generate/:sessionId" element={<GenerationViewer />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
