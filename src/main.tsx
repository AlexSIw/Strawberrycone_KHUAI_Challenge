import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'galmuri/dist/galmuri.css';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/700.css';
import '@fontsource/nanum-gothic-coding/400.css';
import '@xterm/xterm/css/xterm.css';
import './ui/theme.css';
import { App } from './App';

// Warm the terminal's Korean coding font (its Latin and Hangul subsets) so it is ready before the
// first terminal opens and xterm measures its cells.
try {
  void document.fonts?.load("14px 'Nanum Gothic Coding'", 'ops 관리 접속 help W').catch(() => {});
} catch {
  /* no Font Loading API: the terminal re-measures when it can */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
