export const platformIdentity = {
  name: 'Ocean Widget Platform',
  version: '0.1.0',
  tagline: 'Shared UI and runtime utilities for ocean widgets',
};

export const formatPlatformTagline = (widgetName = 'widget') =>
  `${widgetName} is powered by ${platformIdentity.name}`;
