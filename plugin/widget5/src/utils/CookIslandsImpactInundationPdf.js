import {
  MARGIN, HDR_H, TEXT_DK, TEXT_MD, TEXT_LT, GRID_CLR, HEADER_BG,
  setDraw, setFont, rect, fitText, drawHeaderBand, drawFooter,
  sectionTitle, contentBottom, ensureReportFont, PAGE_W,
} from './pdfTheme';
import { IMPACT_SECTOR_ORDER, IMPACT_SECTOR_LABELS } from '../services/cookIslandsImpactService';
import { fmtUsd, fmtHectares } from '../components/impact/impactFormat';

const CONTENT_W = PAGE_W - 2 * MARGIN;
const ROW_H = 6;
const DISTRICT_ROWS_PER_PAGE = 23;
const MARKS = [
  { marginCm: 0, label: 'MHWS' },
  { marginCm: 15, label: 'MHWS + 15 cm' },
  { marginCm: 17.5, label: 'MHWS + 17.5 cm (working mark)' },
  { marginCm: 20, label: 'MHWS + 20 cm' },
];

const validNumber = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const numberText = (value, digits = 0) => {
  const n = validNumber(value);
  return n === null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const dateText = (value) => {
  if (!value) return '—';
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const blockLabel = (block) => {
  if (!block?.dateStart || !block?.dateEnd) return 'Dates unavailable';
  return `${dateText(block.dateStart)} to ${dateText(block.dateEnd)}`;
};
const formatGeneratedAt = (value, timeZone) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
};

function titleForMark(summary, marginCm) {
  return summary?.levels?.find((level) => level.marginCm === marginCm) ?? null;
}

function writeCell(doc, text, x, y, width, { align = 'left', bold = false, color = TEXT_DK, size = 6.8 } = {}) {
  setFont(doc, color, size, bold ? 'bold' : 'normal');
  const value = fitText(doc, text, width - 3);
  doc.text(value, align === 'right' ? x + width - 1.5 : x + 1.5, y, { align });
}

function tableHeader(doc, y, columns) {
  rect(doc, MARGIN, y - 3.4, CONTENT_W, 7.2, HEADER_BG);
  let x = MARGIN;
  columns.forEach((column) => {
    writeCell(doc, column.label, x, y + 0.8, column.width, { bold: true, color: TEXT_LT, size: 6.4, align: column.align ?? 'left' });
    x += column.width;
  });
}

function tableRow(doc, y, columns, values, index) {
  if (index % 2 === 1) rect(doc, MARGIN, y - 3.4, CONTENT_W, ROW_H, [243, 246, 249]);
  setDraw(doc, GRID_CLR);
  doc.setLineWidth(0.1);
  doc.line(MARGIN, y + 2.6, MARGIN + CONTENT_W, y + 2.6);
  let x = MARGIN;
  columns.forEach((column, i) => {
    writeCell(doc, values[i] ?? '—', x, y, column.width, { bold: i === 0, align: column.align ?? 'left', size: 6.7 });
    x += column.width;
  });
}

function addPageFurniture(doc, bundle, page) {
  drawHeaderBand(doc, {
    title: 'Flood impact and inundation brief',
    subtitle: `${bundle.label} | ${blockLabel(bundle.selected)}`,
    rightLine1: `Page ${page}`,
    rightLine2: bundle.cycleId ? `Forecast run ${bundle.cycleId}` : 'Forecast run not reported',
  });
  const provenance = [
    `Impact forecast run: ${bundle.cycleId ?? 'not reported'}`,
    `Generated: ${formatGeneratedAt(bundle.generatedAt, bundle.timeZone)}`,
    'Source: RiskScape impact assessment and SFINCS inundation model',
  ].join(' | ');
  drawFooter(doc, {
    provenance,
    text: 'Modelled estimates for planning; not observed damage or a surveyed flood boundary. Impact loss and inundated land area measure different things.',
  });
}

function drawHeadline(doc, bundle) {
  const y = HDR_H + 6;
  const notes = [];
  if (bundle.inundationUnavailableReason) notes.push(bundle.inundationUnavailableReason);
  if (bundle.population?.validated === false) notes.push('Population estimate is unconfirmed.');
  if (bundle.portLoss > 0 && bundle.excludePortAssets) {
    notes.push(`Port assets (${fmtUsd(bundle.portLoss)}) are excluded from the selected-window damage total; comparison rows use reported totals.`);
  } else if (bundle.portLoss > 0) {
    notes.push(`Port assets contribute ${fmtUsd(bundle.portLoss)}; harbour-water sampling may overstate flooding of those structures.`);
  }
  if (notes.length) {
    const lines = doc.splitTextToSize(notes.join(' '), CONTENT_W - 8);
    const h = Math.max(9, lines.length * 3.3 + 4);
    rect(doc, MARGIN, y, CONTENT_W, h, [255, 244, 214], [230, 180, 60], 0.3);
    setFont(doc, [150, 95, 10], 7, 'bold');
    doc.text(lines, MARGIN + 4, y + 4);
  }
  const cardY = notes.length ? y + Math.max(9, doc.splitTextToSize(notes.join(' '), CONTENT_W - 8).length * 3.3 + 4) + 3 : y;
  const gap = 3;
  const cardW = (CONTENT_W - 3 * gap) / 4;
  const cards = [
    [bundle.excludePortAssets ? 'DAMAGE EXCLUDING PORT' : 'ESTIMATED ECONOMIC DAMAGE', fmtUsd(bundle.selected?.totalLoss), [230, 57, 70]],
    ['BUILDINGS EXPOSED', numberText(bundle.selected?.totalExposedBuildings), [244, 162, 97]],
    ['POPULATION AFFECTED', numberText(bundle.population?.value), [124, 58, 237]],
    ['LAND INUNDATED ABOVE MHWS +17.5 CM', bundle.workingAreaHa === null ? '—' : fmtHectares(bundle.workingAreaHa), [42, 157, 143]],
  ];
  cards.forEach(([label, value, color], i) => {
    const x = MARGIN + i * (cardW + gap);
    rect(doc, x, cardY, cardW, 19, [255, 255, 255], GRID_CLR, 0.25);
    setFont(doc, TEXT_MD, 5.8, 'bold');
    doc.text(doc.splitTextToSize(label, cardW - 6).slice(0, 2), x + 3, cardY + 4.5);
    setFont(doc, color, 11, 'bold');
    doc.text(fitText(doc, value, cardW - 6), x + 3, cardY + 15);
  });
  return cardY + 24;
}

function drawWindowComparison(doc, bundle, y) {
  sectionTitle(doc, 'Forecast-window comparison', MARGIN, y);
  y += 5;
  const columns = [
    { label: 'Window', width: 57 },
    { label: 'Est. damage', width: 43, align: 'right' },
    { label: 'Buildings exposed', width: 38, align: 'right' },
    { label: 'Population', width: 34, align: 'right' },
    { label: 'Land above MHWS +17.5 cm', width: 109, align: 'right' },
  ];
  tableHeader(doc, y, columns);
  y += 8;
  bundle.blocks.forEach((block, i) => {
    const summary = bundle.summariesByScenario?.[block.scenario];
    const mark = titleForMark(summary, 17.5);
    tableRow(doc, y, columns, [
      blockLabel(block),
      fmtUsd(block.totalLoss),
      numberText(block.totalExposedBuildings),
      numberText(block.population?.value),
      mark ? fmtHectares(mark.areaHa) : 'Unavailable',
    ], i);
    y += ROW_H;
  });
  return y + 4;
}

function drawSectorAndWatermarkTables(doc, bundle, y) {
  const gap = 8;
  const colW = (CONTENT_W - gap) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + gap;
  sectionTitle(doc, 'Estimated damage by sector', leftX, y);
  sectionTitle(doc, 'Inundated land by water mark', rightX, y);
  let rowY = y + 6;
  const sectorColumns = [{ label: 'Sector', width: colW - 30 }, { label: 'Estimated damage', width: 30, align: 'right' }];
  const markColumns = [{ label: 'Water mark', width: colW - 60 }, { label: 'Area', width: 25, align: 'right' }, { label: 'Outside districts', width: 35, align: 'right' }];

  const ordered = IMPACT_SECTOR_ORDER.map((key) => [IMPACT_SECTOR_LABELS[key], bundle.selected?.lossesBySector?.[key]])
    .filter(([, value]) => validNumber(value) !== null);
  ordered.forEach(([label, value], i) => {
    const x = leftX;
    if (i % 2) rect(doc, x, rowY - 3.4, colW, ROW_H, [243, 246, 249]);
    writeCell(doc, label, x, rowY, sectorColumns[0].width, { bold: true });
    writeCell(doc, fmtUsd(value), x + sectorColumns[0].width, rowY, sectorColumns[1].width, { align: 'right' });
    rowY += ROW_H;
  });
  if (!ordered.length) {
    setFont(doc, TEXT_MD, 6.8);
    doc.text('Sector breakdown unavailable.', leftX + 1.5, rowY);
  }

  rowY = y + 6;
  MARKS.forEach((mark, i) => {
    const level = titleForMark(bundle.selectedSummary, mark.marginCm);
    if (i % 2) rect(doc, rightX, rowY - 3.4, colW, ROW_H, [243, 246, 249]);
    writeCell(doc, mark.label, rightX, rowY, markColumns[0].width, { bold: mark.marginCm === 17.5 });
    writeCell(doc, level ? fmtHectares(level.areaHa) : '—', rightX + markColumns[0].width, rowY, markColumns[1].width, { align: 'right', bold: mark.marginCm === 17.5 });
    writeCell(doc, level ? fmtHectares(level.outsideDistrictsHa) : '—', rightX + markColumns[0].width + markColumns[1].width, rowY, markColumns[2].width, { align: 'right' });
    rowY += ROW_H;
  });

  const noteY = Math.max(y + 6 + Math.max(ordered.length, MARKS.length) * ROW_H, rowY) + 2;
  setFont(doc, TEXT_MD, 6.2, 'italic');
  const note = 'Inundation area counts land above the specified tidal water mark with forecast flood depth meeting the selected minimum depth. The sea, lagoon and land below MHWS are not counted.';
  doc.text(doc.splitTextToSize(note, CONTENT_W), MARGIN, noteY);
}

function drawDistrictPages(doc, bundle, pageStart) {
  const districts = [...(bundle.districts ?? [])].filter((row) => !row.unmatched)
    .sort((a, b) => (b.totalLoss ?? 0) - (a.totalLoss ?? 0));
  const working = titleForMark(bundle.selectedSummary, 17.5);
  const floodedByDistrict = new Map((working?.districts ?? []).map((row) => [String(row.districtId), row]));
  const pageCount = Math.max(1, Math.ceil(districts.length / DISTRICT_ROWS_PER_PAGE));

  for (let page = 0; page < pageCount; page += 1) {
    doc.addPage();
    addPageFurniture(doc, bundle, pageStart + page);
    let y = HDR_H + 7;
    sectionTitle(doc, 'District detail', MARGIN, y);
    setFont(doc, TEXT_MD, 6.5);
    doc.text('Impact losses and inundated land area are separate model outputs and are not expected to match.', MARGIN, y + 4.5);
    y += 11;
    const columns = [
      { label: 'District', width: 76 },
      { label: 'Est. damage', width: 48, align: 'right' },
      { label: 'Buildings exposed', width: 43, align: 'right' },
      { label: 'Land above MHWS +17.5 cm', width: 68, align: 'right' },
      { label: 'Share of inundated area', width: 46, align: 'right' },
    ];
    tableHeader(doc, y, columns);
    y += 8;
    const rows = districts.slice(page * DISTRICT_ROWS_PER_PAGE, (page + 1) * DISTRICT_ROWS_PER_PAGE);
    rows.forEach((row, i) => {
      const area = floodedByDistrict.get(String(row.districtId));
      const percent = area && working?.areaHa > 0 ? `${numberText((area.areaHa / working.areaHa) * 100)}%` : '—';
      tableRow(doc, y, columns, [
        row.districtName,
        fmtUsd(row.totalLoss),
        numberText(row.totalExposedBuildings),
        area ? fmtHectares(area.areaHa) : '—',
        percent,
      ], i);
      y += ROW_H;
    });
    if (!districts.length) {
      setFont(doc, TEXT_MD, 7);
      doc.text('No district-level impact data is available for this window.', MARGIN + 1.5, y);
      y += ROW_H;
    }
    if (working?.outsideDistrictsHa > 0) {
      setFont(doc, TEXT_MD, 6.5, 'italic');
      doc.text(`Outside census districts (including coast and harbours): ${fmtHectares(working.outsideDistrictsHa)}.`, MARGIN, Math.min(y + 3, contentBottom(doc) - 4));
    }
  }
  return pageCount;
}

export async function buildCookIslandsImpactInundationPdfDoc({
  impact,
  selected,
  districts = [],
  summariesByScenario = {},
  selectedSummary = null,
  inundationUnavailableReason = null,
  portLoss = 0,
  excludePortAssets = false,
  timeZone = 'Pacific/Rarotonga',
  generatedAt = new Date(),
} = {}) {
  if (!impact || !selected) throw new Error('An impact result and selected forecast window are required to create this report.');
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  await ensureReportFont(doc);

  const bundle = {
    label: impact.label ?? 'Forecast impact estimate',
    cycleId: impact.cycleId ?? null,
    selected,
    blocks: impact.blocks ?? [selected],
    districts,
    summariesByScenario,
    selectedSummary,
    workingAreaHa: validNumber(titleForMark(selectedSummary, 17.5)?.areaHa),
    inundationUnavailableReason,
    portLoss: validNumber(portLoss) ?? 0,
    excludePortAssets,
    population: selected.population ?? { value: null, validated: false },
    timeZone,
    generatedAt,
  };
  addPageFurniture(doc, bundle, 1);
  let y = drawHeadline(doc, bundle);
  y = drawWindowComparison(doc, bundle, y);
  drawSectorAndWatermarkTables(doc, bundle, y);
  const districtPages = drawDistrictPages(doc, bundle, 2);
  return { doc, filename: `cook-islands-impact-inundation-${selected.scenario ?? 'selected-window'}.pdf`, pageCount: districtPages + 1 };
}

export async function exportCookIslandsImpactInundationPdf(params) {
  const { doc, filename } = await buildCookIslandsImpactInundationPdfDoc(params);
  doc.save(filename);
  return filename;
}
