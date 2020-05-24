const chromium = require('chrome-aws-lambda');
const mysql = require("mysql");
const axios = require('axios');
const puppeteer = require('puppeteer');
let request = require("request");
let cheerio = require("cheerio");
require('dotenv').config('.env');
const getChromePath = require('@browserless/aws-lambda-chrome')({
  path: '/tmp'
})
let url = "https://www.googleapis.com/customsearch/v1?key=AIzaSyCQkRyzDU6OKU8RkRcG3FRyNKdgWUVA5dU&cx=003429913069680451282:ffpf7-envl0&q=site:amazon.com/shop";
let amazonUrls = [];
let userInfo = {};
// Call API using Google Custom Seach API
async function fetchData(start) {
    return await axios.get(`${url}&start=${start}`)
        .then(function(response) {
            // handle success
            const urls = response.data.items.map((node) => node.link);
            console.log(urls);
            return urls;
        })
        .catch(function(error) {
            // handle error
            console.log(error);
        })
        .finally(function() {
            // always executed
        });
}

// Get AmazonShop Urls with fetchData()
async function getUrls() {
    let startNumber = 1;
    let storeNum = 0;
    // await fetchData(1);
    while (startNumber < 100) {
        try {
            var urls = await fetchData(startNumber);
            console.log("-------------Urls-------------");
            // console.log(urls);
        } catch (error) {
            console.log("-------------errors-------------");
            console.error(error);
            storeNum = startNumber;
            break;
        }
        if (urls) amazonUrls = amazonUrls.concat(urls);
        startNumber += 10;
    }
    return amazonUrls;
}

