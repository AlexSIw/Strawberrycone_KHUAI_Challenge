import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'galmuri/dist/galmuri.css';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/700.css';
import '@fontsource/nanum-gothic-coding/400.css';
import '@xterm/xterm/css/xterm.css';
import './ui/theme.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
