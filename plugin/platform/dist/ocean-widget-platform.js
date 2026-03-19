import React from 'react';

function PlatformPlaceholder({ label = 'Ocean Widget Platform Ready' }) {
  return React.createElement('div', { 'data-testid': 'platform-placeholder', style: { display: 'none' } }, label);
}

export { PlatformPlaceholder };
