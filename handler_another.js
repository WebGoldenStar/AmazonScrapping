const chrome = require('chrome-aws-lambda');
const puppeteer = require('puppeteer');
const mysql = require('mysql');

let result = [];

const extractItems = async(page, batchId, googleAuthSellers, inputData) => {
    console.info(`----Navigating to ${process.env.GOOGLE_STORE_URL + inputData.googleid}/online, batchId: ${batchId}----`);
    await page.goto(process.env.GOOGLE_STORE_URL + inputData.googleid + '/online');

    isProduct = await page.$('#pp-main');

    if (isProduct) {
        console.info('No such product');
        return;
    }

    await page.waitForSelector('.GpJKE a', { timeout: 5000 });

    while (1) {
        if (await page.$('#sh-fp__pagination-button-wrapper button') === null) {
            break;
        } else {
            console.log('----click button exist---');
            await page.$eval('#sh-fp__pagination-button-wrapper button', node => node['click']());
            await page.waitFor(1000);
        }
    }

    const allItems = await page.$$('.sh-osd__offer-row');

    for (let i = 0; i < allItems.length; i++) {
        try {
            const element = allItems[i];
            if (!element) continue;

            const jsonObj = {
                batchId: batchId,
                name: '',
                brand: inputData.brand,
                asin: inputData.asin,
                upc: inputData.upc,
                productId: inputData.googleid,
                seller: '',
                market: '',
                mapPrice: inputData.map_price,
                authorizedSeller: 0,
                link: '',
                price: '',
                details: '',
                sellerField: ''
            };

            const [sellerField, market, seller, price, link] = await Promise.all([
                element.$eval('.sh-osd__merchant-info-container a span', node => node.textContent),
                element.$eval('.sh-osd__merchant-info-container a span', node => node.textContent.split('-').length >= 2 ? node.textContent.split('-').shift().trim() : node.textContent.trim()),
                element.$eval('.sh-osd__merchant-info-container  a span', node => node.textContent.split('-').length >= 2 ? node.textContent.split('-').pop().trim() : ''),
                element.$$eval('td', nodes => nodes[2].textContent.replace('$', '').trim()),
                element.$$eval('.shntl', nodes => nodes[1].href)
            ]);
            jsonObj.name = await page.$eval('.GpJKE a', node => node.textContent);
            jsonObj.sellerField = sellerField;
            jsonObj.market = market;
            jsonObj.seller = seller;
            jsonObj.link = link;
            jsonObj.price = price;

            if (isGoogleAuth(googleAuthSellers, jsonObj)) {
                jsonObj.authorizedSeller = 1;
            }

            const exist = result.find(item => item.batchId === jsonObj.batchId && item.productId === jsonObj.productId && item.sellerField === jsonObj.sellerField && item.price === jsonObj.price);

            if (exist) continue

            result.push(jsonObj);
        } catch (err) {
            console.error('\nitem error:', err, result.length);
        }
    }
}

const runQuery = (con, query) => {
    return new Promise((resolve, reject) => {
        con.query(query, (error, results, fields) => {
            if (error) {
                console.log(error);
                reject(error);
            };
            console.info('------Query executed-----');
            resolve(results);
        });
    });
}

const insertQuery = (con, query, data) => {
    return new Promise((resolve, reject) => {
        con.query(query, [data], (error, results) => {
            if (error) {
                console.log(error);
                reject(error);
            };
            console.info('------Query executed-----');
            resolve(results);
        });
    });
}

const getLatestBatchId = async(con) => {
    const sqlQuery = `SELECT MAX(BatchId) AS ID FROM google_lambda LIMIT 1`;
    const results = await runQuery(con, sqlQuery);

    console.info('----Extracted latest BatchId----');
    return (parseInt(results[0].ID) || 0);
}

const getProductInputData = async(con) => {
    const sqlQuery = `SELECT upc, brand, asin, map_price, googleid FROM asin_map_prices where googleid`;
    const results = await runQuery(con, sqlQuery);

    console.info('-------Extracted productInputData----');
    return results;
}

const getGoogleAuthSeller = async(con) => {
    const sqlQuery = `SELECT * FROM google_authorized_seller`;
    const results = await runQuery(con, sqlQuery);

    console.info('-------Extracted googleAuthSellers----');
    return results;
}

function isGoogleAuth(googleAuthSellers, productInfo) {
    const myObj = googleAuthSellers.find(item => {
        if (!productInfo.seller) {
            return item.brand == productInfo.brand && item.market == productInfo.market;
        } else {
            return item.brand == productInfo.brand && item.market == productInfo.market && item.seller == productInfo.seller;
        }
    });
    return !!myObj;
}

module.exports.scrape = async() => {
    const con = mysql.createConnection({
        host: process.env.RDS_CONNECTION_URL, // ip address of server running mysql
        user: process.env.RDS_USERNAME, // user name to your mysql database
        password: process.env.RDS_PASSWORD, // corresponding password
        database: process.env.RDS_SCHEMA // use the specified database
    });

    const browser = await puppeteer.launch(process.env.NODE_ENV === 'development' ? {
        headless: false,
        args: ['--headless']
    } : {
        args: chrome.args,
        executablePath: await chrome.executablePath,
        headless: chrome.headless
    });
    const page = await browser.newPage();

    page.setViewport({ width: 1080, height: 926 });

    result = []; // initialize result variable for lambda

    let latestBachId = await getLatestBatchId(con);

    latestBachId += 1;
    inputList = await getProductInputData(con);

    const googleAuthSellers = await getGoogleAuthSeller(con);
    console.info('--------Extracting products--------');

    for (const inputData of inputList) {
        console.info(inputData)
        await extractItems(page, latestBachId, googleAuthSellers, inputData);
    }

    await browser.close();

    console.info('--------Count of products--------')
    console.info(result.length);

    const records = [];

    for (const item of result) {
        records.push([
            item.batchId,
            item.name,
            item.brand,
            item.asin,
            item.upc,
            item.productId,
            item.sellerField,
            item.market,
            item.seller,
            item.authorizedSeller,
            item.details,
            item.link,
            item.price,
            item.mapPrice
        ])
    }

    console.log('-----------RDS connection part------------');
    const sql_query = `INSERT INTO ${process.env.RDS_TABLE} (BatchId, Name, brand, asin, UPC, GoogleProductId, SellerField, Market, Seller, authorized_seller, Details, Link, Price, map_price) VALUES ?`

    console.log('-----------Inserting data to RDS DB------------');
    await insertQuery(con, sql_query, records);
    console.log('-----------Completed successfully------------');

    return {
        statusCode: 200,
        body: JSON.stringify({ result })
    }
}