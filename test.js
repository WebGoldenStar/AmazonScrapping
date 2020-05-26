'use strict';
const puppeteer = require('puppeteer');
(async() => {

const browser = await puppeteer.launch({executablePath: '/usr/bin/google-chrome-stable',headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox']});
const page = await browser.newPage();
await page.goto('https://www.w3schools.com/js/js_strict.asp');
await page.screenshot({ path: 'screenshot.png', fullPage: true });
browser.close();
})();
