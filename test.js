'use strict';
const puppeteer = require('puppeteer');
(async() => {

const browser = await puppeteer.launch({executablePath: '/usr/bin/google-chrome-stable',headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox']});
const page = await browser.newPage();
await page.goto('https://www.amazon.com/shop/purejoyhome');
await page.screenshot({ path: 'purejoyhome.png', fullPage: true });
await page.goto('https://www.example.com');
await page.screenshot({ path: 'example.png', fullPage: true});
browser.close();
})();
