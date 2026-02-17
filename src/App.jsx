import React, { Suspense, lazy, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Auth from './pages/Auth';
import { hasSession } from './services/session';
import { isCollabMode } from './services/collabApi';

const Home = lazy(() => import('./pages/Home'));
const Reader = lazy(() => import('./pages/Reader'));

function App() {
  const [, setAuthTick] = useState(0);
  const isAuthed = hasSession();

  if (isCollabMode && !isAuthed) {
    return <Auth onAuthed={() => setAuthTick((v) => v + 1)} />;
  }

  return (
    <Router>
      <div className="min-h-screen bg-white text-gray-900 font-sans">
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-gray-500">Loading...</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/read" element={<Reader />} />
          </Routes>
        </Suspense>
      </div>
    </Router>
  );
}

export default App;
