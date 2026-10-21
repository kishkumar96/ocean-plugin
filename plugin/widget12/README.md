# Widget 12 — El Niño Story

Next.js story map (copied from the standalone `elnino-story` project), served
by the ocean-plugin nginx at `/widget12/`.

## Run with the rest of ocean-plugin

From the repo root:

```bash
docker-compose up --build -d plugin-widget12 main-nginx
```

Open http://localhost:8085/widget12/

## Local development

```bash
npm install
npm run dev                                   # http://localhost:3000/
NEXT_PUBLIC_BASE_PATH=/widget12 npm run dev   # http://localhost:3000/widget12/
```

## Notes

- The sub-path is set at build time via `NEXT_PUBLIC_BASE_PATH` (default
  `/widget12` in the `Dockerfile`). It drives Next.js `basePath`; root-relative
  URLs in code go through `withBasePath()` from `src/lib/basePath.ts`.
- Story text (`src/story/story.json`), layer config and `public/` files are
  built into the image: rebuild after editing them.
- The container needs outbound HTTPS to the data sources (Wasabi S3 Zarr
  stores, ocean-plotter legends, SPC OSM tiles, GeoNode overlays via the
  built-in `/widget12/api/tiles` proxy).
