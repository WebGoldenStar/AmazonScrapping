const chrome = require('chrome-aws-lambda');
const puppeteer = require('puppeteer');
const request = require('request-promise-native');
const poll = require('promise-poller');
const mysql = require('mysql');

const result = [];
const timeout = millis => new Promise(resolve => setTimeout(resolve, millis));

async function initiateCaptchaRequest(page) {
    const siteKey = await page.$eval('.g-recaptcha', node => node.getAttribute('data-sitekey'));
    const formData = {
        method: 'userrecaptcha',
        googlekey: siteKey,
        key: process.env.RECAPTCHA_API_KEY,
        invisible: 1,
        pageurl: process.env.WISH_SITE_URL,
        json: 1
    };
    console.info(`----Sending request to http://2captcha.com/in.php----`);
    console.info(`----${formData}----`);
    console.log(`-------------------------`)
    const response = await request.post('http://2captcha.com/in.php', { form: formData });
    return JSON.parse(response).request;
}

function requestCaptchaResults(requestId) {
    console.info(`----Sending request to http://2captcha.com/res.php----`);
    const url = `http://2captcha.com/res.php?key=${process.env.RECAPTCHA_API_KEY}&action=get&id=${requestId}&json=1`;
    return async function() {
        return new Promise(async function(resolve, reject) {
            const rawResponse = await request.get(url);
            const resp = JSON.parse(rawResponse);
            if (resp.status === 0) return reject(resp.request);
            resolve(resp.request);
        });
    }
}

async function pollForRequestResults(id, retries = 30, interval = 1500, delay = 15000) {
    await timeout(delay);
    return poll.default({
        taskFn: requestCaptchaResults(id),
        interval,
        retries
    });
}

async function scrapeInfiniteScrollItems(page) {

    let previousHeight;

    while (1) {
        if (await page.$('.hZqMfu') !== null) break;

        const allItems = await page.$$('.bzuPAv .gakkCe');

        for (const element of allItems) {
            try {
                if (!element) continue;

                const jsonObj = {
                    urlCode: '',
                    productTitle: '',
                    shipTotalAmount: '',
                    productActualPrice: '',
                    productOption: '',
                    sellerName: ''
                };

                jsonObj.urlCode = await element.$eval('a', (aTag) => aTag.getAttribute('href').split('/').pop().split('?').shift());

                const exist = result.find(item => item.urlCode === jsonObj.urlCode);

                if (exist) continue;

                try {
                    await element.$eval('a', node => node['click']());
                } catch (err) {
                    console.error('\na click error', err, result.length, jsonObj.urlCode);
                    continue;
                }

                await Promise.all([
                    page.waitForSelector('.cOJHDd', { timeout: 5000 }),
                    page.waitForSelector('.gXoUfd', { timeout: 5000 }),
                    page.waitForSelector('.icyWeb', { timeout: 5000 })
                ]);

                const [itemContent, soldBy] = await Promise.all([
                    page.$('.cOJHDd'),
                    page.$('.gXoUfd')
                ]);
                const [productTitle, productActualPrice, productOption, sellerName] = await Promise.all([
                    itemContent.$eval('.cFYDhA', node => node.textContent),
                    itemContent.$eval('.iGiyFe', node => node.textContent),
                    itemContent.$eval('.icyWeb', node => node.textContent.replace('Add to Wishlist', '')),
                    soldBy.$eval('.iCqXcu', node => node.textContent.replace('is an authorized merchant', ''))
                ]);

                jsonObj.productTitle = productTitle.includes('Stansport') ? productTitle : '';
                jsonObj.productActualPrice = productActualPrice;
                jsonObj.productOption = productOption;
                jsonObj.sellerName = sellerName;

                result.push(jsonObj);
                console.log(jsonObj);

                await page.keyboard.press('Escape');
                await page.waitFor(() => !document.querySelector('.cOJHDd'), { timeout: 3000 });
            } catch (err) {
                console.error('\nitem error:', err, result.length);
            }
        }

        try {
            previousHeight = await page.evaluate('document.body.scrollHeight');
            await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
            await page.waitForFunction(`document.body.scrollHeight > ${previousHeight}`);
            await page.waitFor(1000);
        } catch (err) {
            console.error('\nscroll error', err);
        }
    }
}

