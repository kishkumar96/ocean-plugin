const TYPES = ['landing_site', 'fishing_ground'];
const ICON_PREFIX = 'cok-advisory';

export function advisoryMarkerId(type, hazardClass) {
  const kind = type === 'fishing_ground' ? 'fishing_ground' : 'landing_site';
  const hazard = [0, 1, 2].includes(Number(hazardClass)) ? Number(hazardClass) : 0;
  return `${ICON_PREFIX}-${kind}-${hazard}`;
}

function drawGlyph(ctx, type, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (type === 'fishing_ground') {
    // A fish silhouette remains recognizable at the map's smaller zooms.
    ctx.beginPath();
    ctx.ellipse(17.5, 16, 6.8, 4.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(11, 16);
    ctx.lineTo(6.5, 12.3);
    ctx.lineTo(6.5, 19.7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color === '#0f172a' ? '#f4a261' : '#2a9d8f';
    ctx.beginPath();
    ctx.arc(20.5, 14.6, 1, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Anchor: harbor/landing location, distinct from the circular reef samples.
  ctx.beginPath();
  ctx.arc(16, 9, 2.2, 0, Math.PI * 2);
  ctx.moveTo(16, 11.5);
  ctx.lineTo(16, 23.5);
  ctx.moveTo(10, 15.5);
  ctx.lineTo(22, 15.5);
  ctx.moveTo(8.5, 18);
  ctx.bezierCurveTo(8.5, 25, 23.5, 25, 23.5, 18);
  ctx.moveTo(8.5, 18);
  ctx.lineTo(6.5, 19.5);
  ctx.moveTo(23.5, 18);
  ctx.lineTo(25.5, 19.5);
  ctx.stroke();
}

function makeMarker(type, hazardClass, hazardColors) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  ctx.beginPath();
  ctx.arc(16, 16, 14, 0, Math.PI * 2);
  ctx.fillStyle = hazardColors[hazardClass];
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  drawGlyph(ctx, type, hazardClass === 1 ? '#0f172a' : '#ffffff');
  return ctx.getImageData(0, 0, 64, 64);
}

export function registerAdvisoryMarkerIcons(map, hazardColors) {
  for (const type of TYPES) {
    for (const hazardClass of [0, 1, 2]) {
      const id = advisoryMarkerId(type, hazardClass);
      if (!map.hasImage(id)) map.addImage(id, makeMarker(type, hazardClass, hazardColors), { pixelRatio: 2 });
    }
  }
}
