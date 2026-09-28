// CRACO lets us make one narrow webpack tweak without ejecting from CRA -- same pattern
// already used by widget1 (see plugin/widget1/craco.config.js) in this monorepo.
module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // maplibre-gl v6's own worker-loading code does `new URL(`./${t}`, e)` -- a genuinely
      // dynamic path that no bundler can resolve statically, but that works correctly at
      // runtime in a browser (URL construction happens at runtime, not bundle time). Webpack
      // is right to flag that it can't statically verify the reference; CRA's CI=true build
      // treats every compiler warning as fatal, so without this it can never compile. This
      // ignores only that one specific, known-safe warning, scoped to maplibre-gl's own
      // files -- any other "Critical dependency" warning from elsewhere still surfaces.
      webpackConfig.ignoreWarnings = [
        ...(webpackConfig.ignoreWarnings || []),
        {
          module: /maplibre-gl/,
          message: /Critical dependency: the request of a dependency is an expression/,
        },
      ];
      return webpackConfig;
    },
  },
};