module.exports.scrape = async() => {
    if (!process.env.WISH_SITE_USERNAME || !process.env.WISH_SITE_PASSWORD) {
        return {
            statusCode: 500,
            body: JSON.stringify({
                err: 'Username or Password is not provided.'
            })
        }
    }

    const con = mysql.createConnection({
        host: process.env.RDS_CONNECTION_URL, // ip address of server running mysql
        user: process.env.RDS_USERNAME, // user name to your mysql database
        password: process.env.RDS_PASSWORD, // corresponding password
        database: process.env.RDS_SCHEMA // use the specified database
    });

    const browser = await puppeteer.launch(process.env.NODE_ENV === 'development' ? {
        headless: false
    } : {
        args: chrome.args,
        executablePath: await chrome.executablePath,
        headless: chrome.headless
    });
    const page = await browser.newPage();

    page.setViewport({ width: 1080, height: 926 });

    // Login
    try {
        await page.goto(process.env.WISH_SITE_URL);
        console.info(`-----Navigate to ${process.env.WISH_SITE_URL} page-----`);

        const requestId = await initiateCaptchaRequest(page);
        const response = await pollForRequestResults(requestId);

        console.info(`----Received response from 2Captcha api service----`);
        await page.waitForSelector('.eJgSLV', { timeout: 7000 });
        console.info('----Founded .eJgSLV----');
        await page.evaluate(`document.getElementById("g-recaptcha-response").innerHTML="${response}";`);
        await page.type('.eJgSLV input[data-id=emailAddress]', process.env.WISH_SITE_USERNAME);
        await page.type('.eJgSLV input[data-id=password]', process.env.WISH_SITE_PASSWORD);
        await page.evaluate(`recaptchaCallback('${response}');`);
        console.info('-----Login success-----');
    } catch (err) {
        console.error(err);
        return {
            statusCode: 400,
            body: JSON.stringify({
                err: err
            })
        }
    }
    await page.waitForSelector('.esLZmP', { timeout: 7000 });
    await page.goto(`https://www.wish.com/search/Stansport`);
    console.info(`----Navigate to https://www.wish.com/search/Stansport----`);
    console.info('--------Extracted products--------')
    await scrapeInfiniteScrollItems(page);
    await browser.close();

    console.info('--------Count of products--------')
    console.info(result.length);

    const records = [];

    for (const item of result) {
        records.push([
            item.urlCode,
            item.productTitle,
            item.shipTotalAmount,
            item.productActualPrice,
            item.productOption,
            item.sellerName
        ])
    }

    console.log('-----------RDS connection part------------');
    const sql_query = `INSERT INTO ${process.env.RDS_TABLE} (url_code, product_title, ship_total_amount, product_actual_price, product_option, seller_name) VALUES ?`
    console.log(process.env);
    await con.connect(function(err) {
        if (err) {
            console.error(err);
            throw err;
        }
        con.beginTransaction(function(err) {
            if (err) {
                console.error(err);
                throw err;
            }
            console.info('------------- records are begin --------------')
            con.query(sql_query, [records], function(err, result) {
                if (err) {
                    console.error(err);
                    con.rollback(function() {
                        throw err;
                    });
                }

                console.info('------------- Query just ran --------------')
                con.commit(function(err) {
                    if (err) {
                        con.rollback(function() {
                            throw err;
                        });
                    }
                    console.log('Transaction Complete.');
                    con.end();
                });
            });
        });
    });
    /* End transaction */
    console.log('-----------Completed successfully------------');

    return {
        statusCode: 200,
        body: JSON.stringify({ result })
    }
}