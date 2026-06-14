const { createProxyMiddleware } = require('http-proxy-middleware');

const suitabilityTarget = process.env.REACT_APP_SUITABILITY_PROXY_TARGET || 'http://localhost:8001';

module.exports = function setupProxy(app) {
  // Suitability API — strips /suitability prefix, forwards to zarr-api on port 8001.
  // webpack-dev-server does NOT strip the mount prefix before handing off to middleware,
  // so pathRewrite converts /suitability/... → /...
  app.use(
    '/suitability',
    createProxyMiddleware({
      target: suitabilityTarget,
      changeOrigin: true,
      pathRewrite: { '^/suitability': '' },
    })
  );
};
