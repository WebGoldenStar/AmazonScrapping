'use strict';
const puppeteer = require('puppeteer');
(async() => {

const browser = await puppeteer.launch({executablePath: '/usr/bin/google-chrome-stable',headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox']});
const page = await browser.newPage();
await page.goto('https://www.amazon.com/shop/thehooverboys');
await page.screenshot({ path: 'screenshot.png', fullPage: true });
browser.close();
})();
