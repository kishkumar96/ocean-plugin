import React, { createContext, useContext, useMemo } from 'react';
import { platformIdentity } from '../utils/platformMetadata';

const PlatformShellContext = createContext(platformIdentity);

export const PlatformShellProvider = ({ value, children }) => {
  const mergedValue = useMemo(() => ({ ...platformIdentity, ...value }), [value]);
  return <PlatformShellContext.Provider value={mergedValue}>{children}</PlatformShellContext.Provider>;
};

export const usePlatformShell = () => useContext(PlatformShellContext);
