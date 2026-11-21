import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { FeedbackProvider } from './components/FeedbackProvider.tsx'

import { IS_CLOUD_TRIAL, workspaceId } from './services/localClient';

if (IS_CLOUD_TRIAL) {
  document.title = '个人订单驾驶舱';
  if (sessionStorage.getItem('desk-workspace') !== workspaceId()) {
    sessionStorage.clear();
    sessionStorage.setItem('desk-workspace', workspaceId());
  }
  window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
  window.addEventListener('storage', event => { if (event.key === 'desk-signed-out' || event.key === null) window.location.reload(); });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  </StrictMode>,
)
