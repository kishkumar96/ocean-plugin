import fs from 'fs';
import { Locator, launch } from 'puppeteer'; // v25.0.0 or later

const browser = await launch();
const page = await browser.newPage();
const timeout = 5000;
page.setDefaultTimeout(timeout);

const lhApi = await import('lighthouse'); // v10.0.0 or later
const flags = {
    screenEmulation: {
        disabled: true
    }
}
const config = lhApi.desktopConfig;
const lhFlow = await lhApi.startFlow(page, {name: 'Recording 29/09/2026 at 10:39:01 am', config, flags});
{
    const targetPage = page;
    await targetPage.setViewport({
        width: 987,
        height: 935
    })
}
await lhFlow.startNavigation();
{
    const targetPage = page;
    await targetPage.goto('http://localhost:3001/');
}
await lhFlow.endNavigation();
await lhFlow.startTimespan();
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Mean Wave Period forecast variable)'),
        targetPage.locator('#right-panel-panel-forecast button:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-forecast\\"]/div[1]/div[1]/button[2])'),
        targetPage.locator(':scope >>> #right-panel-panel-forecast button:nth-of-type(2)'),
        targetPage.locator('::-p-text(Mean Wave Period)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 71.802001953125,
            y: 31.4375,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Select variable)'),
        targetPage.locator('div.variable-buttons'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-forecast\\"]/div[1]/div[1])'),
        targetPage.locator(':scope >>> div.variable-buttons'),
        targetPage.locator('::-p-text(Wave HeightMean)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 68,
            y: 86.4375,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Peak Wave Period forecast variable)'),
        targetPage.locator('div.controls-panel button:nth-of-type(3)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-forecast\\"]/div[1]/div[1]/button[3])'),
        targetPage.locator(':scope >>> div.controls-panel button:nth-of-type(3)'),
        targetPage.locator('::-p-text(Peak Wave Period)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 94,
            y: 30.25,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Vessel Suitability forecast variable)'),
        targetPage.locator('div.controls-panel button:nth-of-type(4)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-forecast\\"]/div[1]/div[1]/button[4])'),
        targetPage.locator(':scope >>> div.controls-panel button:nth-of-type(4)'),
        targetPage.locator('::-p-text(Vessel Suitability)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 126.802001953125,
            y: 11.25,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('button:nth-of-type(2) > div:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-forecast\\"]/div[2]/div[1]/button[2]/div[2])'),
        targetPage.locator(':scope >>> button:nth-of-type(2) > div:nth-of-type(2)'),
        targetPage.locator('::-p-text(Dinghies, open)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 59.0728759765625,
            y: 8.61456298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('button:nth-of-type(3) > div:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-forecast\\"]/div[2]/div[1]/button[3]/div[2])'),
        targetPage.locator(':scope >>> button:nth-of-type(3) > div:nth-of-type(2)'),
        targetPage.locator('::-p-text(Fibreglass, skiffs)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 78.0728759765625,
            y: 0.9791259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('button:nth-of-type(4) > div:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-forecast\\"]/div[2]/div[1]/button[4]/div[2])'),
        targetPage.locator(':scope >>> button:nth-of-type(4) > div:nth-of-type(2)'),
        targetPage.locator('::-p-text(Decked vessels)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 84.0728759765625,
            y: 8.34375,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Plan route)'),
        targetPage.locator('#suitability-task-route'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-route\\"])'),
        targetPage.locator(':scope >>> #suitability-task-route'),
        targetPage.locator('::-p-text(Plan route)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 29,
            y: 23.75,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Draw route)'),
        targetPage.locator('#suitability-task-panel div:nth-of-type(1) > button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[1]/button)'),
        targetPage.locator(':scope >>> #suitability-task-panel div:nth-of-type(1) > button'),
        targetPage.locator('::-p-text(Draw route)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 84.8228759765625,
            y: 11.5728759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Draw route)'),
        targetPage.locator('#suitability-task-panel div:nth-of-type(1) > button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[1]/button)'),
        targetPage.locator(':scope >>> #suitability-task-panel div:nth-of-type(1) > button'),
        targetPage.locator('::-p-text(Draw route)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 68.8228759765625,
            y: 6.5728759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Draw route)'),
        targetPage.locator('#suitability-task-panel div:nth-of-type(1) > button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[1]/button)'),
        targetPage.locator(':scope >>> #suitability-task-panel div:nth-of-type(1) > button'),
        targetPage.locator('::-p-text(Draw route)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 56.8228759765625,
            y: 7.5728759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 344,
            y: 700,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 520,
            y: 673,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 666,
            y: 663,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 670,
            y: 570,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 586,
            y: 484,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 364,
            y: 426,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 306,
            y: 353,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 497,
            y: 340,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 636,
            y: 284,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 634,
            y: 186,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 363,
            y: 190,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 347,
            y: 78,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 626,
            y: 67,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 712,
            y: 164,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 422,
            y: 268,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 328,
            y: 309,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 566,
            y: 414,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 686,
            y: 480,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 423,
            y: 574,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Map)'),
        targetPage.locator('canvas'),
        targetPage.locator('::-p-xpath(//*[@id=\\"map\\"]/div[1]/canvas)'),
        targetPage.locator(':scope >>> canvas')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 483,
            y: 637,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Run forecast)'),
        targetPage.locator('#suitability-task-panel button:nth-of-type(3)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[3]/button[3])'),
        targetPage.locator(':scope >>> #suitability-task-panel button:nth-of-type(3)'),
        targetPage.locator('::-p-text(Run forecast)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 85.8228759765625,
            y: 4.52081298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Download PDF)'),
        targetPage.locator('div:nth-of-type(4) > button'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[4]/button)'),
        targetPage.locator(':scope >>> div:nth-of-type(4) > button'),
        targetPage.locator('::-p-text(Download PDF)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 60.145751953125,
            y: 21.6353759765625,
          },
        });
}
await lhFlow.endTimespan();
await lhFlow.startNavigation();
{
    const targetPage = page;
    await targetPage.goto('edge://downloads-hub/');
}
await lhFlow.endNavigation();
await lhFlow.startTimespan();
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Close)'),
        targetPage.locator('button.bottom-offcanvas__close'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[2]/button[2])'),
        targetPage.locator(':scope >>> button.bottom-offcanvas__close')
    ])
        .setTimeout(timeout)
        .click({
          count: 2,
          offset: {
            x: 379,
            y: 218,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Compare)'),
        targetPage.locator('#suitability-task-compare'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-compare\\"])'),
        targetPage.locator(':scope >>> #suitability-task-compare'),
        targetPage.locator('::-p-text(Compare)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 36.833251953125,
            y: 16.083328247070312,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Save current)'),
        targetPage.locator('div.map-display-option button:nth-of-type(1)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[1]/div[3]/button[1])'),
        targetPage.locator(':scope >>> div.map-display-option button:nth-of-type(1)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 84.8228759765625,
            y: 24.9375,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Thresholds)'),
        targetPage.locator('#suitability-task-thresholds'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-thresholds\\"])'),
        targetPage.locator(':scope >>> #suitability-task-thresholds'),
        targetPage.locator('::-p-text(Thresholds)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 42.5,
            y: 19.083328247070312,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Custom envelope)'),
        targetPage.locator('#suitability-task-panel button:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[1]/button[2])'),
        targetPage.locator(':scope >>> #suitability-task-panel button:nth-of-type(2)'),
        targetPage.locator('::-p-text(Custom envelope)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 79.875,
            y: 11.635406494140625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Wind caution threshold)'),
        targetPage.locator('#suitability-task-panel > div:nth-of-type(3) > div:nth-of-type(1) input.envelope-range__input--caution'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[3]/div[1]/div[2]/input[1])'),
        targetPage.locator(':scope >>> #suitability-task-panel > div:nth-of-type(3) > div:nth-of-type(1) input.envelope-range__input--caution')
    ])
        .setTimeout(timeout)
        .fill('17');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Wind caution threshold)'),
        targetPage.locator('#suitability-task-panel > div:nth-of-type(3) > div:nth-of-type(1) input.envelope-range__input--caution'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[3]/div[1]/div[2]/input[1])'),
        targetPage.locator(':scope >>> #suitability-task-panel > div:nth-of-type(3) > div:nth-of-type(1) input.envelope-range__input--caution')
    ])
        .setTimeout(timeout)
        .click({
          delay: 1765,
          offset: {
            x: 117.333251953125,
            y: 5.875,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Wind avoid threshold)'),
        targetPage.locator('#suitability-task-panel > div:nth-of-type(3) > div:nth-of-type(1) input.envelope-range__input--avoid'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[3]/div[1]/div[2]/input[2])'),
        targetPage.locator(':scope >>> #suitability-task-panel > div:nth-of-type(3) > div:nth-of-type(1) input.envelope-range__input--avoid')
    ])
        .setTimeout(timeout)
        .fill('25');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Wind avoid threshold)'),
        targetPage.locator('#suitability-task-panel > div:nth-of-type(3) > div:nth-of-type(1) input.envelope-range__input--avoid'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[3]/div[1]/div[2]/input[2])'),
        targetPage.locator(':scope >>> #suitability-task-panel > div:nth-of-type(3) > div:nth-of-type(1) input.envelope-range__input--avoid')
    ])
        .setTimeout(timeout)
        .click({
          delay: 2075.7999999998137,
          offset: {
            x: 165.333251953125,
            y: 3.875,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Wave avoid threshold)'),
        targetPage.locator('div:nth-of-type(3) > div:nth-of-type(2) input.envelope-range__input--avoid'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[3]/div[2]/div[2]/input[2])'),
        targetPage.locator(':scope >>> div:nth-of-type(3) > div:nth-of-type(2) input.envelope-range__input--avoid')
    ])
        .setTimeout(timeout)
        .fill('3');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Wave avoid threshold)'),
        targetPage.locator('div:nth-of-type(3) > div:nth-of-type(2) input.envelope-range__input--avoid'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[3]/div[2]/div[2]/input[2])'),
        targetPage.locator(':scope >>> div:nth-of-type(3) > div:nth-of-type(2) input.envelope-range__input--avoid')
    ])
        .setTimeout(timeout)
        .click({
          delay: 2135.899999999907,
          offset: {
            x: 165.333251953125,
            y: 18.59375,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Wave caution threshold)'),
        targetPage.locator('div:nth-of-type(3) > div:nth-of-type(2) input.envelope-range__input--caution'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[3]/div[2]/div[2]/input[1])'),
        targetPage.locator(':scope >>> div:nth-of-type(3) > div:nth-of-type(2) input.envelope-range__input--caution')
    ])
        .setTimeout(timeout)
        .fill('2.3');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Wave caution threshold)'),
        targetPage.locator('div:nth-of-type(3) > div:nth-of-type(2) input.envelope-range__input--caution'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[3]/div[2]/div[2]/input[1])'),
        targetPage.locator(':scope >>> div:nth-of-type(3) > div:nth-of-type(2) input.envelope-range__input--caution')
    ])
        .setTimeout(timeout)
        .click({
          delay: 2908.399999999907,
          offset: {
            x: 132.333251953125,
            y: 18.59375,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Save ranges)'),
        targetPage.locator('button.envelope-save-btn'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[3]/div[3]/div/button[2])'),
        targetPage.locator(':scope >>> button.envelope-save-btn'),
        targetPage.locator('::-p-text(Save ranges)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 44.020751953125,
            y: 17.1353759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Plan route)'),
        targetPage.locator('#suitability-task-route'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-route\\"])'),
        targetPage.locator(':scope >>> #suitability-task-route'),
        targetPage.locator('::-p-text(Plan route)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 40,
            y: 22.75,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Run forecast)'),
        targetPage.locator('#suitability-task-panel button:nth-of-type(3)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[3]/button[3])'),
        targetPage.locator(':scope >>> #suitability-task-panel button:nth-of-type(3)'),
        targetPage.locator('::-p-text(Run forecast)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 77.8228759765625,
            y: 18.510406494140625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Close)'),
        targetPage.locator('button.bottom-offcanvas__close'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[2]/button[2])'),
        targetPage.locator(':scope >>> button.bottom-offcanvas__close')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 32,
            y: 12.33331298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div.controls-panel'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[2])'),
        targetPage.locator(':scope >>> div.controls-panel')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 380,
            y: 216,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Compare)'),
        targetPage.locator('#suitability-task-compare'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-compare\\"])'),
        targetPage.locator(':scope >>> #suitability-task-compare'),
        targetPage.locator('::-p-text(Compare)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 20.833251953125,
            y: 10.75,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Plan route)'),
        targetPage.locator('#suitability-task-route'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-route\\"])'),
        targetPage.locator(':scope >>> #suitability-task-route'),
        targetPage.locator('::-p-text(Plan route)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 38,
            y: 7.75,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('button:nth-of-type(2) > div:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-forecast\\"]/div[2]/div[1]/button[2]/div[2])'),
        targetPage.locator(':scope >>> button:nth-of-type(2) > div:nth-of-type(2)'),
        targetPage.locator('::-p-text(Dinghies, open)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 155.0728759765625,
            y: 2.6145782470703125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('button:nth-of-type(2) > div:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-forecast\\"]/div[2]/div[1]/button[2]/div[2])'),
        targetPage.locator(':scope >>> button:nth-of-type(2) > div:nth-of-type(2)'),
        targetPage.locator('::-p-text(Dinghies, open)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 155.0728759765625,
            y: 2.6145782470703125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Thresholds)'),
        targetPage.locator('#suitability-task-thresholds'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-thresholds\\"])'),
        targetPage.locator(':scope >>> #suitability-task-thresholds'),
        targetPage.locator('::-p-text(Thresholds)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 29.5,
            y: 5.75,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Vessel preset)'),
        targetPage.locator('div.map-display-option__segmented > button:nth-of-type(1)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[1]/button[1])'),
        targetPage.locator(':scope >>> div.map-display-option__segmented > button:nth-of-type(1)'),
        targetPage.locator('::-p-text(Vessel preset)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 83.8228759765625,
            y: 18.96875,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Vessel preset)'),
        targetPage.locator('div.map-display-option__segmented > button:nth-of-type(1)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[1]/button[1])'),
        targetPage.locator(':scope >>> div.map-display-option__segmented > button:nth-of-type(1)'),
        targetPage.locator('::-p-text(Vessel preset)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 69.8228759765625,
            y: 17.96875,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Plan route)'),
        targetPage.locator('#suitability-task-route'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-route\\"])'),
        targetPage.locator(':scope >>> #suitability-task-route'),
        targetPage.locator('::-p-text(Plan route)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 52,
            y: 1.75,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Run forecast)'),
        targetPage.locator('#suitability-task-panel button:nth-of-type(3)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[3]/button[3])'),
        targetPage.locator(':scope >>> #suitability-task-panel button:nth-of-type(3)'),
        targetPage.locator('::-p-text(Run forecast)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 92.8228759765625,
            y: 11.1875,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Close)'),
        targetPage.locator('button.bottom-offcanvas__close'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[2]/button[2])'),
        targetPage.locator(':scope >>> button.bottom-offcanvas__close')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 12,
            y: 13.33331298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Compare)'),
        targetPage.locator('#suitability-task-compare'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-compare\\"])'),
        targetPage.locator(':scope >>> #suitability-task-compare'),
        targetPage.locator('::-p-text(Compare)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 22.833251953125,
            y: 16.75,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Save current)'),
        targetPage.locator('div.map-display-option__segmented > button:nth-of-type(1)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[1]/div[3]/button[1])'),
        targetPage.locator(':scope >>> div.map-display-option__segmented > button:nth-of-type(1)'),
        targetPage.locator('::-p-text(Save current)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 58.8228759765625,
            y: 20.6041259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Run all)'),
        targetPage.locator('div.map-display-option__segmented > button:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[1]/div[3]/button[2])'),
        targetPage.locator(':scope >>> div.map-display-option__segmented > button:nth-of-type(2)'),
        targetPage.locator('::-p-text(Run all)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 91.875,
            y: 6.9375,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Compare[role=\\"tabpanel\\"]) >>>> ::-p-aria([role=\\"table\\"])'),
        targetPage.locator('#root table'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[1]/div[6]/table)'),
        targetPage.locator(':scope >>> #root table')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 150.333251953125,
            y: 44.416656494140625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(100%)'),
        targetPage.locator('#root tr:nth-of-type(2) > td:nth-of-type(3)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[1]/div[6]/table/tbody/tr[2]/td[3])'),
        targetPage.locator(':scope >>> #root tr:nth-of-type(2) > td:nth-of-type(3)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 8.9166259765625,
            y: 17.70831298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Generate Scenario Comparison Brief)'),
        targetPage.locator('div.map-display-option > button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[1]/button)'),
        targetPage.locator(':scope >>> div.map-display-option > button'),
        targetPage.locator('::-p-text(Generate Scenario)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 146.333251953125,
            y: 17.9375,
          },
        });
}
await lhFlow.endTimespan();
await lhFlow.startNavigation();
{
    const targetPage = page;
    await targetPage.goto('edge://downloads-hub/');
}
await lhFlow.endNavigation();
await lhFlow.startTimespan();
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Compare landing areas)'),
        targetPage.locator('#suitability-task-panel > button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/button)'),
        targetPage.locator(':scope >>> #suitability-task-panel > button'),
        targetPage.locator('::-p-text(Compare landing)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 147.333251953125,
            y: 25.75,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(This location)'),
        targetPage.locator('div.bottom-offcanvas__body button:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[2]/div/button[2])'),
        targetPage.locator(':scope >>> div.bottom-offcanvas__body button:nth-of-type(2)'),
        targetPage.locator('::-p-text(This location)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 46.385414123535156,
            y: 8.61456298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Compare all)'),
        targetPage.locator('div.bottom-offcanvas div:nth-of-type(2) > div > button:nth-of-type(1)'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[2]/div/button[1])'),
        targetPage.locator(':scope >>> div.bottom-offcanvas div:nth-of-type(2) > div > button:nth-of-type(1)'),
        targetPage.locator('::-p-text(Compare all)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 50,
            y: 17.375,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Export PDF)'),
        targetPage.locator('div.bottom-offcanvas__body div:nth-of-type(2) > button'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[2]/button)'),
        targetPage.locator(':scope >>> div.bottom-offcanvas__body div:nth-of-type(2) > button'),
        targetPage.locator('::-p-text(Export PDF)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 40.927001953125,
            y: 16.947906494140625,
          },
        });
}
await lhFlow.endTimespan();
await lhFlow.startNavigation();
{
    const targetPage = page;
    await targetPage.goto('edge://downloads-hub/');
}
await lhFlow.endNavigation();
await lhFlow.startTimespan();
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(This location)'),
        targetPage.locator('div.bottom-offcanvas__body button:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[2]/div/button[2])'),
        targetPage.locator(':scope >>> div.bottom-offcanvas__body button:nth-of-type(2)'),
        targetPage.locator('::-p-text(This location)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 38.385414123535156,
            y: 17.61456298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Close)'),
        targetPage.locator('button.bottom-offcanvas__close'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[2]/button[2])'),
        targetPage.locator(':scope >>> button.bottom-offcanvas__close')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 15,
            y: 20.760406494140625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Export)'),
        targetPage.locator('#suitability-task-export'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-export\\"])'),
        targetPage.locator(':scope >>> #suitability-task-export'),
        targetPage.locator('::-p-text(Export)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 57.6666259765625,
            y: 5.08331298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Configure & download…)'),
        targetPage.locator('#suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(1) button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[1]/div/button)'),
        targetPage.locator(':scope >>> #suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(1) button'),
        targetPage.locator('::-p-text(Configure & download…)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 73.739501953125,
            y: 21.541656494140625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Generate PDF)'),
        targetPage.locator('#suitability-task-panel button:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[4]/button[2])'),
        targetPage.locator(':scope >>> #suitability-task-panel button:nth-of-type(2)'),
        targetPage.locator('::-p-text(Generate PDF)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 61.25,
            y: 23.708328247070312,
          },
        });
}
await lhFlow.endTimespan();
await lhFlow.startNavigation();
{
    const targetPage = page;
    await targetPage.goto('edge://downloads-hub/');
}
await lhFlow.endNavigation();
await lhFlow.startTimespan();
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Configure & download…)'),
        targetPage.locator('#suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(1) button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[1]/div/button)'),
        targetPage.locator(':scope >>> #suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(1) button'),
        targetPage.locator('::-p-text(Configure & download…)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 93.739501953125,
            y: 18.875,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Report)'),
        targetPage.locator('label:nth-of-type(1) > select'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[2]/label[1]/select)'),
        targetPage.locator(':scope >>> label:nth-of-type(1) > select')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 155.739501953125,
            y: 8.229156494140625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('label:nth-of-type(3)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[2]/label[3])'),
        targetPage.locator(':scope >>> label:nth-of-type(3)'),
        targetPage.locator('::-p-text(Areaviewport)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 107.739501953125,
            y: 10.510406494140625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Vessel)'),
        targetPage.locator('label:nth-of-type(2) > select'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[2]/label[2]/select)'),
        targetPage.locator(':scope >>> label:nth-of-type(2) > select'),
        targetPage.locator('::-p-text(very_small_motorised_craft)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 85.739501953125,
            y: 15.229156494140625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Vessel)'),
        targetPage.locator('label:nth-of-type(2) > select'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[2]/label[2]/select)'),
        targetPage.locator(':scope >>> label:nth-of-type(2) > select'),
        targetPage.locator('::-p-text(very_small_motorised_craft)')
    ])
        .setTimeout(timeout)
        .fill('small_craft');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Area)'),
        targetPage.locator('label:nth-of-type(3) > select'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[2]/label[3]/select)'),
        targetPage.locator(':scope >>> label:nth-of-type(3) > select'),
        targetPage.locator('::-p-text(viewport)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 163.739501953125,
            y: 16.229156494140625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Area)'),
        targetPage.locator('label:nth-of-type(3) > select'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[2]/label[3]/select)'),
        targetPage.locator(':scope >>> label:nth-of-type(3) > select'),
        targetPage.locator('::-p-text(viewport)')
    ])
        .setTimeout(timeout)
        .fill('domain');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Period)'),
        targetPage.locator('label:nth-of-type(4) > select'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[2]/label[4]/select)'),
        targetPage.locator(':scope >>> label:nth-of-type(4) > select')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 123.739501953125,
            y: 22.83331298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Period)'),
        targetPage.locator('label:nth-of-type(4) > select'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[2]/label[4]/select)'),
        targetPage.locator(':scope >>> label:nth-of-type(4) > select')
    ])
        .setTimeout(timeout)
        .fill('168');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Generate PDF)'),
        targetPage.locator('#suitability-task-panel button:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[4]/button[2])'),
        targetPage.locator(':scope >>> #suitability-task-panel button:nth-of-type(2)'),
        targetPage.locator('::-p-text(Generate PDF)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 81.25,
            y: 18.4375,
          },
        });
}
await lhFlow.endTimespan();
await lhFlow.startNavigation();
{
    const targetPage = page;
    await targetPage.goto('edge://downloads-hub/');
}
await lhFlow.endNavigation();
await lhFlow.startTimespan();
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Suitability Tools)'),
        targetPage.locator('div:nth-of-type(3) > h3'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-forecast\\"]/div[3]/h3)'),
        targetPage.locator(':scope >>> div:nth-of-type(3) > h3'),
        targetPage.locator('::-p-text(Suitability Tools)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 232,
            y: 4.1666259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Configure & download…)'),
        targetPage.locator('#suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(1) button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[1]/div/button)'),
        targetPage.locator(':scope >>> #suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(1) button'),
        targetPage.locator('::-p-text(Configure & download…)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 84.739501953125,
            y: 20.875,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Report)'),
        targetPage.locator('label:nth-of-type(1) > select'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[2]/label[1]/select)'),
        targetPage.locator(':scope >>> label:nth-of-type(1) > select')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 151.739501953125,
            y: 19.229156494140625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Report)'),
        targetPage.locator('label:nth-of-type(1) > select'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[2]/label[1]/select)'),
        targetPage.locator(':scope >>> label:nth-of-type(1) > select')
    ])
        .setTimeout(timeout)
        .fill('poster');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Area)'),
        targetPage.locator('label:nth-of-type(3) > select'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[2]/label[3]/select)'),
        targetPage.locator(':scope >>> label:nth-of-type(3) > select'),
        targetPage.locator('::-p-text(viewport)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 137.739501953125,
            y: 17.229156494140625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Area)'),
        targetPage.locator('label:nth-of-type(3) > select'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[2]/label[3]/select)'),
        targetPage.locator(':scope >>> label:nth-of-type(3) > select'),
        targetPage.locator('::-p-text(viewport)')
    ])
        .setTimeout(timeout)
        .fill('domain');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Period)'),
        targetPage.locator('label:nth-of-type(4) > select'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[2]/label[4]/select)'),
        targetPage.locator(':scope >>> label:nth-of-type(4) > select'),
        targetPage.locator('::-p-text(168)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 135.739501953125,
            y: 10.83331298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Period)'),
        targetPage.locator('label:nth-of-type(4) > select'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[2]/label[4]/select)'),
        targetPage.locator(':scope >>> label:nth-of-type(4) > select'),
        targetPage.locator('::-p-text(168)')
    ])
        .setTimeout(timeout)
        .fill('72');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Generate PDF)'),
        targetPage.locator('#suitability-task-panel button:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[5]/div/div[4]/button[2])'),
        targetPage.locator(':scope >>> #suitability-task-panel button:nth-of-type(2)'),
        targetPage.locator('::-p-text(Generate PDF)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 69.25,
            y: 16.4375,
          },
        });
}
await lhFlow.endTimespan();
await lhFlow.startNavigation();
{
    const targetPage = page;
    await targetPage.goto('edge://downloads-hub/');
}
await lhFlow.endNavigation();
await lhFlow.startTimespan();
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Export[role=\\"tabpanel\\"])'),
        targetPage.locator('#suitability-task-panel'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"])'),
        targetPage.locator(':scope >>> #suitability-task-panel')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 318,
            y: 10.4791259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('#suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(2) button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[2]/div/button)'),
        targetPage.locator(':scope >>> #suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(2) button')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 89.739501953125,
            y: 15.34375,
          },
        });
}
await lhFlow.endTimespan();
await lhFlow.startNavigation();
{
    const targetPage = page;
    await targetPage.goto('edge://downloads-hub/');
}
await lhFlow.endNavigation();
await lhFlow.startTimespan();
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('#suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(3) div:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[3]/div/div[2])'),
        targetPage.locator(':scope >>> #suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(3) div:nth-of-type(2)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 58.739501953125,
            y: 19.5625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('#suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(3) button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[3]/div/button)'),
        targetPage.locator(':scope >>> #suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(3) button')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 57.739501953125,
            y: 19.8125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div.controls-panel div:nth-of-type(4) > div'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[4]/div)'),
        targetPage.locator(':scope >>> div.controls-panel div:nth-of-type(4) > div')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 48.739501953125,
            y: 55.14581298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Compare & export)'),
        targetPage.locator('div:nth-of-type(4) button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-panel\\"]/div[2]/div[4]/div/button)'),
        targetPage.locator(':scope >>> div:nth-of-type(4) button'),
        targetPage.locator('::-p-text(Compare & export)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 75.739501953125,
            y: 12.28125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Export PDF)'),
        targetPage.locator('div.bottom-offcanvas__body div:nth-of-type(2) > button'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[2]/button)'),
        targetPage.locator(':scope >>> div.bottom-offcanvas__body div:nth-of-type(2) > button'),
        targetPage.locator('::-p-text(Export PDF)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 38.927001953125,
            y: 9.947906494140625,
          },
        });
}
await lhFlow.endTimespan();
await lhFlow.startNavigation();
{
    const targetPage = page;
    await targetPage.goto('edge://downloads-hub/');
}
await lhFlow.endNavigation();
await lhFlow.startTimespan();
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div.bottom-offcanvas__header > div'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[2]/div)'),
        targetPage.locator(':scope >>> div.bottom-offcanvas__header > div')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 1169,
            y: 46,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Close)'),
        targetPage.locator('button.bottom-offcanvas__close'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[2]/button[2])'),
        targetPage.locator(':scope >>> button.bottom-offcanvas__close')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 32,
            y: 17,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Select island to fly to)'),
        targetPage.locator('#island-zoom-select'),
        targetPage.locator('::-p-xpath(//*[@id=\\"island-zoom-select\\"])'),
        targetPage.locator(':scope >>> #island-zoom-select'),
        targetPage.locator('::-p-text(aitutaki)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 193.6041259765625,
            y: 17.5416259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Select island to fly to)'),
        targetPage.locator('#island-zoom-select'),
        targetPage.locator('::-p-xpath(//*[@id=\\"island-zoom-select\\"])'),
        targetPage.locator(':scope >>> #island-zoom-select'),
        targetPage.locator('::-p-text(aitutaki)')
    ])
        .setTimeout(timeout)
        .fill('penrhyn');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div:nth-of-type(4) > label'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-forecast\\"]/div[4]/label)'),
        targetPage.locator(':scope >>> div:nth-of-type(4) > label'),
        targetPage.locator('::-p-text(Show coastal)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 102,
            y: 12.53125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Show coastal risk points)'),
        targetPage.locator('div:nth-of-type(4) input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-forecast\\"]/div[4]/label/input)'),
        targetPage.locator(':scope >>> div:nth-of-type(4) input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 102,
            y: 9.67706298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div:nth-of-type(4) > label'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-forecast\\"]/div[4]/label)'),
        targetPage.locator(':scope >>> div:nth-of-type(4) > label'),
        targetPage.locator('::-p-text(Show coastal)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 102,
            y: 12.53125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Show coastal risk points)'),
        targetPage.locator('div:nth-of-type(4) input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-forecast\\"]/div[4]/label/input)'),
        targetPage.locator(':scope >>> div:nth-of-type(4) input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 102,
            y: 9.67706298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Compare)'),
        targetPage.locator('#suitability-task-compare'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-compare\\"])'),
        targetPage.locator(':scope >>> #suitability-task-compare')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 22.833251953125,
            y: 12.75,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Thresholds)'),
        targetPage.locator('#suitability-task-thresholds'),
        targetPage.locator('::-p-xpath(//*[@id=\\"suitability-task-thresholds\\"])'),
        targetPage.locator(':scope >>> #suitability-task-thresholds'),
        targetPage.locator('::-p-text(Thresholds)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 32.5,
            y: 10.75,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Inundation & Impacts)'),
        targetPage.locator('#right-panel-tab-impacts'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-tab-impacts\\"])'),
        targetPage.locator(':scope >>> #right-panel-tab-impacts'),
        targetPage.locator('::-p-text(Inundation &)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 66.46875,
            y: 15,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Sep 28 – Oct 1)'),
        targetPage.locator('#right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(1) button:nth-of-type(1)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[1]/div[2]/div[1]/div[2]/button[1])'),
        targetPage.locator(':scope >>> #right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(1) button:nth-of-type(1)'),
        targetPage.locator('::-p-text(Sep 28 – Oct)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 12,
            y: 15.1875,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Show the impact window on the map)'),
        targetPage.locator('#right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(1) > button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[1]/div[1]/button)'),
        targetPage.locator(':scope >>> #right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(1) > button'),
        targetPage.locator('::-p-text(Show the impact)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 47.9375,
            y: 16.125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Advanced: land flooded above the tide line)'),
        targetPage.locator('div.controls-panel details:nth-of-type(1) > summary'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[1]/div[2]/details[1]/summary)'),
        targetPage.locator(':scope >>> div.controls-panel details:nth-of-type(1) > summary'),
        targetPage.locator('::-p-text(Advanced: land)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 183,
            y: 10.20831298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(≥ 5 cm)'),
        targetPage.locator('details:nth-of-type(1) button:nth-of-type(1)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[1]/div[2]/details[1]/div/div/div[1]/div/button[1])'),
        targetPage.locator(':scope >>> details:nth-of-type(1) button:nth-of-type(1)'),
        targetPage.locator('::-p-text(≥ 5 cm)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 20.520751953125,
            y: 10.92706298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Why don’t these numbers match?)'),
        targetPage.locator('details:nth-of-type(2) > summary'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[1]/div[2]/details[2]/summary)'),
        targetPage.locator(':scope >>> details:nth-of-type(2) > summary'),
        targetPage.locator('::-p-text(Why don’t these)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 133,
            y: 9.4375,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(View detailed table)'),
        targetPage.locator('#right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(2) > button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[1]/div[2]/button)'),
        targetPage.locator(':scope >>> #right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(2) > button'),
        targetPage.locator('::-p-text(View detailed)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 237,
            y: 12.1041259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Severity)'),
        targetPage.locator('select'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[5]/div[1]/label[2]/select)'),
        targetPage.locator(':scope >>> select')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 81.375,
            y: 5.1978759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Severity)'),
        targetPage.locator('select'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[5]/div[1]/label[2]/select)'),
        targetPage.locator(':scope >>> select')
    ])
        .setTimeout(timeout)
        .fill('high');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Severity)'),
        targetPage.locator('select'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[5]/div[1]/label[2]/select)'),
        targetPage.locator(':scope >>> select')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 29.375,
            y: 8.84375,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Severity)'),
        targetPage.locator('select'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[5]/div[1]/label[2]/select)'),
        targetPage.locator(':scope >>> select')
    ])
        .setTimeout(timeout)
        .fill('');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div.bottom-offcanvas label:nth-of-type(1)'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[5]/div[1]/label[1])'),
        targetPage.locator(':scope >>> div.bottom-offcanvas label:nth-of-type(1)'),
        targetPage.locator('::-p-text(Affected only)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 41.20833206176758,
            y: 7.4478759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Affected only)'),
        targetPage.locator('div.bottom-offcanvas input'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[5]/div[1]/label[1]/input)'),
        targetPage.locator(':scope >>> div.bottom-offcanvas input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 41.20833206176758,
            y: 5.3125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div.bottom-offcanvas label:nth-of-type(1)'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[5]/div[1]/label[1])'),
        targetPage.locator(':scope >>> div.bottom-offcanvas label:nth-of-type(1)'),
        targetPage.locator('::-p-text(Affected only)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 41.20833206176758,
            y: 7.4478759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Affected only)'),
        targetPage.locator('div.bottom-offcanvas input'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[5]/div[1]/label[1]/input)'),
        targetPage.locator(':scope >>> div.bottom-offcanvas input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 41.20833206176758,
            y: 5.3125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Show all 14)'),
        targetPage.locator('div:nth-of-type(5) > div:nth-of-type(2) > button'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[5]/div[2]/button)'),
        targetPage.locator(':scope >>> div:nth-of-type(5) > div:nth-of-type(2) > button'),
        targetPage.locator('::-p-text(Show all 14)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 52.92707824707031,
            y: 1.40625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Low–Medium Residential· 1 affected / 3)'),
        targetPage.locator('div.bottom-offcanvas div:nth-of-type(1) > button'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[5]/div[2]/div[1]/button)'),
        targetPage.locator(':scope >>> div.bottom-offcanvas div:nth-of-type(1) > button'),
        targetPage.locator('::-p-text(Low–MediumResidential·)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 224,
            y: 1.40625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Detailed analysis: districts)'),
        targetPage.locator('div.bottom-offcanvas__body > div > details:nth-of-type(1) > summary'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/details[1]/summary)'),
        targetPage.locator(':scope >>> div.bottom-offcanvas__body > div > details:nth-of-type(1) > summary'),
        targetPage.locator('::-p-text(Detailed analysis:)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 127,
            y: 5.27081298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Compare all forecast windows)'),
        targetPage.locator('div.bottom-offcanvas details:nth-of-type(2) > summary'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/details[2]/summary)'),
        targetPage.locator(':scope >>> div.bottom-offcanvas details:nth-of-type(2) > summary'),
        targetPage.locator('::-p-text(Compare all forecast)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 148,
            y: 10.5728759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria([role=\\"dialog\\"]) >>>> ::-p-aria(Why don’t these numbers match?)'),
        targetPage.locator('details:nth-of-type(3) > summary'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/details[3]/summary)'),
        targetPage.locator(':scope >>> details:nth-of-type(3) > summary')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 174,
            y: 8.9166259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria([role=\\"dialog\\"]) >>>> ::-p-aria(Sep 28 – Oct 1[role=\\"button\\"])'),
        targetPage.locator('div.bottom-offcanvas__body > div > div:nth-of-type(2) > button:nth-of-type(1)'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[3]/div/div[2]/button[1])'),
        targetPage.locator(':scope >>> div.bottom-offcanvas__body > div > div:nth-of-type(2) > button:nth-of-type(1)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 44.875,
            y: 9.59375,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Close)'),
        targetPage.locator('button.bottom-offcanvas__close'),
        targetPage.locator('::-p-xpath(/html/body/div[3]/div[2]/button[2])'),
        targetPage.locator(':scope >>> button.bottom-offcanvas__close')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 27,
            y: 15.33331298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Why don’t these numbers match?)'),
        targetPage.locator('details:nth-of-type(2) > summary'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[1]/div[2]/details[2]/summary)'),
        targetPage.locator(':scope >>> details:nth-of-type(2) > summary'),
        targetPage.locator('::-p-text(Why don’t these)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 109,
            y: 9.1041259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('#right-panel-panel-impacts > div:nth-of-type(2) span'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/button/span)'),
        targetPage.locator(':scope >>> #right-panel-panel-impacts > div:nth-of-type(2) span'),
        targetPage.locator('::-p-text(layers, time)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 189.989501953125,
            y: 2.05206298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div:nth-of-type(2) > div > div:nth-of-type(1) > label:nth-of-type(1)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[1])'),
        targetPage.locator(':scope >>> div:nth-of-type(2) > div > div:nth-of-type(1) > label:nth-of-type(1)'),
        targetPage.locator('::-p-text(District damage)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 34,
            y: 7.791656494140625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(District damage)'),
        targetPage.locator('label:nth-of-type(1) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[1]/input)'),
        targetPage.locator(':scope >>> label:nth-of-type(1) > input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 34,
            y: 3.260406494140625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('label:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[2])'),
        targetPage.locator(':scope >>> label:nth-of-type(2)'),
        targetPage.locator('::-p-text(Coastal risk)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 34,
            y: 5.7291259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Coastal risk points)'),
        targetPage.locator('label:nth-of-type(2) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[2]/input)'),
        targetPage.locator(':scope >>> label:nth-of-type(2) > input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 34,
            y: 1.1978759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('label:nth-of-type(3)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[3])'),
        targetPage.locator(':scope >>> label:nth-of-type(3)'),
        targetPage.locator('::-p-text(MHWS + 17.5 cm line)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 56,
            y: 15.6666259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(MHWS + 17.5 cm line)'),
        targetPage.locator('label:nth-of-type(3) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[3]/input)'),
        targetPage.locator(':scope >>> label:nth-of-type(3) > input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 56,
            y: 11.1353759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('label:nth-of-type(4)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[4])'),
        targetPage.locator(':scope >>> label:nth-of-type(4)'),
        targetPage.locator('::-p-text(Compare lines)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 70,
            y: 14.6041259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Compare lines \\(MHWS, +15, +20 cm\\))'),
        targetPage.locator('label:nth-of-type(4) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[4]/input)'),
        targetPage.locator(':scope >>> label:nth-of-type(4) > input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 70,
            y: 10.0728759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('label:nth-of-type(4)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[4])'),
        targetPage.locator(':scope >>> label:nth-of-type(4)'),
        targetPage.locator('::-p-text(Compare lines)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 71,
            y: 13.6041259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Compare lines \\(MHWS, +15, +20 cm\\))'),
        targetPage.locator('label:nth-of-type(4) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[4]/input)'),
        targetPage.locator(':scope >>> label:nth-of-type(4) > input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 71,
            y: 9.0728759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('label:nth-of-type(5)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[5])'),
        targetPage.locator(':scope >>> label:nth-of-type(5)'),
        targetPage.locator('::-p-text(Flooding above)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 70,
            y: 14.5416259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Flooding above the line)'),
        targetPage.locator('label:nth-of-type(5) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[5]/input)'),
        targetPage.locator(':scope >>> label:nth-of-type(5) > input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 70,
            y: 10.0103759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('label:nth-of-type(4)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[4])'),
        targetPage.locator(':scope >>> label:nth-of-type(4)'),
        targetPage.locator('::-p-text(Compare lines)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 94,
            y: 16.6041259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Compare lines \\(MHWS, +15, +20 cm\\))'),
        targetPage.locator('label:nth-of-type(4) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[4]/input)'),
        targetPage.locator(':scope >>> label:nth-of-type(4) > input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 94,
            y: 12.0728759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('label:nth-of-type(4)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[4])'),
        targetPage.locator(':scope >>> label:nth-of-type(4)'),
        targetPage.locator('::-p-text(Compare lines)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 94,
            y: 16.6041259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Compare lines \\(MHWS, +15, +20 cm\\))'),
        targetPage.locator('label:nth-of-type(4) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[4]/input)'),
        targetPage.locator(':scope >>> label:nth-of-type(4) > input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 94,
            y: 12.0728759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('label:nth-of-type(5)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[5])'),
        targetPage.locator(':scope >>> label:nth-of-type(5)'),
        targetPage.locator('::-p-text(Flooding above)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 82,
            y: 10.5416259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Flooding above the line)'),
        targetPage.locator('label:nth-of-type(5) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[5]/input)'),
        targetPage.locator(':scope >>> label:nth-of-type(5) > input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 82,
            y: 6.0103759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('label:nth-of-type(3)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[3])'),
        targetPage.locator(':scope >>> label:nth-of-type(3)'),
        targetPage.locator('::-p-text(MHWS + 17.5 cm line)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 50,
            y: 15.6666259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(MHWS + 17.5 cm line)'),
        targetPage.locator('label:nth-of-type(3) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[3]/input)'),
        targetPage.locator(':scope >>> label:nth-of-type(3) > input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 50,
            y: 11.1353759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('label:nth-of-type(4)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[4])'),
        targetPage.locator(':scope >>> label:nth-of-type(4)'),
        targetPage.locator('::-p-text(Compare lines)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 62,
            y: 10.6041259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Compare lines \\(MHWS, +15, +20 cm\\))'),
        targetPage.locator('label:nth-of-type(4) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[4]/input)'),
        targetPage.locator(':scope >>> label:nth-of-type(4) > input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 62,
            y: 6.0728759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('label:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[2])'),
        targetPage.locator(':scope >>> label:nth-of-type(2)'),
        targetPage.locator('::-p-text(Coastal risk)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 66,
            y: 0.7291259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div:nth-of-type(2) > div > div:nth-of-type(1) > label:nth-of-type(1)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[1])'),
        targetPage.locator(':scope >>> div:nth-of-type(2) > div > div:nth-of-type(1) > label:nth-of-type(1)'),
        targetPage.locator('::-p-text(District damage)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 68,
            y: 16.791656494140625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(District damage)'),
        targetPage.locator('label:nth-of-type(1) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[1]/label[1]/input)'),
        targetPage.locator(':scope >>> label:nth-of-type(1) > input')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 68,
            y: 12.260406494140625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Edit map depth categories)'),
        targetPage.locator('#right-panel-panel-impacts > div:nth-of-type(2) > div > div:nth-of-type(2) button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[2]/div[1]/button)'),
        targetPage.locator(':scope >>> #right-panel-panel-impacts > div:nth-of-type(2) > div > div:nth-of-type(2) button'),
        targetPage.locator('::-p-text(Edit map depth)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 152,
            y: 7.39581298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Color for Severe Flooding)'),
        targetPage.locator('#ite-color-cok-severe'),
        targetPage.locator('::-p-xpath(//*[@id=\\"ite-color-cok-severe\\"])'),
        targetPage.locator(':scope >>> #ite-color-cok-severe'),
        targetPage.locator('::-p-text(#00b4e5)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 28.14581298828125,
            y: 14.2291259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Color for Severe Flooding)'),
        targetPage.locator('#ite-color-cok-severe'),
        targetPage.locator('::-p-xpath(//*[@id=\\"ite-color-cok-severe\\"])'),
        targetPage.locator(':scope >>> #ite-color-cok-severe'),
        targetPage.locator('::-p-text(#00b4e5)')
    ])
        .setTimeout(timeout)
        .fill('#030303');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div.ite-footer'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div[3]/div[4])'),
        targetPage.locator(':scope >>> div.ite-footer')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 444.33331298828125,
            y: 1.4478759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Save)'),
        targetPage.locator('button.ite-btn-save'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div[3]/div[2]/div[2]/button[6])'),
        targetPage.locator(':scope >>> button.ite-btn-save'),
        targetPage.locator('::-p-text(Save)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 38.364501953125,
            y: 10.145828247070312,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Color for Maximum Display Range)'),
        targetPage.locator('#ite-color-cok-maximum'),
        targetPage.locator('::-p-xpath(//*[@id=\\"ite-color-cok-maximum\\"])'),
        targetPage.locator(':scope >>> #ite-color-cok-maximum'),
        targetPage.locator('::-p-text(#c80000)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 23.14581298828125,
            y: 11.4375,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Color for Maximum Display Range)'),
        targetPage.locator('#ite-color-cok-maximum'),
        targetPage.locator('::-p-xpath(//*[@id=\\"ite-color-cok-maximum\\"])'),
        targetPage.locator(':scope >>> #ite-color-cok-maximum'),
        targetPage.locator('::-p-text(#c80000)')
    ])
        .setTimeout(timeout)
        .fill('#303030');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div.ite-body'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div[3]/div[3])'),
        targetPage.locator(':scope >>> div.ite-body')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 207.33331298828125,
            y: 707.9270782470703,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Save)'),
        targetPage.locator('button.ite-btn-save'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div[3]/div[2]/div[2]/button[6])'),
        targetPage.locator(':scope >>> button.ite-btn-save'),
        targetPage.locator('::-p-text(Save)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 34.364501953125,
            y: 26.145828247070312,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div.ite-header svg'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div[3]/div[1]/button/svg)'),
        targetPage.locator(':scope >>> div.ite-header svg')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 7.2603759765625,
            y: 12.541666030883789,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('button:nth-of-type(3) > span.ft-day-label'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[1]/div[5]/div[1]/div/button[3]/span[2])'),
        targetPage.locator(':scope >>> button:nth-of-type(3) > span.ft-day-label'),
        targetPage.locator('::-p-text(Mon 28 Sept)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 36.64581298828125,
            y: 8.0416259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('button:nth-of-type(4) > span.ft-day-label'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[1]/div[5]/div[1]/div/button[4]/span[2])'),
        targetPage.locator(':scope >>> button:nth-of-type(4) > span.ft-day-label'),
        targetPage.locator('::-p-text(Tue 29 Sept)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 32.140625,
            y: 8.0416259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Thu 1 Oct)'),
        targetPage.locator('button:nth-of-type(6)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[1]/div[5]/div[1]/div/button[6])'),
        targetPage.locator(':scope >>> button:nth-of-type(6)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 29.015625,
            y: 5.0416259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(48h Max)'),
        targetPage.locator('#right-panel-panel-impacts > div:nth-of-type(2) button:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[3]/div/div/button[2])'),
        targetPage.locator(':scope >>> #right-panel-panel-impacts > div:nth-of-type(2) button:nth-of-type(2)'),
        targetPage.locator('::-p-text(48h Max)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 47.7603759765625,
            y: 23.25,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Fri 2 Oct)'),
        targetPage.locator('button:nth-of-type(7)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[1]/div[5]/div[1]/div/button[7])'),
        targetPage.locator(':scope >>> button:nth-of-type(7)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 8.9635009765625,
            y: 9.0416259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Fri 2 Oct)'),
        targetPage.locator('button:nth-of-type(7)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[1]/div[5]/div[1]/div/button[7])'),
        targetPage.locator(':scope >>> button:nth-of-type(7)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 29.9635009765625,
            y: 7.0416259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('button:nth-of-type(8) > span.ft-day-label'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[1]/div[5]/div[1]/div/button[8]/span[2])'),
        targetPage.locator(':scope >>> button:nth-of-type(8) > span.ft-day-label'),
        targetPage.locator('::-p-text(Sat 3 Oct)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 26.86456298828125,
            y: 1.0416259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('button:nth-of-type(8) > span.ft-day-label'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[1]/div[5]/div[1]/div/button[8]/span[2])'),
        targetPage.locator(':scope >>> button:nth-of-type(8) > span.ft-day-label'),
        targetPage.locator('::-p-text(Sat 3 Oct)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 28.86456298828125,
            y: 8.0416259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('button:nth-of-type(4) > span.ft-day-label'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[1]/div[5]/div[1]/div/button[4]/span[2])'),
        targetPage.locator(':scope >>> button:nth-of-type(4) > span.ft-day-label'),
        targetPage.locator('::-p-text(Tue 29 Sept)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 18.140625,
            y: 3.0416259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Forecast timeline)'),
        targetPage.locator('div.ft-root'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[1]/div[5])'),
        targetPage.locator(':scope >>> div.ft-root')
    ])
        .setTimeout(timeout)
        .click({
          delay: 471.1999999997206,
          offset: {
            x: 721,
            y: 59.70831298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Custom Max)'),
        targetPage.locator('div.controls-panel button:nth-of-type(3)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[3]/div/div[1]/button[3])'),
        targetPage.locator(':scope >>> div.controls-panel button:nth-of-type(3)'),
        targetPage.locator('::-p-text(Custom Max)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 80.84375,
            y: 13.25,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div.controls-panel div:nth-of-type(2) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[3]/div/div[2]/div/div[2]/input)'),
        targetPage.locator(':scope >>> div.controls-panel div:nth-of-type(2) > input'),
        targetPage.locator('::-p-text(2026-10-03T00:00)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 160.46875,
            y: 11.1978759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div.controls-panel div:nth-of-type(2) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[3]/div/div[2]/div/div[2]/input)'),
        targetPage.locator(':scope >>> div.controls-panel div:nth-of-type(2) > input'),
        targetPage.locator('::-p-text(2026-10-03T00:00)')
    ])
        .setTimeout(timeout)
        .fill('2026-09-30T00:00');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Inundation Window)'),
        targetPage.locator('#right-panel-panel-impacts > div:nth-of-type(2) div:nth-of-type(3) > h3'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[3]/h3)'),
        targetPage.locator(':scope >>> #right-panel-panel-impacts > div:nth-of-type(2) div:nth-of-type(3) > h3'),
        targetPage.locator('::-p-text(Inundation Window)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 94,
            y: 11.33331298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Apply)'),
        targetPage.locator('#right-panel-panel-impacts > div:nth-of-type(2) > div div:nth-of-type(2) > button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[3]/div/div[2]/button)'),
        targetPage.locator(':scope >>> #right-panel-panel-impacts > div:nth-of-type(2) > div div:nth-of-type(2) > button')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 32,
            y: 22.6041259765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div.controls-panel div:nth-of-type(2) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[3]/div/div[2]/div[1]/div[2]/input)'),
        targetPage.locator(':scope >>> div.controls-panel div:nth-of-type(2) > input'),
        targetPage.locator('::-p-text(2026-09-30T00:00)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 165.46875,
            y: 13.1978759765625,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('div.controls-panel div:nth-of-type(2) > input'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[3]/div/div[2]/div/div[2]/input)'),
        targetPage.locator(':scope >>> div.controls-panel div:nth-of-type(2) > input'),
        targetPage.locator('::-p-text(2026-10-03T00:00)')
    ])
        .setTimeout(timeout)
        .fill('2026-10-04T00:00');
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('#right-panel-panel-impacts > div:nth-of-type(2) div:nth-of-type(3) > div > div:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[3]/div/div[2])'),
        targetPage.locator(':scope >>> #right-panel-panel-impacts > div:nth-of-type(2) div:nth-of-type(3) > div > div:nth-of-type(2)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 234,
            y: 97.67706298828125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Apply)'),
        targetPage.locator('#right-panel-panel-impacts > div:nth-of-type(2) > div div:nth-of-type(2) > button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[3]/div/div[2]/button)'),
        targetPage.locator(':scope >>> #right-panel-panel-impacts > div:nth-of-type(2) > div div:nth-of-type(2) > button')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 38,
            y: 20.53125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Apply)'),
        targetPage.locator('#right-panel-panel-impacts > div:nth-of-type(2) > div div:nth-of-type(2) > button'),
        targetPage.locator('::-p-xpath(//*[@id=\\"right-panel-panel-impacts\\"]/div[2]/div/div[3]/div/div[2]/button)'),
        targetPage.locator(':scope >>> #right-panel-panel-impacts > div:nth-of-type(2) > div div:nth-of-type(2) > button')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 23,
            y: 18.6041259765625,
          },
        });
}
await lhFlow.endTimespan();
const lhFlowReport = await lhFlow.generateReport();
fs.writeFileSync(import.meta.dirname + '/flow.report.html', lhFlowReport)

await browser.close();

