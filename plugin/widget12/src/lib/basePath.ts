// Sub-path the app is served under (e.g. "/widget12" behind the ocean-plugin
// nginx). Set NEXT_PUBLIC_BASE_PATH at build time; empty when served at "/".
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix a root-relative path ("/enso.json") with the base path. */
export const withBasePath = (path: string) => `${BASE_PATH}${path}`;
