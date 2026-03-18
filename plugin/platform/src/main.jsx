import React from 'react';
import ReactDOM from 'react-dom/client';
import { PlatformPlaceholder } from './index';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <div style={{ padding: '24px', maxWidth: '720px', margin: '0 auto', display: 'grid', gap: '12px' }}>
      <PlatformPlaceholder widgetName="Widget Preview" />
      <PlatformPlaceholder widgetName="Widget 5" message="Cook Islands forecast shell ready" />
    </div>
  </React.StrictMode>,
);
