import { useMemo } from 'react';
import { platformIdentity } from '../utils/platformMetadata';

export const usePlatformInfo = (overrides = {}) =>
  useMemo(() => ({ ...platformIdentity, ...overrides }), [overrides]);
