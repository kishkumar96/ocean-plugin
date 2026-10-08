// Jest-only stand-in for maplibre-gl (mapped in craco.config.js). maplibre-gl v6 ships only as
// an ES module, which Jest 27 cannot resolve, and it cannot initialise under jsdom anyway. Tests
// that care replace it with their own jest.mock factory; this only gives the import a target.
const noop = () => {};

class Evented {
  on() { return this; }
  off() { return this; }
  once() { return this; }
}

export class Map extends Evented {}
export class Marker extends Evented {
  setLngLat() { return this; }
  setPopup() { return this; }
  addTo() { return this; }
  remove() {}
}
export class Popup extends Marker {
  setHTML() { return this; }
  setDOMContent() { return this; }
}
export class NavigationControl {}
export const addProtocol = noop;
export const removeProtocol = noop;
export const setWorkerUrl = noop;

const maplibregl = { Map, Marker, Popup, NavigationControl, addProtocol, removeProtocol, setWorkerUrl };
export default maplibregl;
