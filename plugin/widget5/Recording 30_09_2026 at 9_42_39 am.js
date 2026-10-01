import url from 'url';
import { createRunner } from '@puppeteer/replay';

export async function run(extension) {
    const runner = await createRunner(extension);

    await runner.runBeforeAllSteps();

    await runner.runStep({
        type: 'setViewport',
        width: 1298,
        height: 948,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        isLandscape: false
    });
    await runner.runStep({
        type: 'navigate',
        url: 'http://localhost:3001/',
        assertedEvents: [
            {
                type: 'navigation',
                url: 'http://localhost:3001/',
                title: 'Cook Islands Ocean Dashboard'
            }
        ]
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 5,
        offsetX: 544,
        duration: 431,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Select island to fly to'
            ],
            [
                '#island-zoom-select'
            ],
            [
                'xpath///*[@id="island-zoom-select"]'
            ],
            [
                'pierce/#island-zoom-select'
            ],
            [
                'text/aitutaki'
            ]
        ],
        offsetY: 19.46875,
        offsetX: 72.609375,
    });
    await runner.runStep({
        type: 'change',
        value: 'rarotonga',
        selectors: [
            [
                'aria/Select island to fly to'
            ],
            [
                '#island-zoom-select'
            ],
            [
                'xpath///*[@id="island-zoom-select"]'
            ],
            [
                'pierce/#island-zoom-select'
            ],
            [
                'text/aitutaki'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 247,
        offsetX: 742,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Tabular'
            ],
            [
                '#tab-btn-tabular'
            ],
            [
                'xpath///*[@id="tab-btn-tabular"]'
            ],
            [
                'pierce/#tab-btn-tabular'
            ],
            [
                'text/Tabular'
            ]
        ],
        offsetY: 35,
        offsetX: 60.203125,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Close'
            ],
            [
                'button.bottom-offcanvas__close'
            ],
            [
                'xpath//html/body/div[3]/div[2]/button[2]'
            ],
            [
                'pierce/button.bottom-offcanvas__close'
            ]
        ],
        offsetY: 29.125,
        offsetX: 22,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Mean Wave Period forecast variable'
            ],
            [
                '#right-panel-panel-forecast button:nth-of-type(2)'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[1]/div[1]/button[2]'
            ],
            [
                'pierce/#right-panel-panel-forecast button:nth-of-type(2)'
            ],
            [
                'text/Mean Wave Period'
            ]
        ],
        offsetY: 30.796875,
        offsetX: 114.8125,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Peak Wave Period forecast variable'
            ],
            [
                'div.controls-panel button:nth-of-type(3)'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[1]/div[1]/button[3]'
            ],
            [
                'pierce/div.controls-panel button:nth-of-type(3)'
            ],
            [
                'text/Peak Wave Period'
            ]
        ],
        offsetY: 24.625,
        offsetX: 112,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Vessel Suitability forecast variable'
            ],
            [
                'div.controls-panel button:nth-of-type(4)'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[1]/div[1]/button[4]'
            ],
            [
                'pierce/div.controls-panel button:nth-of-type(4)'
            ],
            [
                'text/Vessel Suitability'
            ]
        ],
        offsetY: 29.625,
        offsetX: 102.8125,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 386,
        offsetX: 533,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'div:nth-of-type(4) > label'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[4]/label'
            ],
            [
                'pierce/div:nth-of-type(4) > label'
            ],
            [
                'text/Show coastal'
            ]
        ],
        offsetY: 10.171875,
        offsetX: 95,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Show coastal risk points'
            ],
            [
                'div:nth-of-type(4) input'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[4]/label/input'
            ],
            [
                'pierce/div:nth-of-type(4) input'
            ]
        ],
        offsetY: 7.3125,
        offsetX: 95,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'div:nth-of-type(4) > label'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[4]/label'
            ],
            [
                'pierce/div:nth-of-type(4) > label'
            ],
            [
                'text/Show coastal'
            ]
        ],
        offsetY: 10.171875,
        offsetX: 95,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Show coastal risk points'
            ],
            [
                'div:nth-of-type(4) input'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[4]/label/input'
            ],
            [
                'pierce/div:nth-of-type(4) input'
            ]
        ],
        offsetY: 7.3125,
        offsetX: 95,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                '#right-panel-panel-forecast > div:nth-of-type(2) button:nth-of-type(2) > div:nth-of-type(1)'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[2]/div[1]/button[2]/div[1]'
            ],
            [
                'pierce/#right-panel-panel-forecast > div:nth-of-type(2) button:nth-of-type(2) > div:nth-of-type(1)'
            ],
            [
                'text/Very small (<6'
            ]
        ],
        offsetY: 2.84375,
        offsetX: 62.40625,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 310,
        offsetX: 495,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Close'
            ],
            [
                'button.bottom-offcanvas__close'
            ],
            [
                'xpath//html/body/div[3]/div[2]/button[2]'
            ],
            [
                'pierce/button.bottom-offcanvas__close'
            ]
        ],
        offsetY: 11,
        offsetX: 17,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                '#right-panel-panel-forecast > div:nth-of-type(2) button:nth-of-type(3) > div:nth-of-type(1)'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[2]/div[1]/button[3]/div[1]'
            ],
            [
                'pierce/#right-panel-panel-forecast > div:nth-of-type(2) button:nth-of-type(3) > div:nth-of-type(1)'
            ],
            [
                'text/Small craft (6–10'
            ]
        ],
        offsetY: 18.875,
        offsetX: 28.40625,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Play forecast animation'
            ],
            [
                'button.ft-play-btn'
            ],
            [
                'xpath///*[@id="root"]/div/div/div/div/div[1]/div[5]/div[4]/div[1]/div[1]/button[2]'
            ],
            [
                'pierce/button.ft-play-btn'
            ],
            [
                'text/▶Play'
            ]
        ],
        offsetY: 11.77703857421875,
        offsetX: 43.97948455810547,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/2×'
            ],
            [
                'div.ft-speed > button:nth-of-type(3)'
            ],
            [
                'xpath///*[@id="root"]/div/div/div/div/div[1]/div[5]/div[4]/div[1]/div[2]/button[3]'
            ],
            [
                'pierce/div.ft-speed > button:nth-of-type(3)'
            ],
            [
                'text/2×'
            ]
        ],
        offsetY: 15.25,
        offsetX: 16.640625,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'button:nth-of-type(5) > span.ft-day-label'
            ],
            [
                'xpath///*[@id="root"]/div/div/div/div/div[1]/div[5]/div[2]/div/button[5]/span[2]'
            ],
            [
                'pierce/button:nth-of-type(5) > span.ft-day-label'
            ],
            [
                'text/Wed 30 Sept'
            ]
        ],
        offsetY: 0.375,
        offsetX: 26.484375,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Compare'
            ],
            [
                '#suitability-task-compare'
            ],
            [
                'xpath///*[@id="suitability-task-compare"]'
            ],
            [
                'pierce/#suitability-task-compare'
            ],
            [
                'text/Compare'
            ]
        ],
        offsetY: 19.78125,
        offsetX: 33.25,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Plan route'
            ],
            [
                '#suitability-task-route'
            ],
            [
                'xpath///*[@id="suitability-task-route"]'
            ],
            [
                'pierce/#suitability-task-route'
            ],
            [
                'text/Plan route'
            ]
        ],
        offsetY: 14.78125,
        offsetX: 45,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Draw route'
            ],
            [
                '#suitability-task-panel div:nth-of-type(1) > button'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[1]/button'
            ],
            [
                'pierce/#suitability-task-panel div:nth-of-type(1) > button'
            ],
            [
                'text/Draw route'
            ]
        ],
        offsetY: 6.96875,
        offsetX: 64.484375,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Draw route'
            ],
            [
                '#suitability-task-panel div:nth-of-type(1) > button'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[1]/button'
            ],
            [
                'pierce/#suitability-task-panel div:nth-of-type(1) > button'
            ],
            [
                'text/Draw route'
            ]
        ],
        offsetY: 20.96875,
        offsetX: 72.484375,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Draw route'
            ],
            [
                '#suitability-task-panel div:nth-of-type(1) > button'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[1]/button'
            ],
            [
                'pierce/#suitability-task-panel div:nth-of-type(1) > button'
            ],
            [
                'text/Draw route'
            ]
        ],
        offsetY: 20.96875,
        offsetX: 72.484375,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 649,
        offsetX: 57,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 658,
        offsetX: 379,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 639,
        offsetX: 591,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 587,
        offsetX: 685,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 496,
        offsetX: 706,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 402,
        offsetX: 710,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 274,
        offsetX: 800,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 189,
        offsetX: 690,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 205,
        offsetX: 824,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 118,
        offsetX: 796,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 118,
        offsetX: 796,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 81,
        offsetX: 571,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 80,
        offsetX: 346,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 165,
        offsetX: 110,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 396,
        offsetX: 229,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 529,
        offsetX: 102,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 556,
        offsetX: 295,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 314,
        offsetX: 326,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 213,
        offsetX: 317,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 183,
        offsetX: 476,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 188,
        offsetX: 662,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 254,
        offsetX: 784,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 426,
        offsetX: 726,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 591,
        offsetX: 649,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 549,
        offsetX: 623,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Map'
            ],
            [
                'canvas'
            ],
            [
                'xpath///*[@id="map"]/div[1]/canvas'
            ],
            [
                'pierce/canvas'
            ]
        ],
        offsetY: 518,
        offsetX: 280,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Run forecast'
            ],
            [
                '#suitability-task-panel button:nth-of-type(3)'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[3]/button[3]'
            ],
            [
                'pierce/#suitability-task-panel button:nth-of-type(3)'
            ],
            [
                'text/Run forecast'
            ]
        ],
        offsetY: 19.578125,
        offsetX: 67.484375,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Confirm & compare'
            ],
            [
                'div.bottom-offcanvas__body div:nth-of-type(2) > button'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/div[2]/button'
            ],
            [
                'pierce/div.bottom-offcanvas__body div:nth-of-type(2) > button'
            ],
            [
                'text/Confirm & compare'
            ]
        ],
        offsetY: 22.609375,
        offsetX: 86,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'div.bottom-offcanvas__body > div > div:nth-of-type(3) > div > div'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/div[3]/div/div'
            ],
            [
                'pierce/div.bottom-offcanvas__body > div > div:nth-of-type(3) > div > div'
            ],
            [
                'text/Better departure?'
            ]
        ],
        offsetY: 5.828125,
        offsetX: 53,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'div.bottom-offcanvas__body > div > div:nth-of-type(3) > div > div'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/div[3]/div/div'
            ],
            [
                'pierce/div.bottom-offcanvas__body > div > div:nth-of-type(3) > div > div'
            ],
            [
                'text/Better departure?'
            ]
        ],
        offsetY: 7.828125,
        offsetX: 58,
    });
    await runner.runStep({
        type: 'doubleClick',
        target: 'main',
        selectors: [
            [
                'aria/Suggest better departure'
            ],
            [
                'div.bottom-offcanvas__body > div > div:nth-of-type(3) button'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/div[3]/div/button'
            ],
            [
                'pierce/div.bottom-offcanvas__body > div > div:nth-of-type(3) button'
            ],
            [
                'text/Suggest better'
            ]
        ],
        offsetY: 14.84375,
        offsetX: 62.796875,
    });
    await runner.runStep({
        type: 'navigate',
        url: 'edge://downloads-hub/',
        assertedEvents: [
            {
                type: 'navigation',
                url: 'edge://downloads-hub/',
                title: 'Downloads'
            }
        ]
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Close'
            ],
            [
                'button.bottom-offcanvas__close'
            ],
            [
                'xpath//html/body/div[3]/div[2]/button[2]'
            ],
            [
                'pierce/button.bottom-offcanvas__close'
            ]
        ],
        offsetY: 19,
        offsetX: 16,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Compare'
            ],
            [
                '#suitability-task-compare'
            ],
            [
                'xpath///*[@id="suitability-task-compare"]'
            ],
            [
                'pierce/#suitability-task-compare'
            ],
            [
                'text/Compare'
            ]
        ],
        offsetY: 17.78125,
        offsetX: 57.25,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Save current'
            ],
            [
                'div.map-display-option__segmented > button:nth-of-type(1)'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[1]/div[3]/button[1]'
            ],
            [
                'pierce/div.map-display-option__segmented > button:nth-of-type(1)'
            ],
            [
                'text/Save current'
            ]
        ],
        offsetY: 9.671875,
        offsetX: 61.484375,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'button:nth-of-type(2) > div:nth-of-type(2)'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[2]/div[1]/button[2]/div[2]'
            ],
            [
                'pierce/button:nth-of-type(2) > div:nth-of-type(2)'
            ],
            [
                'text/Dinghies, open'
            ]
        ],
        offsetY: 9.65625,
        offsetX: 156.40625,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Plan route'
            ],
            [
                '#suitability-task-route'
            ],
            [
                'xpath///*[@id="suitability-task-route"]'
            ],
            [
                'pierce/#suitability-task-route'
            ],
            [
                'text/Plan route'
            ]
        ],
        offsetY: 5.78125,
        offsetX: 36,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Run forecast'
            ],
            [
                '#suitability-task-panel button:nth-of-type(3)'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[3]/button[3]'
            ],
            [
                'pierce/#suitability-task-panel button:nth-of-type(3)'
            ],
            [
                'text/Run forecast'
            ]
        ],
        offsetY: 19.578125,
        offsetX: 81.484375,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Close'
            ],
            [
                'button.bottom-offcanvas__close'
            ],
            [
                'xpath//html/body/div[3]/div[2]/button[2]'
            ],
            [
                'pierce/button.bottom-offcanvas__close'
            ]
        ],
        offsetY: 35,
        offsetX: 31,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Compare'
            ],
            [
                '#suitability-task-compare'
            ],
            [
                'xpath///*[@id="suitability-task-compare"]'
            ],
            [
                'pierce/#suitability-task-compare'
            ],
            [
                'text/Compare'
            ]
        ],
        offsetY: 27.78125,
        offsetX: 37.25,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Save current'
            ],
            [
                'div.map-display-option__segmented > button:nth-of-type(1)'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[1]/div[3]/button[1]'
            ],
            [
                'pierce/div.map-display-option__segmented > button:nth-of-type(1)'
            ],
            [
                'text/Save current'
            ]
        ],
        offsetY: 11.671875,
        offsetX: 92.484375,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Run all'
            ],
            [
                'div.map-display-option__segmented > button:nth-of-type(2)'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[1]/div[3]/button[2]'
            ],
            [
                'pierce/div.map-display-option__segmented > button:nth-of-type(2)'
            ],
            [
                'text/Run all'
            ]
        ],
        offsetY: 10.671875,
        offsetX: 74.703125,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Generate Scenario Comparison Brief'
            ],
            [
                'div.map-display-option > button'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[1]/button'
            ],
            [
                'pierce/div.map-display-option > button'
            ],
            [
                'text/Generate Scenario'
            ]
        ],
        offsetY: 12.09375,
        offsetX: 164,
    });
    await runner.runStep({
        type: 'navigate',
        url: 'edge://downloads-hub/',
        assertedEvents: [
            {
                type: 'navigation',
                url: 'edge://downloads-hub/',
                title: 'Downloads'
            }
        ]
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Compare landing areas'
            ],
            [
                '#suitability-task-panel > button'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/button'
            ],
            [
                'pierce/#suitability-task-panel > button'
            ],
            [
                'text/Compare landing'
            ]
        ],
        offsetY: 15.546875,
        offsetX: 176,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/This location'
            ],
            [
                'div.bottom-offcanvas__body button:nth-of-type(2)'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/div[2]/div/button[2]'
            ],
            [
                'pierce/div.bottom-offcanvas__body button:nth-of-type(2)'
            ],
            [
                'text/This location'
            ]
        ],
        offsetY: 13.609375,
        offsetX: 48.71875,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Site'
            ],
            [
                'div.bottom-offcanvas select'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/label/select'
            ],
            [
                'pierce/div.bottom-offcanvas select'
            ]
        ],
        offsetY: 7.0625,
        offsetX: 920,
    });
    await runner.runStep({
        type: 'change',
        value: 'Teenui Harbour',
        selectors: [
            [
                'aria/Site'
            ],
            [
                'div.bottom-offcanvas select'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/label/select'
            ],
            [
                'pierce/div.bottom-offcanvas select'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Site'
            ],
            [
                'div.bottom-offcanvas select'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/label/select'
            ],
            [
                'pierce/div.bottom-offcanvas select'
            ]
        ],
        offsetY: 18.21875,
        offsetX: 717,
    });
    await runner.runStep({
        type: 'change',
        value: 'Tukao Landing',
        selectors: [
            [
                'aria/Site'
            ],
            [
                'div.bottom-offcanvas select'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/label/select'
            ],
            [
                'pierce/div.bottom-offcanvas select'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Site'
            ],
            [
                'div.bottom-offcanvas select'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/label/select'
            ],
            [
                'pierce/div.bottom-offcanvas select'
            ]
        ],
        offsetY: 10.21875,
        offsetX: 597,
    });
    await runner.runStep({
        type: 'change',
        value: 'Aroa Passage',
        selectors: [
            [
                'aria/Site'
            ],
            [
                'div.bottom-offcanvas select'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/label/select'
            ],
            [
                'pierce/div.bottom-offcanvas select'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Export PDF'
            ],
            [
                'div.bottom-offcanvas__body > div > div:nth-of-type(2) > button'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/div[2]/button'
            ],
            [
                'pierce/div.bottom-offcanvas__body > div > div:nth-of-type(2) > button'
            ],
            [
                'text/Export PDF'
            ]
        ],
        offsetY: 1.453125,
        offsetX: 56.578125,
    });
    await runner.runStep({
        type: 'navigate',
        url: 'edge://downloads-hub/',
        assertedEvents: [
            {
                type: 'navigation',
                url: 'edge://downloads-hub/',
                title: 'Downloads'
            }
        ]
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/PNG'
            ],
            [
                'div.cok-landing-area-timeseries button:nth-of-type(1)'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/div[3]/div[1]/div[2]/button[1]'
            ],
            [
                'pierce/div.cok-landing-area-timeseries button:nth-of-type(1)'
            ],
            [
                'text/PNG'
            ]
        ],
        offsetY: 7.125,
        offsetX: 26.390625,
    });
    await runner.runStep({
        type: 'navigate',
        url: 'edge://downloads-hub/',
        assertedEvents: [
            {
                type: 'navigation',
                url: 'edge://downloads-hub/',
                title: 'Downloads'
            }
        ]
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Print'
            ],
            [
                'div.cok-landing-area-timeseries button:nth-of-type(2)'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/div[3]/div[1]/div[2]/button[2]'
            ],
            [
                'pierce/div.cok-landing-area-timeseries button:nth-of-type(2)'
            ],
            [
                'text/Print'
            ]
        ],
        offsetY: 6.125,
        offsetX: 30.28125,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Close'
            ],
            [
                'button.bottom-offcanvas__close'
            ],
            [
                'xpath//html/body/div[3]/div[2]/button[2]'
            ],
            [
                'pierce/button.bottom-offcanvas__close'
            ]
        ],
        offsetY: 15.84375,
        offsetX: 24,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Export'
            ],
            [
                '#suitability-task-export'
            ],
            [
                'xpath///*[@id="suitability-task-export"]'
            ],
            [
                'pierce/#suitability-task-export'
            ],
            [
                'text/Export'
            ]
        ],
        offsetY: 19.78125,
        offsetX: 35.5,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Configure & download…'
            ],
            [
                '#suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(1) button'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[1]/div/button'
            ],
            [
                'pierce/#suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(1) button'
            ],
            [
                'text/Configure & download…'
            ]
        ],
        offsetY: 10.296875,
        offsetX: 88.40625,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Report'
            ],
            [
                'label:nth-of-type(1) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[1]/select'
            ],
            [
                'pierce/label:nth-of-type(1) > select'
            ]
        ],
        offsetY: 1.203125,
        offsetX: 135.40625,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'label:nth-of-type(3)'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[3]'
            ],
            [
                'pierce/label:nth-of-type(3)'
            ],
            [
                'text/Areaviewport'
            ]
        ],
        offsetY: 6.1875,
        offsetX: 106.40625,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Vessel'
            ],
            [
                'label:nth-of-type(2) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[2]/select'
            ],
            [
                'pierce/label:nth-of-type(2) > select'
            ],
            [
                'text/very_small_motorised_craft'
            ]
        ],
        offsetY: 9.5625,
        offsetX: 112.40625,
    });
    await runner.runStep({
        type: 'change',
        value: 'small_craft',
        selectors: [
            [
                'aria/Vessel'
            ],
            [
                'label:nth-of-type(2) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[2]/select'
            ],
            [
                'pierce/label:nth-of-type(2) > select'
            ],
            [
                'text/very_small_motorised_craft'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Area'
            ],
            [
                'label:nth-of-type(3) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[3]/select'
            ],
            [
                'pierce/label:nth-of-type(3) > select'
            ],
            [
                'text/viewport'
            ]
        ],
        offsetY: 19.921875,
        offsetX: 89.40625,
    });
    await runner.runStep({
        type: 'change',
        value: 'domain',
        selectors: [
            [
                'aria/Area'
            ],
            [
                'label:nth-of-type(3) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[3]/select'
            ],
            [
                'pierce/label:nth-of-type(3) > select'
            ],
            [
                'text/viewport'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Area'
            ],
            [
                'label:nth-of-type(3) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[3]/select'
            ],
            [
                'pierce/label:nth-of-type(3) > select'
            ],
            [
                'text/viewport'
            ]
        ],
        offsetY: 7.53125,
        offsetX: 99.40625,
    });
    await runner.runStep({
        type: 'change',
        value: 'viewport',
        selectors: [
            [
                'aria/Area'
            ],
            [
                'label:nth-of-type(3) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[3]/select'
            ],
            [
                'pierce/label:nth-of-type(3) > select'
            ],
            [
                'text/viewport'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Period'
            ],
            [
                'label:nth-of-type(4) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[4]/select'
            ],
            [
                'pierce/label:nth-of-type(4) > select'
            ]
        ],
        offsetY: 9.28125,
        offsetX: 83.40625,
    });
    await runner.runStep({
        type: 'change',
        value: '168',
        selectors: [
            [
                'aria/Period'
            ],
            [
                'label:nth-of-type(4) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[4]/select'
            ],
            [
                'pierce/label:nth-of-type(4) > select'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Generate PDF'
            ],
            [
                '#suitability-task-panel button:nth-of-type(2)'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[4]/button[2]'
            ],
            [
                'pierce/#suitability-task-panel button:nth-of-type(2)'
            ],
            [
                'text/Generate PDF'
            ]
        ],
        offsetY: 29.734375,
        offsetX: 61.890625,
    });
    await runner.runStep({
        type: 'navigate',
        url: 'edge://downloads-hub/',
        assertedEvents: [
            {
                type: 'navigation',
                url: 'edge://downloads-hub/',
                title: 'Downloads'
            }
        ]
    });
    await runner.runStep({
        type: 'click',
        target: 'edge://downloads-hub/',
        selectors: [
            [
                'aria/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
                'aria/Open file'
            ],
            [
                'downloads-hub-app',
                'downloads-list',
                '#\\34 41',
                'mai-link'
            ],
            [
                'pierce/#\\34 41',
                'pierce/mai-link'
            ]
        ],
        offsetY: 5,
        offsetX: 20,
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyUp',
        key: 'PageDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyUp',
        key: 'PageDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyUp',
        key: 'PageDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyUp',
        key: 'PageUp',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyUp',
        key: 'PageDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyUp',
        key: 'PageDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyUp',
        key: 'PageDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyUp',
        key: 'PageDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyUp',
        key: 'PageUp',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyUp',
        key: 'PageUp',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyUp',
        key: 'PageUp',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageDown'
    });
    await runner.runStep({
        type: 'keyUp',
        key: 'PageDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyDown',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf',
        key: 'PageUp'
    });
    await runner.runStep({
        type: 'keyUp',
        key: 'PageUp',
        target: 'file:///C:/Users/kishank/Downloads/cook_islands_domain_advisory_small_craft_2026-09-292146.pdf'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                '#right-panel-panel-forecast > div:nth-of-type(2) button:nth-of-type(3) > div:nth-of-type(1)'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[2]/div[1]/button[3]/div[1]'
            ],
            [
                'pierce/#right-panel-panel-forecast > div:nth-of-type(2) button:nth-of-type(3) > div:nth-of-type(1)'
            ],
            [
                'text/Small craft (6–10'
            ]
        ],
        offsetY: 13.875,
        offsetX: 149.40625,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Configure & download…'
            ],
            [
                '#suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(1) button'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[1]/div/button'
            ],
            [
                'pierce/#suitability-task-panel > div:nth-of-type(2) > div:nth-of-type(1) button'
            ],
            [
                'text/Configure & download…'
            ]
        ],
        offsetY: 10.296875,
        offsetX: 122.40625,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'label:nth-of-type(4)'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[4]'
            ],
            [
                'pierce/label:nth-of-type(4)'
            ],
            [
                'text/Period168'
            ]
        ],
        offsetY: 23.546875,
        offsetX: 118.40625,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Period'
            ],
            [
                'label:nth-of-type(4) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[4]/select'
            ],
            [
                'pierce/label:nth-of-type(4) > select'
            ],
            [
                'text/168'
            ]
        ],
        offsetY: 2.28125,
        offsetX: 118.40625,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Period'
            ],
            [
                'label:nth-of-type(4) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[4]/select'
            ],
            [
                'pierce/label:nth-of-type(4) > select'
            ],
            [
                'text/168'
            ]
        ],
        offsetY: 13.28125,
        offsetX: 112.40625,
    });
    await runner.runStep({
        type: 'change',
        value: '72',
        selectors: [
            [
                'aria/Period'
            ],
            [
                'label:nth-of-type(4) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[4]/select'
            ],
            [
                'pierce/label:nth-of-type(4) > select'
            ],
            [
                'text/168'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Vessel'
            ],
            [
                'label:nth-of-type(2) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[2]/select'
            ],
            [
                'pierce/label:nth-of-type(2) > select'
            ],
            [
                'text/small_craft'
            ]
        ],
        offsetY: 22.5625,
        offsetX: 169.40625,
    });
    await runner.runStep({
        type: 'change',
        value: 'very_small_motorised_craft',
        selectors: [
            [
                'aria/Vessel'
            ],
            [
                'label:nth-of-type(2) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[2]/select'
            ],
            [
                'pierce/label:nth-of-type(2) > select'
            ],
            [
                'text/small_craft'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Area'
            ],
            [
                'label:nth-of-type(3) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[3]/select'
            ],
            [
                'pierce/label:nth-of-type(3) > select'
            ],
            [
                'text/viewport'
            ]
        ],
        offsetY: 25.921875,
        offsetX: 154.40625,
    });
    await runner.runStep({
        type: 'change',
        value: 'domain',
        selectors: [
            [
                'aria/Area'
            ],
            [
                'label:nth-of-type(3) > select'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[2]/label[3]/select'
            ],
            [
                'pierce/label:nth-of-type(3) > select'
            ],
            [
                'text/viewport'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Generate PDF'
            ],
            [
                '#suitability-task-panel button:nth-of-type(2)'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[2]/div[5]/div/div[4]/button[2]'
            ],
            [
                'pierce/#suitability-task-panel button:nth-of-type(2)'
            ],
            [
                'text/Generate PDF'
            ]
        ],
        offsetY: 12.140625,
        offsetX: 81.890625,
    });
    await runner.runStep({
        type: 'navigate',
        url: 'edge://downloads-hub/',
        assertedEvents: [
            {
                type: 'navigation',
                url: 'edge://downloads-hub/',
                title: 'Downloads'
            }
        ]
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Details'
            ],
            [
                'div.controls-panel div:nth-of-type(2) > button'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[2]/div[2]/button'
            ],
            [
                'pierce/div.controls-panel div:nth-of-type(2) > button'
            ],
            [
                'text/Details'
            ]
        ],
        offsetY: 17.53125,
        offsetX: 16.953125,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'div.cok-suitability-readiness__header > span'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[2]/div[2]/div[1]/span'
            ],
            [
                'pierce/div.cok-suitability-readiness__header > span'
            ],
            [
                'text/Ready'
            ]
        ],
        offsetY: 13.8125,
        offsetX: 43.59375,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'div.cok-suitability-readiness__header'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[2]/div[2]/div[1]'
            ],
            [
                'pierce/div.cok-suitability-readiness__header'
            ],
            [
                'text/Operational readinessSuitability setupReady'
            ]
        ],
        offsetY: 24.8125,
        offsetX: 268.484375,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'div.cok-suitability-readiness__title'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[2]/div[2]/div[1]/div/div[2]'
            ],
            [
                'pierce/div.cok-suitability-readiness__title'
            ],
            [
                'text/Suitability setup'
            ]
        ],
        offsetY: 0.03125,
        offsetX: 65.484375,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Hide details'
            ],
            [
                'div.cok-suitability-readiness > button'
            ],
            [
                'xpath///*[@id="right-panel-panel-forecast"]/div[2]/div[2]/button'
            ],
            [
                'pierce/div.cok-suitability-readiness > button'
            ],
            [
                'text/Hide details'
            ]
        ],
        offsetY: 13.984375,
        offsetX: 39.484375,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                '#root > div > div > div > div'
            ],
            [
                'xpath///*[@id="root"]/div/div/div/div'
            ],
            [
                'pierce/#root > div > div > div > div'
            ]
        ],
        offsetY: 421,
        offsetX: 1281,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Thresholds'
            ],
            [
                '#suitability-task-thresholds'
            ],
            [
                'xpath///*[@id="suitability-task-thresholds"]'
            ],
            [
                'pierce/#suitability-task-thresholds'
            ],
            [
                'text/Thresholds'
            ]
        ],
        offsetY: 15.78125,
        offsetX: 62.75,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Custom envelope'
            ],
            [
                '#suitability-task-panel button:nth-of-type(2)'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[1]/button[2]'
            ],
            [
                'pierce/#suitability-task-panel button:nth-of-type(2)'
            ],
            [
                'text/Custom envelope'
            ]
        ],
        offsetY: 11.03125,
        offsetX: 72.703125,
    });
    await runner.runStep({
        type: 'change',
        value: '1.6',
        selectors: [
            [
                'aria/Wave avoid threshold'
            ],
            [
                'div:nth-of-type(3) > div:nth-of-type(2) input.envelope-range__input--avoid'
            ],
            [
                'xpath///*[@id="suitability-task-panel"]/div[3]/div[2]/div[2]/input[2]'
            ],
            [
                'pierce/div:nth-of-type(3) > div:nth-of-type(2) input.envelope-range__input--avoid'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Inundation & Impacts'
            ],
            [
                '#right-panel-tab-impacts'
            ],
            [
                'xpath///*[@id="right-panel-tab-impacts"]'
            ],
            [
                'pierce/#right-panel-tab-impacts'
            ],
            [
                'text/Inundation &'
            ]
        ],
        offsetY: 18,
        offsetX: 69.3125,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Sep 29 – Oct 1'
            ],
            [
                '#right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(1) button:nth-of-type(1)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[1]/div[2]/div[1]/div[2]/button[1]'
            ],
            [
                'pierce/#right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(1) button:nth-of-type(1)'
            ],
            [
                'text/Sep 29 – Oct'
            ]
        ],
        offsetY: 10.59375,
        offsetX: 69,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Oct 2 – Oct 8 ●'
            ],
            [
                '#right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(1) button:nth-of-type(2)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[1]/div[2]/div[1]/div[2]/button[2]'
            ],
            [
                'pierce/#right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(1) button:nth-of-type(2)'
            ],
            [
                'text/Oct 2 – Oct 8●'
            ]
        ],
        offsetY: 18.59375,
        offsetX: 13.015625,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Show the impact window on the map'
            ],
            [
                '#right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(1) > button'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[1]/div[1]/button'
            ],
            [
                'pierce/#right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(1) > button'
            ],
            [
                'text/Show the impact'
            ]
        ],
        offsetY: 12.5,
        offsetX: 189.609375,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                '#right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(2) div:nth-of-type(1) > span:nth-of-type(2)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[1]/div[2]/div[2]/div[1]/div[1]/span[2]'
            ],
            [
                'pierce/#right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(2) div:nth-of-type(1) > span:nth-of-type(2)'
            ],
            [
                'text/Estimated economic'
            ]
        ],
        offsetY: 11.53125,
        offsetX: 37.203125,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Ports 5 exposed $1.25M'
            ],
            [
                'div.controls-panel div:nth-of-type(3) > button'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[1]/div[2]/div[2]/div[3]/button'
            ],
            [
                'pierce/div.controls-panel div:nth-of-type(3) > button'
            ],
            [
                'text/Ports5 exposed$1.25M'
            ]
        ],
        offsetY: 27.703125,
        offsetX: 51,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Ports Western Marina Marina · depth 4.00 m $91K'
            ],
            [
                'div:nth-of-type(2) > div:nth-of-type(2) > div:nth-of-type(3) > div > div:nth-of-type(2)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[1]/div[2]/div[2]/div[3]/div/div[2]'
            ],
            [
                'pierce/div:nth-of-type(2) > div:nth-of-type(2) > div:nth-of-type(3) > div > div:nth-of-type(2)'
            ],
            [
                'text/Ports Western MarinaMarina · depth 4.00 m$91K'
            ]
        ],
        offsetY: 39.546875,
        offsetX: 65.8125,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                '#right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(2) div:nth-of-type(5) > div > div:nth-of-type(1)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[1]/div[2]/div[2]/div[3]/div/div[5]/div/div[1]'
            ],
            [
                'pierce/#right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(2) div:nth-of-type(5) > div > div:nth-of-type(1)'
            ],
            [
                'text/Avarua Harbour'
            ]
        ],
        offsetY: 10.765625,
        offsetX: 56.8125,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Advanced: land flooded above the tide line'
            ],
            [
                'div.controls-panel details:nth-of-type(1) > summary'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[1]/div[2]/details[1]/summary'
            ],
            [
                'pierce/div.controls-panel details:nth-of-type(1) > summary'
            ],
            [
                'text/Advanced: land'
            ]
        ],
        offsetY: 11.84375,
        offsetX: 187,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'details:nth-of-type(1) div:nth-of-type(3) > span:nth-of-type(1)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[1]/div[2]/details[1]/div/div/div[2]/div[3]/span[1]'
            ],
            [
                'pierce/details:nth-of-type(1) div:nth-of-type(3) > span:nth-of-type(1)'
            ]
        ],
        offsetY: 7.125,
        offsetX: 149,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/≥ 5 cm'
            ],
            [
                'details:nth-of-type(1) button:nth-of-type(1)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[1]/div[2]/details[1]/div/div/div[1]/div/button[1]'
            ],
            [
                'pierce/details:nth-of-type(1) button:nth-of-type(1)'
            ],
            [
                'text/≥ 5 cm'
            ]
        ],
        offsetY: 20.578125,
        offsetX: 30.796875,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/≥ 10 cm'
            ],
            [
                'details:nth-of-type(1) button:nth-of-type(2)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[1]/div[2]/details[1]/div/div/div[1]/div/button[2]'
            ],
            [
                'pierce/details:nth-of-type(1) button:nth-of-type(2)'
            ],
            [
                'text/≥ 10 cm'
            ]
        ],
        offsetY: 17.578125,
        offsetX: 20.6875,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                '#root > div > div > div > div'
            ],
            [
                'xpath///*[@id="root"]/div/div/div/div'
            ],
            [
                'pierce/#root > div > div > div > div'
            ]
        ],
        offsetY: 678,
        offsetX: 1271,
        duration: 501.39999999990687,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/View detailed table'
            ],
            [
                '#right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(2) > button'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[1]/div[2]/button'
            ],
            [
                'pierce/#right-panel-panel-impacts > div:nth-of-type(1) > div:nth-of-type(2) > button'
            ],
            [
                'text/View detailed'
            ]
        ],
        offsetY: 19.375,
        offsetX: 164,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'div.bottom-offcanvas__body div:nth-of-type(3) > div:nth-of-type(2) > div:nth-of-type(1)'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/div[3]/div[2]/div[1]'
            ],
            [
                'pierce/div.bottom-offcanvas__body div:nth-of-type(3) > div:nth-of-type(2) > div:nth-of-type(1)'
            ],
            [
                'text/Buildings exposed'
            ]
        ],
        offsetY: 10.078125,
        offsetX: 138.421875,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'div.bottom-offcanvas div:nth-of-type(3) > div:nth-of-type(3) > div:nth-of-type(2)'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/div[3]/div[3]/div[2]'
            ],
            [
                'pierce/div.bottom-offcanvas div:nth-of-type(3) > div:nth-of-type(3) > div:nth-of-type(2)'
            ]
        ],
        offsetY: 14.015625,
        offsetX: 8.21875,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Severity'
            ],
            [
                'select'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/div[5]/div[1]/label[2]/select'
            ],
            [
                'pierce/select'
            ]
        ],
        offsetY: 19.90625,
        offsetX: 32.34375,
    });
    await runner.runStep({
        type: 'change',
        value: '',
        selectors: [
            [
                'aria/Severity'
            ],
            [
                'select'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/div[5]/div[1]/label[2]/select'
            ],
            [
                'pierce/select'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'doubleClick',
        target: 'main',
        selectors: [
            [
                'aria/Affected only'
            ],
            [
                'div.bottom-offcanvas input'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/div[5]/div[1]/label[1]/input'
            ],
            [
                'pierce/div.bottom-offcanvas input'
            ]
        ],
        offsetY: 6.65625,
        offsetX: 53.203125,
    });
    await runner.runStep({
        type: 'doubleClick',
        target: 'main',
        selectors: [
            [
                'div.bottom-offcanvas label:nth-of-type(1)'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/div[5]/div[1]/label[1]'
            ],
            [
                'pierce/div.bottom-offcanvas label:nth-of-type(1)'
            ],
            [
                'text/Affected only'
            ]
        ],
        offsetY: 4.53125,
        offsetX: 53.203125,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/[role="dialog"]',
                'aria/Minimum flood depth'
            ],
            [
                'div:nth-of-type(6) > div:nth-of-type(2)'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/div[6]/div[2]'
            ],
            [
                'pierce/div:nth-of-type(6) > div:nth-of-type(2)'
            ],
            [
                'text/Minimum counted'
            ]
        ],
        offsetY: 20.875,
        offsetX: 131.34375,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Detailed analysis: districts'
            ],
            [
                'div.bottom-offcanvas__body > div > details:nth-of-type(1) > summary'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/details[1]/summary'
            ],
            [
                'pierce/div.bottom-offcanvas__body > div > details:nth-of-type(1) > summary'
            ],
            [
                'text/Detailed analysis:'
            ]
        ],
        offsetY: 10.390625,
        offsetX: 104,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Compare all forecast windows'
            ],
            [
                'div.bottom-offcanvas details:nth-of-type(2) > summary'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/details[2]/summary'
            ],
            [
                'pierce/div.bottom-offcanvas details:nth-of-type(2) > summary'
            ],
            [
                'text/Compare all forecast'
            ]
        ],
        offsetY: 9.546875,
        offsetX: 130,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'html'
            ],
            [
                'xpath//html'
            ],
            [
                'pierce/html'
            ]
        ],
        offsetY: 935,
        offsetX: 1299,
        duration: 481.30000000004657,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/[role="dialog"]',
                'aria/Why don’t these numbers match?'
            ],
            [
                'details:nth-of-type(3) > summary'
            ],
            [
                'xpath//html/body/div[3]/div[3]/div/details[3]/summary'
            ],
            [
                'pierce/details:nth-of-type(3) > summary'
            ]
        ],
        offsetY: 5.703125,
        offsetX: 93,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Close'
            ],
            [
                'button.bottom-offcanvas__close'
            ],
            [
                'xpath//html/body/div[3]/div[2]/button[2]'
            ],
            [
                'pierce/button.bottom-offcanvas__close'
            ]
        ],
        offsetY: 27,
        offsetX: 21,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Edit map depth categories'
            ],
            [
                '#right-panel-panel-impacts > div:nth-of-type(2) > div > div:nth-of-type(2) button'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[2]/div[1]/button'
            ],
            [
                'pierce/#right-panel-panel-impacts > div:nth-of-type(2) > div > div:nth-of-type(2) button'
            ],
            [
                'text/Edit map depth'
            ]
        ],
        offsetY: 5.75,
        offsetX: 152,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Color for Severe Flooding'
            ],
            [
                '#ite-color-cok-severe'
            ],
            [
                'xpath///*[@id="ite-color-cok-severe"]'
            ],
            [
                'pierce/#ite-color-cok-severe'
            ],
            [
                'text/#030303'
            ]
        ],
        offsetY: 19.09375,
        offsetX: 19.8125,
    });
    await runner.runStep({
        type: 'change',
        value: '#000000',
        selectors: [
            [
                'aria/Color for Severe Flooding'
            ],
            [
                '#ite-color-cok-severe'
            ],
            [
                'xpath///*[@id="ite-color-cok-severe"]'
            ],
            [
                'pierce/#ite-color-cok-severe'
            ],
            [
                'text/#030303'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'div.ite-body'
            ],
            [
                'xpath///*[@id="root"]/div/div/div/div[3]/div[3]'
            ],
            [
                'pierce/div.ite-body'
            ]
        ],
        offsetY: 726.609375,
        offsetX: 353,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Save'
            ],
            [
                'button.ite-btn-save'
            ],
            [
                'xpath///*[@id="root"]/div/div/div/div[3]/div[2]/div[2]/button[6]'
            ],
            [
                'pierce/button.ite-btn-save'
            ],
            [
                'text/Save'
            ]
        ],
        offsetY: 10.8125,
        offsetX: 35.03125,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'button.ite-icon-btn--warn > svg'
            ],
            [
                'xpath///*[@id="root"]/div/div/div/div[3]/div[2]/div[2]/button[3]/svg'
            ],
            [
                'pierce/button.ite-icon-btn--warn > svg'
            ]
        ],
        offsetY: 6.109375,
        offsetX: 5.203125,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'div.ite-header svg'
            ],
            [
                'xpath///*[@id="root"]/div/div/div/div[3]/div[1]/button/svg'
            ],
            [
                'pierce/div.ite-header svg'
            ]
        ],
        offsetY: 6.203125,
        offsetX: 13.59375,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'div.controls-panel'
            ],
            [
                'xpath///*[@id="root"]/div/div/div/div/div[2]'
            ],
            [
                'pierce/div.controls-panel'
            ]
        ],
        offsetY: 577,
        offsetX: 340,
        duration: 480.70000000018626,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'label:nth-of-type(4)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[1]/label[4]'
            ],
            [
                'pierce/label:nth-of-type(4)'
            ],
            [
                'text/Compare lines'
            ]
        ],
        offsetY: 4.59375,
        offsetX: 107,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Compare lines (MHWS, +15, +20 cm)'
            ],
            [
                'label:nth-of-type(4) > input'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[1]/label[4]/input'
            ],
            [
                'pierce/label:nth-of-type(4) > input'
            ]
        ],
        offsetY: 0.078125,
        offsetX: 107,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'label:nth-of-type(4)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[1]/label[4]'
            ],
            [
                'pierce/label:nth-of-type(4)'
            ],
            [
                'text/Compare lines'
            ]
        ],
        offsetY: 4.59375,
        offsetX: 107,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Compare lines (MHWS, +15, +20 cm)'
            ],
            [
                'label:nth-of-type(4) > input'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[1]/label[4]/input'
            ],
            [
                'pierce/label:nth-of-type(4) > input'
            ]
        ],
        offsetY: 0.078125,
        offsetX: 107,
    });
    await runner.runStep({
        type: 'doubleClick',
        target: 'main',
        selectors: [
            [
                'aria/District damage'
            ],
            [
                'label:nth-of-type(1) > input'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[1]/label[1]/input'
            ],
            [
                'pierce/label:nth-of-type(1) > input'
            ]
        ],
        offsetY: 5.734375,
        offsetX: 71,
    });
    await runner.runStep({
        type: 'doubleClick',
        target: 'main',
        selectors: [
            [
                'div:nth-of-type(2) > div > div:nth-of-type(1) > label:nth-of-type(1)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[1]/label[1]'
            ],
            [
                'pierce/div:nth-of-type(2) > div > div:nth-of-type(1) > label:nth-of-type(1)'
            ],
            [
                'text/District damage'
            ]
        ],
        offsetY: 1.21875,
        offsetX: 71,
    });
    await runner.runStep({
        type: 'doubleClick',
        target: 'main',
        selectors: [
            [
                'aria/Coastal risk points'
            ],
            [
                'label:nth-of-type(2) > input'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[1]/label[2]/input'
            ],
            [
                'pierce/label:nth-of-type(2) > input'
            ]
        ],
        offsetY: 9.6875,
        offsetX: 62,
    });
    await runner.runStep({
        type: 'doubleClick',
        target: 'main',
        selectors: [
            [
                'label:nth-of-type(2)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[1]/label[2]'
            ],
            [
                'pierce/label:nth-of-type(2)'
            ],
            [
                'text/Coastal risk'
            ]
        ],
        offsetY: 5.171875,
        offsetX: 62,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'label:nth-of-type(3)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[1]/label[3]'
            ],
            [
                'pierce/label:nth-of-type(3)'
            ],
            [
                'text/MHWS + 17.5 cm line'
            ]
        ],
        offsetY: 5.640625,
        offsetX: 68,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/MHWS + 17.5 cm line'
            ],
            [
                'label:nth-of-type(3) > input'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[1]/label[3]/input'
            ],
            [
                'pierce/label:nth-of-type(3) > input'
            ]
        ],
        offsetY: 1.125,
        offsetX: 68,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'label:nth-of-type(3)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[1]/label[3]'
            ],
            [
                'pierce/label:nth-of-type(3)'
            ],
            [
                'text/MHWS + 17.5 cm line'
            ]
        ],
        offsetY: 5.640625,
        offsetX: 68,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/MHWS + 17.5 cm line'
            ],
            [
                'label:nth-of-type(3) > input'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[1]/label[3]/input'
            ],
            [
                'pierce/label:nth-of-type(3) > input'
            ]
        ],
        offsetY: 1.125,
        offsetX: 68,
    });
    await runner.runStep({
        type: 'doubleClick',
        target: 'main',
        selectors: [
            [
                'aria/Flooding above the line'
            ],
            [
                'label:nth-of-type(5) > input'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[1]/label[5]/input'
            ],
            [
                'pierce/label:nth-of-type(5) > input'
            ]
        ],
        offsetY: 13.546875,
        offsetX: 79,
    });
    await runner.runStep({
        type: 'doubleClick',
        target: 'main',
        selectors: [
            [
                'label:nth-of-type(5)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[1]/label[5]'
            ],
            [
                'pierce/label:nth-of-type(5)'
            ],
            [
                'text/Flooding above'
            ]
        ],
        offsetY: 9.03125,
        offsetX: 79,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/48h Max'
            ],
            [
                '#right-panel-panel-impacts > div:nth-of-type(2) button:nth-of-type(2)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[3]/div/div/button[2]'
            ],
            [
                'pierce/#right-panel-panel-impacts > div:nth-of-type(2) button:nth-of-type(2)'
            ],
            [
                'text/48h Max'
            ]
        ],
        offsetY: 20.703125,
        offsetX: 57.203125,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Custom Max'
            ],
            [
                'div.controls-panel button:nth-of-type(3)'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[3]/div/div[1]/button[3]'
            ],
            [
                'pierce/div.controls-panel button:nth-of-type(3)'
            ],
            [
                'text/Custom Max'
            ]
        ],
        offsetY: 33.703125,
        offsetX: 60.40625,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                '#root > div > div > div div:nth-of-type(2) > input'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[3]/div/div[2]/div/div[2]/input'
            ],
            [
                'pierce/#root > div > div > div div:nth-of-type(2) > input'
            ],
            [
                'text/2026-09-28T02:00'
            ]
        ],
        offsetY: 14.625,
        offsetX: 11.3125,
    });
    await runner.runStep({
        type: 'change',
        value: '',
        selectors: [
            [
                '#root > div > div > div div:nth-of-type(2) > input'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[3]/div/div[2]/div/div[2]/input'
            ],
            [
                'pierce/#root > div > div > div div:nth-of-type(2) > input'
            ],
            [
                'text/2026-09-28T02:00'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                '#root > div > div > div div:nth-of-type(2) > input'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[3]/div/div[2]/div/div[2]/input'
            ],
            [
                'pierce/#root > div > div > div div:nth-of-type(2) > input'
            ],
            [
                'text/2026-09-28T02:00'
            ]
        ],
        offsetY: 8.625,
        offsetX: 31.3125,
    });
    await runner.runStep({
        type: 'change',
        value: '2026-10-31T02:00',
        selectors: [
            [
                '#root > div > div > div div:nth-of-type(2) > input'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[3]/div/div[2]/div/div[2]/input'
            ],
            [
                'pierce/#root > div > div > div div:nth-of-type(2) > input'
            ],
            [
                'text/2026-09-28T02:00'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                '#root > div > div > div div:nth-of-type(2) > input'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[3]/div/div[2]/div/div[2]/input'
            ],
            [
                'pierce/#root > div > div > div div:nth-of-type(2) > input'
            ],
            [
                'text/2026-09-28T02:00'
            ]
        ],
        offsetY: 11.625,
        offsetX: 13.3125,
    });
    await runner.runStep({
        type: 'change',
        value: '2026-10-05T02:00',
        selectors: [
            [
                '#root > div > div > div div:nth-of-type(2) > input'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[3]/div/div[2]/div/div[2]/input'
            ],
            [
                'pierce/#root > div > div > div div:nth-of-type(2) > input'
            ],
            [
                'text/2026-09-28T02:00'
            ]
        ],
        target: 'main'
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                '#right-panel-panel-impacts > div:nth-of-type(2) div:nth-of-type(3) > div'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[3]/div'
            ],
            [
                'pierce/#right-panel-panel-impacts > div:nth-of-type(2) div:nth-of-type(3) > div'
            ]
        ],
        offsetY: 146.703125,
        offsetX: 7,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Apply'
            ],
            [
                '#right-panel-panel-impacts > div:nth-of-type(2) > div div:nth-of-type(2) > button'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[3]/div/div[2]/button'
            ],
            [
                'pierce/#right-panel-panel-impacts > div:nth-of-type(2) > div div:nth-of-type(2) > button'
            ]
        ],
        offsetY: 25.375,
        offsetX: 15,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/Apply'
            ],
            [
                '#right-panel-panel-impacts > div:nth-of-type(2) > div div:nth-of-type(2) > button'
            ],
            [
                'xpath///*[@id="right-panel-panel-impacts"]/div[2]/div/div[3]/div/div[2]/button'
            ],
            [
                'pierce/#right-panel-panel-impacts > div:nth-of-type(2) > div div:nth-of-type(2) > button'
            ]
        ],
        offsetY: 22.375,
        offsetX: 26,
    });
    await runner.runStep({
        type: 'click',
        target: 'main',
        selectors: [
            [
                'aria/More key'
            ],
            [
                'div.marine-legend-group button'
            ],
            [
                'xpath///*[@id="root"]/div/div/div/div/div[1]/div[4]/div/button'
            ],
            [
                'pierce/div.marine-legend-group button'
            ],
            [
                'text/More key'
            ]
        ],
        offsetY: 6.4375,
        offsetX: 41.609375,
    });

    await runner.runAfterAllSteps();
}

if (process && import.meta.url === url.pathToFileURL(process.argv[1]).href) {
    run()
}
