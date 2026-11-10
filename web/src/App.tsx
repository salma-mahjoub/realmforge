import { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Compass, Hammer } from 'lucide-react';
import { Layout } from './components/Layout';
import { Button, EmptyState, Spinner } from './components/ui';
import Home from './pages/Home';
import Browse from './pages/Browse';

// Every page except the two landing ones is code-split; Phaser-backed pages pull the phaser chunk.
const LevelDetail = lazy(() => import('./pages/LevelDetail'));
const Profile = lazy(() => import('./pages/Profile'));
const Market = lazy(() => import('./pages/Market'));
const Season = lazy(() => import('./pages/Season'));
const EditorPage = lazy(() => import('./pages/editor/EditorPage'));
const Play = lazy(() => import('./pages/Play'));
const Room = lazy(() => import('./pages/Room'));
const HowItWorks = lazy(() => import('./pages/HowItWorks'));

function NotFound() {
    return (
        <EmptyState
            icon={<Compass size={28} />}
            title="This realm does not exist (yet)"
            action={
                <div className="row">
                    <Button to="/browse" icon={<Compass size={16} aria-hidden />}>
                        Browse levels
                    </Button>
                    <Button to="/editor" variant="primary" icon={<Hammer size={16} aria-hidden />}>
                        Forge it in the editor
                    </Button>
                </div>
            }
        >
            The page you followed points nowhere. Levels live at <code>/level/&lt;id&gt;</code>.
        </EmptyState>
    );
}

function RouteFallback() {
    return (
        <div className="route-fallback">
            <Spinner size={22} label="Loading page" />
        </div>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route element={<Layout />}>
                    <Route index element={<Home />} />
                    <Route path="browse" element={<Browse />} />
                    <Route path="level/:id" element={<Suspense fallback={<RouteFallback />}><LevelDetail /></Suspense>} />
                    <Route path="editor" element={<Suspense fallback={<RouteFallback />}><EditorPage /></Suspense>} />
                    <Route path="play/:id" element={<Suspense fallback={<RouteFallback />}><Play /></Suspense>} />
                    <Route path="room/:code" element={<Suspense fallback={<RouteFallback />}><Room /></Suspense>} />
                    <Route path="profile/:address" element={<Suspense fallback={<RouteFallback />}><Profile /></Suspense>} />
                    <Route path="market" element={<Suspense fallback={<RouteFallback />}><Market /></Suspense>} />
                    <Route path="season" element={<Suspense fallback={<RouteFallback />}><Season /></Suspense>} />
                    <Route path="how-it-works" element={<Suspense fallback={<RouteFallback />}><HowItWorks /></Suspense>} />
                    <Route path="*" element={<NotFound />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}
