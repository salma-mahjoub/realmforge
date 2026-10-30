import { Suspense, lazy } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import Home from './pages/Home';
import Browse from './pages/Browse';
import LevelDetail from './pages/LevelDetail';
import Profile from './pages/Profile';
import Market from './pages/Market';

// Phaser-backed pages are code-split so the shell loads fast.
const EditorPage = lazy(() => import('./pages/editor/EditorPage'));
const Play = lazy(() => import('./pages/Play'));
const Room = lazy(() => import('./pages/Room'));

function NotFound() {
    return (
        <div className="empty">
            <h2>404 — this realm does not exist (yet)</h2>
            <p>
                <Link to="/editor" className="btn primary">
                    Forge it in the editor →
                </Link>
            </p>
        </div>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <Suspense fallback={<div className="empty">Loading…</div>}>
                <Routes>
                    <Route element={<Layout />}>
                        <Route index element={<Home />} />
                        <Route path="browse" element={<Browse />} />
                        <Route path="level/:id" element={<LevelDetail />} />
                        <Route path="editor" element={<EditorPage />} />
                        <Route path="play/:id" element={<Play />} />
                        <Route path="room/:code" element={<Room />} />
                        <Route path="profile/:address" element={<Profile />} />
                        <Route path="market" element={<Market />} />
                        <Route path="*" element={<NotFound />} />
                    </Route>
                </Routes>
            </Suspense>
        </BrowserRouter>
    );
}