//EvaluateSocialNetowkrURL
var evaluateSocialNetwork = (url) => {
    if (url.includes('twitter'))
        return "twitter";
    else if (url.includes('facebook'))
        return "facebook";
    else if (url.includes('instagram'))
        return "instagram";
    else if (url.includes('youtube'))
        return "youtube";
}
async function getCategory(url) {
    return new Promise((resolve, reject) => {
        request({ uri: `${url}`, gzip: true, method: 'GET' }, function(error, response, html) {
            if (!error) {
                let $ = cheerio.load(html);
                let category = "";
                console.log("---------Here Loaded HTML--------------");
                let query = `#wayfinding-breadcrumbs_feature_div li`;
                if ($(query)) {
                    $(query).map((index, item) => {
                        let list = ($(item).text()).replace(/(\r\n|\n|\r)/gm, "").replace(/\t+/g, "");
                        category = category.concat(list.trim());
                        // console.log("item: ", category.trim());

                    });
                    resolve(category);
                }

            } else reject(error);
        });
    });
}
//Scrapping all data from each Amazon Shop
async function fetchInfo(page, amazonUrl) {
    try {
        userInfo = {};
        await page.goto(amazonUrl, {
            waitUntil: 'networkidle0',
            // Remove the timeout
            timeout: 15000
        });
        try {
            await page.waitForSelector('.shop-affiliate-profile-logo-image');
        } catch (error) {
            console.log("---------Page Reload----------")
            await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
            // await page.waitForSelector('#discover-list-grid .grid-item .a-declarative a', { timeout: 5000 });
        }
        const [ProfileImage, shopName, influencerProfileLink] = await Promise.all([
            page.$eval('.shop-affiliate-profile-logo-image', node => node.getAttribute('src')),
            page.$eval('.shop-profile-name', node => node.innerText),
            page.$eval('.a-profile', node => node.getAttribute('href')),
        ]);
        userInfo.ShopURL = amazonUrl;
        userInfo.ProfileURL = `https://amazon.com/${influencerProfileLink}`;
        userInfo.ProfileImage = ProfileImage;
        userInfo.Name = shopName.slice(0, -1);

        console.log("----------Profile URL-----------------", influencerProfileLink);

        await page.goto(`https://amazon.com/${influencerProfileLink}`, {
            // Remove the timeout
            timeout: 15000
        });

        try {
            await page.waitForSelector('.dashboard-desktop-stat-value', { timeout: 10000 });

        } catch (error) {
            console.log("---------Page Reload----------")
            await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
            // await page.waitForSelector('#discover-list-grid .grid-item .a-declarative a', { timeout: 5000 });
        }

        const [insights] = await Promise.all([
            page.$$eval('.dashboard-desktop-stat-value', nodes => nodes.map(node => node.innerText)),
        ]);
        console.log("---------Insights-----------------", insights);

        let social_link_url = {};
        try {
            social_link_urls = await page.$$eval('.social-link a', nodes => nodes.map((node) => node.href));
            for (const node of social_link_urls) {
                social_link_url[evaluateSocialNetwork(node)] = node;
            }

        } catch (error) {
            console.log("-----error--------", error);
        }
        console.log("-----------Social Links--------")
        console.log(social_link_url);
        userInfo.HelpfulVotes = Number(insights[0]);
        userInfo.Hearts = Number(insights[2]);
        userInfo.IdeaLists = Number(insights[3]);
        userInfo.Reviews = Number(insights[1]);

        if (social_link_url.facebook) {

            userInfo.HasFacebook = 1;
            userInfo.FacebookLink = social_link_url.facebook;
            const facebookLink = `${social_link_url.facebook}`.replace(`https://www.`, `https://en-gb.`);

            await page.goto(facebookLink, {
                waitUntil: 'networkidle0',
                // Remove the timeout
                timeout: 15000
            });
            try {
                await page.waitForSelector('._6tb5', { timeout: 10000 });
                const [profileImage, userName, accountName, community, domain] = await Promise.all([
                    page.$eval('._6tb5', node => node.getAttribute('src')),
                    page.$eval('._33vv ._64-f', node => node.innerText),
                    page.$eval('._2wmb', node => node.innerText),
                    page.$$eval('._4-u2._6590._3xaf._4-u8 ._4bl9', nodes => nodes.map(node => node.innerText)),
                    page.$eval('._4bl9 a:nth-child(2)', node => `http://${node.innerText}`),

                ]);

                await page.goto(`${facebookLink}/about/`, {
                    // Remove the timeout
                    timeout: 10000
                });
                try {
                    await page.waitForSelector('._4-u2._3xaf._3-95._4-u8');
                    const allItems = await page.$$('._4-u2._3xaf._3-95._4-u8');
                    let moreInfoElement;
                    for (const element of allItems) {
                        if (await element.$('._50f7')) {
                            const subElementText = await element.$eval('._50f7', node => node.innerText);
                            // const subElementText = await element.$eval('._50f7', node => node.innerText);
                            if (subElementText === "MORE INFO") {
                                moreInfoElement = element;
                                // console.log(moreInfoElement);
                                break;
                            }
                        }

                    }
                    const moreAbout = await moreInfoElement.$eval('._3-8w', node => node.innerText);

                    userInfo.FacebookImage = profileImage;
                    userInfo.FacebookUsername = userName;
                    userInfo.FacebookAccountname = accountName;
                    userInfo.FacebookMoreAbout = moreAbout;
                    userInfo.FacebookLikes = Number(community[0].split(' ')[0].split(",").join(''));
                    userInfo.FacebookFollowers = Number(community[1].split(' ')[0].split(",").join(''));
                    userInfo.FacebookDomain = domain;

                } catch (error) {}
            } catch (error) {}
        }
        if (social_link_url.instagram) {
            userInfo.HasInstagram = 1;
            userInfo.InstagramLink = social_link_url.instagram;
            await page.goto(social_link_url.instagram, {
                waitUntil: 'networkidle0',
                // Remove the timeout
                timeout: 15000
            });
            try {
                await page.waitForSelector('._6q-tv', { timeout: 10000 });
                const [profileImage, userName, accountName, bio, domain] = await Promise.all([
                    page.$eval('._6q-tv', node => node.getAttribute('src')),
                    page.$eval('.rhpdm', node => node.innerText),
                    page.$eval('.fDxYl', node => node.innerText),
                    page.$eval('.-vDIg span', node => node.innerText),
                    page.$eval('.yLUwa', node => node.innerText),

                ]);

                userInfo.InstagramProfileImage = profileImage;
                userInfo.InstagramUsername = userName;
                userInfo.InstagramName = accountName;
                userInfo.InstagramBio = bio;

                const allItems = await page.$$('.Y8-fY ');
                for (const element of allItems) {
                    const subElementText = await element.$eval('.-nal3', node => node.innerText);
                    if (subElementText.includes('followers'))
                        userInfo.InstagramFollowers = Number(subElementText.split(' ')[0].split(",").join(''));
                    else if (subElementText.includes('following'))
                        userInfo.InstagramFollowing = Number(subElementText.split(' ')[0].split(",").join(''));
                }
                userInfo.InstagramWebsite = domain;
            } catch (error) {}
        }
        if (social_link_url.twitter) {
            userInfo.HasTwitter = 1;
            userInfo.TwitterLink = social_link_url.twitter;
            await page.goto(social_link_url.twitter, {
                waitUntil: 'networkidle0',
                // Remove the timeout
                timeout: 15000
            });
            try {
                await page.waitForSelector('.r-11mg6pl', { timeout: 10000 });
                const [profileImage, userName, accountName, bio, following, followers] = await Promise.all([
                    page.$eval('.r-11mg6pl .css-9pa8cd', node => node.getAttribute('src')),
                    page.$eval('.r-15d164r.r-1g94qm0 .r-18u37iz.r-dnmrzs', node => node.innerText),
                    page.$eval('.r-15d164r.r-1g94qm0 .r-18u37iz.r-1wbh5a2', node => node.innerText),
                    page.$$eval('.r-1adg3ll.r-15d164r', nodes => nodes[0].innerText),
                    page.$eval('.r-1h2hfjv div:nth-child(1) a', node => node.title),
                    page.$eval('.r-1h2hfjv div:nth-child(2) a', node => node.title),
                    // page.$eval('.yLUwa', node => node.innerText),

                ]);
                userInfo.TwitterProfileImage = profileImage;
                userInfo.TwitterName = accountName;
                userInfo.TwitterUsername = userName;
                userInfo.TwitterBio = bio;
                userInfo.TwitterFollowing = Number(following.split(",").join(''));
                userInfo.TwitterFollowers = Number(followers.split(",").join(''));

                if (await page.$('.r-1vglu5a span:nth-child(1)')) {
                    let location = await page.$eval('.r-1vglu5a span:nth-child(1)', node => node.innerText);
                    if (!location.includes("Joined"))
                        userInfo.TwitterLocation = location;

                }
                if (await page.$('.r-1vglu5a a'))
                    userInfo.TwitterWebsite = await page.$eval('.r-1vglu5a a', node => node.innerText);
            } catch (error) {}
        }
        if (social_link_url.youtube) {
            userInfo.HasYoutube = 1;
            userInfo.YoutubeLink = social_link_url.youtube;
            await page.goto(`${social_link_url.youtube}?gl=US`, {
                waitUntil: 'networkidle0',
                // Remove the timeout
                timeout: 15000
            });
            try {

                await page.waitForSelector('#channel-header-container  #avatar img', { timeout: 10000 });
                const [profileImage, userName, subscriberCount] = await Promise.all([
                    page.$eval('#channel-header-container  #avatar img', node => node.getAttribute('src')),
                    page.$eval('#channel-header-container  #channel-name', node => node.innerText),
                    page.$eval('#channel-header-container #subscriber-count', node => node.innerText.split(' ')[0]),

                ]);
                userInfo.YoutubeName = userName;
                userInfo.YoutubeProfileImage = profileImage;
                const unit = subscriberCount[subscriberCount.length - 1];
                let subscriber = parseFloat(subscriberCount);
                if (unit === 'K')
                    subscriber = subscriber * 1000;
                else if (unit === 'M')
                    subscriber = subscriber * 1000000;

                userInfo.YoutubeSubscriberCount = subscriber;
                userInfo.YoutubeSocialMediaLinks = "";

                await page.goto(`${social_link_url.youtube}/about?gl=US&`, {
                    waitUntil: 'networkidle0',
                    // Remove the timeout
                    timeout: 15000
                });
                try {

                    await page.waitForSelector('#description-container #description');
                    const [description, links, views] = await Promise.all([
                        page.$eval('#description-container #description', node => node.innerText),
                        page.$$eval('#link-list-container a', nodes => nodes.map((node) => node.href)),
                        page.$$eval('#right-column yt-formatted-string', nodes => nodes[2].innerText.split(' ')[0]),

                    ]);
                    userInfo.YoutubeDesc = description;
                    userInfo.YoutubeLinks = JSON.stringify(links);
                    userInfo.YoutubeViews = views.split(",").join('');


                    const detailsElement = await page.$$('#details-container tr');
                    for (const detailElement of detailsElement) {
                        if (await detailElement.$('td')) {
                            let data = await detailElement.$eval('td', node => node.innerText);
                            console.log("data: ", data);
                            if (data.includes('Location')) {
                                console.log("-------location------")
                                userInfo.YoutubeLocation = await detailElement.$eval('td:nth-child(2)', node => node.innerText)
                            }

                        }
                    }

                } catch (error) {}

            } catch (error) {}
        }

        await page.goto(`https://amazon.com/${influencerProfileLink}`, {
            waitUntil: 'networkidle0',
            // Remove the timeout
            timeout: 15000
        });
        console.log("--------------Get FoundItOnAmazon-----------------")
        if (userInfo.IdeaLists > 4) {
            await page.waitForSelector('.a-row.a-spacing-top-small');
            if (await page.$('.a-row.a-spacing-top-small a')) {
                await page.$eval('.a-row.a-spacing-top-small a', node => node['click']());
                await page.waitForSelector('.a-profile-avatar');
                if (await page.$('.glimpse-fiona-navigation-logo-link')) {
                    const FoundItOnAmazon = await page.$eval('.glimpse-fiona-navigation-logo-link', node => node.innerText);
                    userInfo.FoundItOnAmazon = 1;
                } else
                    userInfo.FoundItOnAmazon = 0;

            }
        } else if (userInfo.IdeaLists > 0 && userInfo.IdeaLists < 5) {
            userInfo.FoundItOnAmazon = 1
        } else if (userInfo.IdeaLists === 0)
            userInfo.FoundItOnAmazon = 0
        console.log("--------------Scrapping Product List-----------------")
        await page.goto(amazonUrl, {
            waitUntil: 'networkidle0',
            // Remove the timeout
            timeout: 15000
        });
        try {
            await page.waitForSelector('.shop-affiliate-profile-logo-image', { timeout: 10000 });
            let Categories = [];
            let IdeaUrls = [];
            if (userInfo.IdeaLists > 1) {
                const ideaListsUrl = await page.$$eval('#discover-list-published-lists-grid .jetset-list-grid-item a', nodes => nodes.map(node => node.href));
                console.log("--IdeaListsUrl--", ideaListsUrl);

                for (const ideaListUrl of ideaListsUrl) {
                    console.log("-------Click Idea Lists-------");
                    await page.goto(ideaListUrl, {
                        waitUntil: 'networkidle0',
                        // Remove the timeout
                        timeout: 15000
                    });
                    try {
                        await page.waitForSelector('#discover-list-grid .grid-item .a-declarative a', { timeout: 5000 });

                    } catch (error) {
                        console.log("---------Page Reload----------")
                        await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
                    }
                    const ideasUrl = await page.$$eval('#discover-list-grid .grid-item .a-declarative a', nodes => nodes.map((node) => node.href.split("?")[0]));
                    IdeaUrls = IdeaUrls.concat(ideasUrl);

                }
            } else if (userInfo.IdeaLists === 1) {
                const ideasUrl = await page.$$eval('#discover-list-grid .grid-item .a-declarative a', nodes => nodes.map((node) => node.href.split("?")[0]));
                IdeaUrls = IdeaUrls.concat(ideasUrl);

            }
            console.log("-----------------Request from Idea Urls-----------");
            console.log(IdeaUrls);
            for (const nodeUrl of IdeaUrls) {
                const Category = await getCategory(nodeUrl);
                if (Category)
                    Categories.push(Category);
            }
            console.log("------------Category Lists-----------------");
            console.log(Categories);
            userInfo.Categories = Categories;
        } catch (error) {

        }
        return userInfo;

    } catch (error) {
        console.log(error);
        await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
    }
}
async function getAllShopsInfo() {

    const connection = mysql.createConnection({
        host: process.env.DB_HOST, // ip address of server running mysql
        user: process.env.DB_USERNAME, // user name to your mysql database
        password: process.env.DB_PASSWORD, // corresponding password
        database: process.env.DB_NAME // use the specified database
    });
    try {
        console.log("connection is success");
        connection.connect();
    } catch (error) {
        console.error(error);
    }
    //amazonUrls = await getUrls();
    console.log("Length of Amazon", amazonUrls.length);
    const browser = await chromium.puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });
    const page = await browser.newPage();
        const userInfo = await fetchInfo(page, "https://www.amazon.com/shop/bnbob01");
        let amazonShops = {};
        let categoryJson = {};
        amazonShops.ShopURL = userInfo.ShopURL ? userInfo.ShopURL : "";
        amazonShops.ProfileURL = userInfo.ProfileURL ? userInfo.ProfileURL : "";
        amazonShops.ProfileImage = userInfo.ProfileImage ? userInfo.ProfileImage : "";
        amazonShops.Name = userInfo.Name ? userInfo.Name : "";
        amazonShops.HelpfulVotes = userInfo.HelpfulVotes ? userInfo.HelpfulVotes : 0;
        amazonShops.Hearts = userInfo.Hearts ? userInfo.Hearts : 0;
        amazonShops.IdeaLists = userInfo.IdeaLists ? userInfo.IdeaLists : 0;
        amazonShops.Reviews = userInfo.Reviews ? userInfo.Reviews : 0;
        amazonShops.HasFacebook = userInfo.HasFacebook ? userInfo.HasFacebook : 0;
        amazonShops.HasTwitter = userInfo.HasTwitter ? userInfo.HasTwitter : 0;
        amazonShops.HasInstagram = userInfo.HasInstagram ? userInfo.HasInstagram : 0;
        amazonShops.HasYoutube = userInfo.HasYoutube ? userInfo.HasYoutube : 0;
        amazonShops.FacebookLink = userInfo.FacebookLink ? userInfo.FacebookLink : "";
        amazonShops.FacebookImage = userInfo.FacebookImage ? userInfo.FacebookImage : "";
        amazonShops.FacebookUsername = userInfo.FacebookUsername ? userInfo.FacebookUsername : "";
        amazonShops.FacebookAccountname = userInfo.FacebookAccountname ? userInfo.FacebookAccountname : "";
        amazonShops.FacebookMoreAbout = userInfo.FacebookMoreAbout ? userInfo.FacebookMoreAbout : "";
        amazonShops.FacebookLikes = userInfo.FacebookLikes ? userInfo.FacebookLikes : 0;
        amazonShops.FacebookFollowers = userInfo.FacebookFollowers ? userInfo.FacebookFollowers : 0;
        amazonShops.FacebookDomain = userInfo.FacebookDomain ? userInfo.FacebookDomain : "";
        amazonShops.InstagramLink = userInfo.InstagramLink ? userInfo.InstagramLink : "";
        amazonShops.InstagramProfileImage = userInfo.InstagramProfileImage ? userInfo.InstagramProfileImage : "";
        amazonShops.InstagramUsername = userInfo.InstagramUsername ? userInfo.InstagramUsername : "";
        amazonShops.InstagramName = userInfo.InstagramName ? userInfo.InstagramName : "";
        amazonShops.InstagramBio = userInfo.InstagramBio ? userInfo.InstagramBio : "";
        amazonShops.InstagramFollowing = userInfo.InstagramFollowing ? userInfo.InstagramFollowing : 0;
        amazonShops.InstagramFollowers = userInfo.InstagramFollowers ? userInfo.InstagramFollowers : 0;
        amazonShops.InstagramWebsite = userInfo.InstagramWebsite ? userInfo.InstagramWebsite : "";
        amazonShops.TwitterLink = userInfo.TwitterLink ? userInfo.TwitterLink : "";
        amazonShops.TwitterProfileImage = userInfo.TwitterProfileImage ? userInfo.TwitterProfileImage : "";
        amazonShops.TwitterName = userInfo.TwitterName ? userInfo.TwitterName : "";
        amazonShops.TwitterUsername = userInfo.TwitterUsername ? userInfo.TwitterUsername : "";
        amazonShops.TwitterLocation = userInfo.TwitterLocation ? userInfo.TwitterLocation : "";
        amazonShops.TwitterBio = userInfo.TwitterBio ? userInfo.TwitterBio : "";
        amazonShops.TwitterWebsite = userInfo.TwitterWebsite ? userInfo.TwitterWebsite : "";
        amazonShops.TwitterFollowing = userInfo.TwitterFollowing ? userInfo.TwitterFollowing : 0;
        amazonShops.TwitterFollowers = userInfo.TwitterFollowers ? userInfo.TwitterFollowers : 0;
        amazonShops.YoutubeLink = userInfo.YoutubeLink ? userInfo.YoutubeLink : "";
        amazonShops.YoutubeName = userInfo.YoutubeName ? userInfo.YoutubeName : "";
        amazonShops.YoutubeProfileImage = userInfo.YoutubeProfileImage ? userInfo.YoutubeProfileImage : "";
        amazonShops.YoutubeSubscriberCount = userInfo.YoutubeSubscriberCount ? userInfo.YoutubeSubscriberCount : 0;
        amazonShops.YoutubeDesc = userInfo.YoutubeDesc ? userInfo.YoutubeDesc : "";
        amazonShops.YoutubeLocation = userInfo.YoutubeLocation ? userInfo.YoutubeLocation : "";
        let youtubelinkJson = {};
        youtubelinkJson.YoutubeLinks = userInfo.YoutubeLinks ? userInfo.YoutubeLinks : "";
        amazonShops.YoutubeLinks = JSON.stringify(youtubelinkJson);
        amazonShops.YoutubeViews = userInfo.YoutubeViews ? userInfo.YoutubeViews : 0;
        amazonShops.YoutubeEmail = userInfo.YoutubeEmail ? userInfo.YoutubeEmail : "";
        amazonShops.FoundItOnAmazon = userInfo.FoundItOnAmazon ? userInfo.FoundItOnAmazon : 0;
        categoryJson.categories = userInfo.Categories ? userInfo.Categories : ""
        amazonShops.Categories = JSON.stringify(categoryJson);
        console.log(amazonShops);
        connection.query(
            "INSERT INTO amazon_shops SET ?",
            amazonShops,
            (err, res) => {
                if (err) {
                    console.log("------------------error---------------------");
                    console.log(err);
                } else {
                    console.log("Successfully Added:");
                    console.log("----------------Amazon Shops List------------------");
                    console.log(amazonShops);
                }
            }
        );
    //}
    page.close();


}

getAllShopsInfo();