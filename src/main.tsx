import { StrictMode, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import App, { EditorSnapshot } from './App';
import { AdminPage } from './components/AdminPage';
import { PlayPage } from './components/PlayPage';
import { useRoute } from './routes';
import './styles.css';

function Root() {
  const route = useRoute();
  const editorRef = useRef<EditorSnapshot | null>(null);

  // shared listen-only link: standalone page, no editor behind it
  if (route.page === 'play') return <PlayPage id={route.id} />;

  // the editor stays mounted (hidden) under the admin page, so its piece
  // and undo history survive the round trip
  return (
    <>
      <div style={{ display: route.page === 'editor' ? 'contents' : 'none' }}>
        <App active={route.page === 'editor'} snapshotRef={editorRef} />
      </div>
      {route.page === 'admin' && <AdminPage editorRef={editorRef} />}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
