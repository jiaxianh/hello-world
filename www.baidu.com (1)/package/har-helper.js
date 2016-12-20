/**
 * Created with IntelliJ IDEA.
 * User: eyalfingold
 * Date: 01/13/15
 * Time: 18:35 PM
 */

var cookieParser = require('cookie');

var collectedCookies;

var urlList;

var urlCurrentllyProccesed = {count: 0, total: 0, requests: 0, queue: 0, issuesRequests: 0, closedThreads: 0,openThreads:0, skipped: 0};  //urlList['urlCurrentllyProccesed'];

var proxy = process.env.http_proxy ? process.env.http_proxy : undefined;

var blackListHosts, vuser;

function loadHarFile(svc, urlListFile, urlList, urlLists, hosts) {
    /* load url list */
    //svc.logger.info('load url list from %s', urlListFile);
    try {

        // get all the Urls for Har File
        urlList = JSON.parse(loadFromFile(urlListFile)).log.entries;
        urlList['len'] = urlList.length;
        urlList['idx'] = 0;
        urlList['queue'] = [];

        // split the urls based on domain to allow running concurrent tests per host
        //geting url lists
        getDomains(urlList, hosts);

        //generating urls lists based on the hosts
        for (var j = 0; j < urlList.length; j++) {
            //svc.logger.info('load url %s - %s', j, urlList[j].request.url);
            var host = urlList[j].request.headers[arrayObjectIndexOf(urlList[j].request.headers, "name", "Host")];

            if (undefined!==urlList[j]){
                urlLists['All'].push(urlList[j]);
                urlLists['All']['len']++;
            }
            if (host !== undefined) {
                var hostsIndex = hosts.indexOf(host.value);
                if (hostsIndex !== -1) {

                    urlLists[host.value].push(urlList[j]);
                    urlLists[host.value]['len']++;
                }
            }
        }
    }
    catch (err) {
        svc.logger.error('Cannot load url list from %s', err, urlListFile);
    }
}

function loadFromFile(filename) {
    var fs = require('fs');
    var file = __dirname + '/' + filename;
    var newdata = fs.readFileSync(file, 'utf8');
    return newdata;
};

exports.loadFromFile = function (filename) {
    return loadFromFile(filename);
};

function arrayObjectIndexOf(array, property, value) {
    for (var i = 0, len = array.length; i < len; i++) {
        if (array[i][property] === value)
            return i;
    }
    return -1;
}

function getDomains(urlList, hosts) {

    urlLists['All'] = [];
    urlLists['All']['name'] = 'All';
    urlLists['All']['len'] = 0;
    urlLists['All']['idx'] = 0;
    urlLists['All']['queue'] = [];

    for (var j = 0; j < urlList.length; j++) {
        var host = urlList[j].request.headers[arrayObjectIndexOf(urlList[j].request.headers, "name", "Host")];
        if (host !== undefined) {
            var hostsIndex = hosts.indexOf(host.value);
            if (hostsIndex === -1) {
                hosts.push(host.value);
                urlLists[host.value] = [];
                urlLists[host.value]['name'] = host.value;
                urlLists[host.value]['len'] = 0;
                urlLists[host.value]['idx'] = 0;
                urlLists[host.value]['queue'] = [];
                urlLists[host.value]['cookies'] = [];
            }
        }
    }
}

function checkBlackList(urlToCheck) {
    for (var j = 0; j < blackListHosts.length; j++) {
        if (urlToCheck.indexOf(blackListHosts[j]) >= 0) {
            return false;
        }
    }
    return true;
}

Array.prototype.get = function (name) {
    for (var i = 0, len = this.length; i < len; i++) {
        if (typeof this[i] != "object") continue;
        if (this[i].name === name) return this[i].value;
    }
};

function testUrlItem(vThreadNumber, urlList, svc, urlItem, urlCurrentllyProccesed, nonStaticCallback, StaticCallback, done, BrowserData, collectedCookies, Parameters, urlOverrides) {
    urlList['idx']++;

    // need to add URL to Q, capture/build parameters and pass them to next in line
    // for now we just skipping URL to make sure all static ones are handled ok
    var reqOpts;
    StaticCallback = StaticCallback || function () {
    };
    urlItem = urlItem || {};

    var mimeType = "";
    if ((undefined !== urlItem) && (undefined !== urlItem.response) && (undefined !== urlItem.response.content) && (undefined !== urlItem.response.content.mimeType))
        mimeType = urlItem.response.content.mimeType;

    // TODO: verify static files dont require authentication as well
    if ((undefined !== urlItem.request) && (undefined != urlItem.request.method) && (urlItem.request.method === "GET") && (checkIsStaticMimeTypes(mimeType))) {
        urlCurrentllyProccesed.count = urlCurrentllyProccesed.count + 1;
        urlCurrentllyProccesed.total = urlCurrentllyProccesed.total + 1;
        testStaticUrlItem(vThreadNumber, urlList, svc, urlItem, urlCurrentllyProccesed, nonStaticCallback, StaticCallback, done, BrowserData, collectedCookies, Parameters, urlOverrides);
    }
    else if (urlList['queue'].length > 0) {
        // adding the URL to the queue array
        // adding url as an id to later remove from queue
        urlItem['url'] = urlItem.request.url;
        urlList['queue'].push(urlItem);
        urlCurrentllyProccesed.queue++;
        StaticCallback(vThreadNumber, urlList, svc, urlCurrentllyProccesed, nonStaticCallback, StaticCallback, done, BrowserData, collectedCookies, Parameters, urlOverrides);
    }
    else {
        // Process not static urlItem
        // adding url as an id to later remove from queue
        urlItem['url'] = urlItem.request.url;
        urlList['queue'].push(urlItem);
        urlCurrentllyProccesed.queue++;
        urlCurrentllyProccesed.count = urlCurrentllyProccesed.count + 1;
        urlCurrentllyProccesed.total = urlCurrentllyProccesed.total + 1;
        testNonStaticUrlItem(vThreadNumber, urlList, svc, urlItem.request.url, urlItem, urlCurrentllyProccesed, nonStaticCallback, StaticCallback, done, BrowserData, collectedCookies, Parameters, urlOverrides);
    }
}

function addCookie(collectedCookies, cookie) {
    var cookieFlag = false;
    var nameCookie = cookie[0].split(";")[0].split("=")[0];
    for (var cookieIdx = 0; cookieIdx < collectedCookies.length; cookieIdx++) {
        if (collectedCookies[cookieIdx][0].indexOf(nameCookie) >= 0) {
            collectedCookies[cookieIdx] = cookie;
            cookieFlag = true;
        }
    }
    if (cookieFlag === false) {
        collectedCookies.push(cookie);
    }
}

function testNonStaticUrlItem(vThreadNumber, urlList, svc, url, urlItem, urlCurrentllyProccesed, nonStaticCallback, StaticCallback, done, BrowserData, collectedCookies, Parameters, urlOverrides) {
    var reqOpts;
    svc.logger.info('vThreadNumber:%s, testNonStatic UrlItem URL %s', vThreadNumber, urlItem.request.url);

    nonStaticCallback = nonStaticCallback || function () {
    };
    urlItem = urlItem || {};
    /* setting up request options, coping related request options from recorded har */
    reqOpts = {
        url: urlItem.request.url,
        proxy: proxy,
        method: urlItem.request.method,
        headers: {
            'User-Agent': BrowserData.userAgent
        },

    };

    // adding post data if needed
    if (undefined !== urlItem.request.postData)
        reqOpts.body = urlItem.request.postData.text;

    // adding all headrs but User-Agent and Cookies
    for (var i = 0, len = urlItem.request.headers.length; i < len; i++) {
        if (((undefined !== urlItem.request.headers[i].name)) && ((urlItem.request.headers[i].name === "Accept-Encoding"))) {
            if (urlItem.request.headers[i].value.indexOf("gzip")>=0)
            {
                //TODO: enable gzip once solving the problem of svc.request not ungziping gzip, for now disableing gzip on NON static requests to enable interception of content from body
                urlItem.request.headers[i].value = "";
                //reqOpts.gzip = true;
            }
        }
        if (((undefined !== urlItem.request.headers[i].name)) && (urlItem.request.headers[i].name !== "User-Agent") && ((urlItem.request.headers[i].name !== "Cookie"))) {
            urlItem.request.headers[i].name = urlItem.request.headers[i].name.replace(/:/g, '_');
            reqOpts.headers[urlItem.request.headers[i].name] = urlItem.request.headers[i].value;

        }
        else if (((undefined !== urlItem.request.headers[i].name)) && ((urlItem.request.headers[i].name === "Cookie"))) {

            inspectAndAddCookies(svc, urlLists, reqOpts, urlItem, i, collectedCookies, Parameters, urlOverrides);

        }
    }

    // if URL is not in blacklist
    if (checkBlackList(urlItem.request.url)) {
        urlCurrentllyProccesed.requests = urlCurrentllyProccesed.requests + 1;
        //svc.logger.info('vThreadNumber:%s,Testing URL %s:%s ', vThreadNumber, reqOpts.method, reqOpts.url);

        if (undefined !== urlOverrides) {
            for (var urlOverridesIndex = 0, len = urlOverrides.length; urlOverridesIndex < len; urlOverridesIndex++) {
                if (urlOverrides[urlOverridesIndex].url === reqOpts.url)
                {
                    //svc.logger.log("beforeRequest:", urlItem.request.url);
                    urlOverrides[urlOverridesIndex].beforeRequest(svc, urlItem, collectedCookies, Parameters, reqOpts);
                }
            }
        }
        svc.request(reqOpts, function (err, res, body) {
            urlCurrentllyProccesed.issuesRequests++;
            if (err) {
                svc.logger.error('vThreadNumber:%s,request on url %s error %s', vThreadNumber,reqOpts.url, JSON.stringify(err));
            } else if (undefined !== res) {
                //svc.logger.info("vThreadNumber:%s,Processing request for tokens in Cookies...%s", vThreadNumber, reqOpts.url);

                if ((undefined !== res.headers) && (undefined !== res.headers['set-cookie'] )) {
                    //svc.logger.info("vThreadNumber:%s,found some cookies%s", vThreadNumber, res.headers['set-cookie']);
                    addCookie(collectedCookies, res.headers['set-cookie']);
                }
                if ((undefined !== res.headers) && (undefined !== res.headers['Set-Cookie'] )) {
                    //svc.logger.info("vThreadNumber:%s,found some cookies%s", vThreadNumber, res.headers['Set-Cookie']);
                    addCookie(collectedCookies, res.headers['Set-cookie']);
                }


                //svc.logger.info("vThreadNumber:%s,checking request...%s", vThreadNumber, reqOpts.url);
                if (urlItem.response.status === res.statusCode) {
                    //svc.logger.info("vThreadNumber:%s,status Response comparison ok", vThreadNumber);
                }
                else if (((urlItem.response.status === 304)|| (urlItem.response.status === 302))&& (res.statusCode === 200)) {
                    //svc.logger.info("vThreadNumber:%s,status Response comparison ok", vThreadNumber);
                }
                else {
                    //svc.logger.error("vThreadNumber:%s,status Response is not equal to original recording\n Original:%s\nNew:%s", vThreadNumber, urlItem.response.status, JSON.stringify(res.statusCode));
                }

                if (undefined !== res.headers) {
                    if (urlItem.response.headers['mimeType'] === res.headers['mimeType']) {
                        //svc.logger.info("vThreadNumber:%s,mimeType Response comparison ok", vThreadNumber);
                    }
                    else {
                        //svc.logger.error("vThreadNumber:%s,mimeType Response is not equal to original recording\n Original:%s\nNew:%s", vThreadNumber, urlItem.response.headers['mimeType'], res.headers['mimeType']);
                    }
                }

                if (undefined !== urlOverrides) {
                    for (var urlOverridesIndex2 = 0, len = urlOverrides.length; urlOverridesIndex2 < len; urlOverridesIndex2++) {
                        if (urlOverrides[urlOverridesIndex2].url === urlItem.request.url)
                        {
                            //svc.logger.log("afterRequest", urlItem.request.url);
                            urlOverrides[urlOverridesIndex2].afterRequest(svc, urlItem, collectedCookies, Parameters, urlOverrides, res, body);
                        }
                    }

                }

                //svc.logger.info('vThreadNumber:%s,After Testing URL %s:%s --> %s', vThreadNumber, reqOpts.method, reqOpts.url, res.statusCode);
            }
            nonStaticCallback(vThreadNumber, urlList, svc, url, urlCurrentllyProccesed, done, BrowserData, collectedCookies, Parameters, urlOverrides, nonStaticCallback, StaticCallback);
        });
    }
    else {
        urlCurrentllyProccesed.skipped++;
        //svc.logger.info('vThreadNumber:%s,Skipping URL %s', vThreadNumber, urlItem.request.url);
        nonStaticCallback(vThreadNumber, urlList, svc, url, urlCurrentllyProccesed, done, BrowserData, collectedCookies, Parameters, urlOverrides, nonStaticCallback, StaticCallback);
    }
}

function onNonStaticCallback(vThreadNumber, urlList, svc, url, urlCurrentllyProccesed, done, BrowserData, collectedCookies, Parameters, urlOverrides, nonStaticCallback, StaticCallback, err) {
    urlCurrentllyProccesed.count = urlCurrentllyProccesed.count - 1;
    var indexOfItem = arrayObjectIndexOf(urlList['queue'], "url", url);
    if (indexOfItem > -1) {
        //svc.logger.info("vThreadNumber:%s,Removing %s from Static Q", vThreadNumber, url);
        urlList['queue'].splice(arrayObjectIndexOf(urlList['queue'], "url", url), 1);
    }

    //svc.logger.info("vThreadNumber:%s, NON-Static Processing %d Urls", vThreadNumber, urlCurrentllyProccesed.count, " --- ", BrowserData.name, "queuecount:", urlCurrentllyProccesed.queue);
    if (err) {
        //svc.logger.error('vThreadNumber:%s,Error:%s', vThreadNumber, JSON.stringify(err));
    }


    // do we need to handle more nonstatic url pending in Q?
    if (urlList['queue'].length > 0) {
        // getting the next URL from the queue array
        var urlItem = urlList['queue'].shift();
        //svc.logger.info("vThreadNumber:%s,Removing %s from Static Q", vThreadNumber, urlItem.request.url);
        //urlList['idx']++;
        urlCurrentllyProccesed.count = urlCurrentllyProccesed.count + 1;
        urlCurrentllyProccesed.total = urlCurrentllyProccesed.total + 1;
        testNonStaticUrlItem(vThreadNumber, urlList, svc, urlItem.request.url, urlItem, urlCurrentllyProccesed, nonStaticCallback, StaticCallback, done, BrowserData, collectedCookies, Parameters, urlOverrides);
    }
    else {
        // testing the next Url
        //if ((urlList['idx'] + urlList['queue'].length ) < urlList['len']) {
        if ((urlList['idx']) < urlList['len']) {
            //* test the next url *//
            testUrlItem(vThreadNumber, urlList, svc, urlList[ urlList['idx']], urlCurrentllyProccesed, nonStaticCallback, StaticCallback, done, BrowserData, collectedCookies, Parameters, urlOverrides);
        }
        else {
            urlCurrentllyProccesed.closedThreads++;
            //svc.logger.info("closing vThreadNumber%s", vThreadNumber);
            if ((urlCurrentllyProccesed.count <= 1) && (urlList['queue'].length <= 0) && ((urlCurrentllyProccesed.closedThreads === (urlCurrentllyProccesed.openThreads)))) {
                //svc.logger.info("vThreadNumber:%s,--------------------------------- closing ", vThreadNumber, BrowserData.name);
                //svc.logger.info("vThreadNumber:%s,-------  user %d visited %d urls, %d requests, others were skipped ", vThreadNumber, vuser.getVUserId(), urlCurrentllyProccesed.total, urlCurrentllyProccesed.requests);
                //svc.logger.info("vThreadNumber:%s,onNONStaticCallback - urlList['len']:%s,urlCurrentllyProccesed.count:%s, BrowserData.browsersThreads:%s, urlList['queue'].length:%s, urlCurrentllyProccesed.total:%s, urlCurrentllyProccesed.requests:%s, urlCurrentllyProccesed.closedThreads:%s,urlList['idx']:%s,urlCurrentllyProccesed.issuesRequests:%s,urlCurrentllyProccesed.skipped:%s ", vThreadNumber, urlList['len'], urlCurrentllyProccesed.count, BrowserData.browsersThreads, urlList['queue'].length, urlCurrentllyProccesed.total, urlCurrentllyProccesed.requests, urlCurrentllyProccesed.closedThreads, urlList['idx'], urlCurrentllyProccesed.issuesRequests, urlCurrentllyProccesed.skipped);
                //svc.logger.info("vThreadNumber:%s,closing thread and calling done", vThreadNumber, BrowserData.name);
                done(null, null);
            }
            else {
                //svc.logger.info("vThreadNumber:%s,onNONStaticCallback - urlList['len']:%s,urlCurrentllyProccesed.count:%s, BrowserData.browsersThreads:%s, urlList['queue'].length:%s, urlCurrentllyProccesed.total:%s, urlCurrentllyProccesed.requests:%s, urlCurrentllyProccesed.closedThreads:%s,urlList['idx']:%s,urlCurrentllyProccesed.issuesRequests:%s,urlCurrentllyProccesed.skipped:%s ", vThreadNumber, urlList['len'], urlCurrentllyProccesed.count, BrowserData.browsersThreads, urlList['queue'].length, urlCurrentllyProccesed.total, urlCurrentllyProccesed.requests, urlCurrentllyProccesed.closedThreads, urlList['idx'], urlCurrentllyProccesed.issuesRequests, urlCurrentllyProccesed.skipped);

            }
        }

    }
}

function checkIsStaticMimeTypes(mimeType) {
    // checking some known static mimeType
    if (mimeType === "image/gif") return true;
    if (mimeType === "text/css") return true;
    if (mimeType === "image/png") return true;
    if (mimeType === "application/javascript") return true;
    if (mimeType === "application/font-woff") return true;
    if (mimeType === "image/svg+xml") return true;
    if (mimeType === "application/x-javascript") return true;
    if (mimeType === "application/x-font-ttf") return true;
    if (mimeType === "image/jpeg") return true;

    return false;
}

function testStaticUrlItem(vThreadNumber, urlList, svc, urlItem, urlCurrentllyProccesed, nonStaticCallback, StaticCallback, done, BrowserData, collectedCookies, Parameters, urlOverrides) {
    var reqOpts;
    StaticCallback = StaticCallback || function () {
    };
    urlItem = urlItem || {};
    /* setting up request options, coping related request options from recorded har */
    reqOpts = {
        url: urlItem.request.url,
        proxy: proxy,
        method: urlItem.request.method,
        headers: {
            'User-Agent': BrowserData.userAgent
        },
    };

    // adding post data if needed
    if (undefined !== urlItem.request.postData)
        reqOpts.body = urlItem.request.postData.text;

    // adding all headrs but User-Agent and Cookies
    for (var i = 0, len = urlItem.request.headers.length; i < len; i++) {
        if (((undefined !== urlItem.request.headers[i].name)) && ((urlItem.request.headers[i].name === "Accept-Encoding"))) {
            if (urlItem.request.headers[i].value.indexOf("gzip")>=0)
            {
                reqOpts.gzip = true;
            }
        }
        if (((undefined !== urlItem.request.headers[i].name)) && (urlItem.request.headers[i].name !== "User-Agent") && ((urlItem.request.headers[i].name !== "Cookie"))) {
            urlItem.request.headers[i].name = urlItem.request.headers[i].name.replace(/:/g, '_');
            reqOpts.headers[urlItem.request.headers[i].name] = urlItem.request.headers[i].value;
        }
        else if (((undefined !== urlItem.request.headers[i].name)) && ((urlItem.request.headers[i].name === "Cookie"))) {

            inspectAndAddCookies(svc, urlLists, reqOpts, urlItem, i, collectedCookies, Parameters, urlOverrides);
        }
    }

    // if URL is not in blacklist
    if (checkBlackList(urlItem.request.url)) {
        urlCurrentllyProccesed.requests = urlCurrentllyProccesed.requests + 1;
        //svc.logger.info('vThreadNumber%s: Testing URL %s:%s %s', vThreadNumber, reqOpts.method, reqOpts.url);

        svc.request(reqOpts, function (err, res, body) {
            urlCurrentllyProccesed.issuesRequests++;
            if (err) {
                //svc.logger.error('vThreadNumber%s:request error %s', vThreadNumber, JSON.stringify(err));
            } else if (undefined !== res) {
                //svc.logger.info("vThreadNumber%s:checking request...%s", vThreadNumber, reqOpts.url);
                if (urlItem.response.status === res.statusCode) {
                    //svc.logger.info("vThreadNumber%s:status Response comparison ok", vThreadNumber);
                }
                else if (((urlItem.response.status === 304)|| (urlItem.response.status === 302))&& (res.statusCode === 200)) {
                    //svc.logger.info("vThreadNumber:%s,status Response comparison ok", vThreadNumber);
                }
                else {
                    //svc.logger.error("vThreadNumber%s:status Response is not equal to original recording\n Original:%s\nNew:%s", vThreadNumber, urlItem.response.status, JSON.stringify(res.statusCode));
                }

                if (undefined !== res.headers) {
                    if (urlItem.response.headers['mimeType'] === res.headers['mimeType']) {
                        //svc.logger.info("vThreadNumber%s:mimeType Response comparison ok", vThreadNumber);
                    }
                    else {
                        //svc.logger.error("vThreadNumber%s:mimeType Response is not equal to original recording\n Original:%s\nNew:%s", vThreadNumber, urlItem.response.headers['mimeType'], res.headers['mimeType']);
                    }
                }

                //svc.logger.info('vThreadNumber%s:After Testing URL %s:%s --> %s', vThreadNumber, reqOpts.method, reqOpts.url, res.statusCode);
            }
            StaticCallback(vThreadNumber, urlList, svc, urlCurrentllyProccesed, nonStaticCallback, StaticCallback, done, BrowserData, collectedCookies, Parameters, urlOverrides);
        });
    }
    else {
        //svc.logger.info('vThreadNumber%s:Skipping URL %s', vThreadNumber, urlItem.request.url);
        urlCurrentllyProccesed.skipped++;
        StaticCallback(vThreadNumber, urlList, svc, urlCurrentllyProccesed, nonStaticCallback, StaticCallback, done, BrowserData, collectedCookies, Parameters, urlOverrides);
    }
}

function inspectAndAddCookies(svc, urlLists, reqOpts, urlItem, i, collectedCookies, Parameters, urlOverrides) {
    for (var cookieIdx = 0; cookieIdx < collectedCookies.length; cookieIdx++) {
        var cookieDomain = cookieParser.parse(collectedCookies[cookieIdx][0]).Domain;
        if ((undefined === cookieDomain) || (("" === cookieDomain)) || (reqOpts.url.indexOf(cookieDomain) >= 0)) {
            if (undefined !== reqOpts.headers[urlItem.request.headers[i].name])
                reqOpts.headers[urlItem.request.headers[i].name] = reqOpts.headers[urlItem.request.headers[i].name] + collectedCookies[cookieIdx][0].split(";")[0] + ";"
            else
                reqOpts.headers[urlItem.request.headers[i].name] = collectedCookies[cookieIdx][0].split(";")[0] + ";"

            //svc.logger.info("Adding cookie:%s", reqOpts.headers[urlItem.request.headers[i].name]);
        }
    }
}

function onStaticCallback(vThreadNumber, urlList, svc, urlCurrentllyProccesed, nonStaticCallback, StaticCallback, done, BrowserData, collectedCookies, Parameters, urlOverrides, err) {
    urlCurrentllyProccesed.count = urlCurrentllyProccesed.count - 1;
    if (err) {
        svc.logger.error('Error:%s', JSON.stringify(err));
    }

    //svc.logger.info("vThreadNumber:%s, Static Processing %d Urls", vThreadNumber, urlCurrentllyProccesed.count, " --- ", BrowserData.name, "queuecount:", urlCurrentllyProccesed.queue);

    // testing the next Url
    //if ((urlList['idx'] + urlList['queue'].length ) < urlList['len']) {
    if ((urlList['idx']) < urlList['len']) {

        //* test the next url *//
        testUrlItem(vThreadNumber, urlList, svc, urlList[ urlList['idx']], urlCurrentllyProccesed, nonStaticCallback, StaticCallback, done, BrowserData, collectedCookies, Parameters, urlOverrides);
    }
    else {
        urlCurrentllyProccesed.closedThreads++;
        svc.logger.info("closing vThreadNumber%s", vThreadNumber);
        if ((urlCurrentllyProccesed.count <= 1) && (urlList['queue'].length <= 0) && ((urlCurrentllyProccesed.closedThreads === (urlCurrentllyProccesed.openThreads)))) {
            //svc.logger.info("vThreadNumber:%s,--------------------------------- closing ", vThreadNumber, BrowserData.name);
            //svc.logger.info("vThreadNumber:%s,-------  user %d visited %d urls, %d requests, others were skipped ", vThreadNumber, vuser.getVUserId(), urlCurrentllyProccesed.total, urlCurrentllyProccesed.requests);
            //svc.logger.info("vThreadNumber:%s,onStaticCallback - urlList['len']:%s,urlCurrentllyProccesed.count:%s, BrowserData.browsersThreads:%s, urlList['queue'].length:%s, urlCurrentllyProccesed.total:%s, urlCurrentllyProccesed.requests:%s, urlCurrentllyProccesed.closedThreads:%s,urlList['idx']:%s,urlCurrentllyProccesed.issuesRequests:%s,urlCurrentllyProccesed.skipped:%s ", vThreadNumber, urlList['len'], urlCurrentllyProccesed.count, BrowserData.browsersThreads, urlList['queue'].length, urlCurrentllyProccesed.total, urlCurrentllyProccesed.requests, urlCurrentllyProccesed.closedThreads, urlList['idx'], urlCurrentllyProccesed.issuesRequests, urlCurrentllyProccesed.skipped);
            //svc.logger.info("vThreadNumber:%s,closing thread and calling done", vThreadNumber, BrowserData.name);
            done(null, null);
        }
        else {
            //svc.logger.info("vThreadNumber:%s,onNONStaticCallback - urlList['len']:%s,urlCurrentllyProccesed.count:%s, BrowserData.browsersThreads:%s, urlList['queue'].length:%s, urlCurrentllyProccesed.total:%s, urlCurrentllyProccesed.requests:%s, urlCurrentllyProccesed.closedThreads:%s,urlList['idx']:%s,urlCurrentllyProccesed.issuesRequests:%s,urlCurrentllyProccesed.skipped:%s ", vThreadNumber, urlList['len'], urlCurrentllyProccesed.count, BrowserData.browsersThreads, urlList['queue'].length, urlCurrentllyProccesed.total, urlCurrentllyProccesed.requests, urlCurrentllyProccesed.closedThreads, urlList['idx'], urlCurrentllyProccesed.issuesRequests, urlCurrentllyProccesed.skipped);

        }
    }

}

function testHost(urlList, svc, done, BrowserData, collectedCookies, Parameters, urlOverrides, urlCurrentllyProccesed) {
    for (var browsersThreadsidx = 0; browsersThreadsidx < BrowserData.browsersThreads; browsersThreadsidx++) {
        if ((undefined !== urlList[ urlList['idx']]) && ((urlList['idx'] + urlList['queue'].length) < urlList['len'])) {
            //svc.logger.info("INIT THREAD _________________________________%d", browsersThreadsidx);
            urlCurrentllyProccesed.openThreads++;
            testUrlItem(browsersThreadsidx, urlList, svc, urlList[ urlList['idx']], urlCurrentllyProccesed, onNonStaticCallback, onStaticCallback, done, BrowserData, collectedCookies, Parameters, urlOverrides);
        }

    }
}

function testHARFIle(svc, filename, done, BrowserData, collectedCookies, Parameters, urlOverrides) {
    // preparing list for testing
    urlList = {};
    urlLists = {};
    hosts = [];
    urlCurrentllyProccesed = {count: 0, total: 0, requests: 0, queue: 0, issuesRequests: 0, closedThreads: 0, openThreads:0, skipped: 0};
    // load lists of Urls from HAR file
    loadHarFile(svc, filename, urlList, urlLists, hosts);

    if (urlList.length <= 0) {
        svc.logger.error('An invalid Url list.');
        done(null, null);
        return;
    }
    else {
        //svc.logger.info('Test Url list length is %d', urlList['len']);
    }

    //svc.logger.info("--------------------------------- starting ", BrowserData, " w");

    // code fore testing all host with 1 pull of concurrent connections (for example if authentication is cross hosts )
    //svc.logger.info("****************** host: ", 'All', 'len:', urlLists['All']['len'], '*********************');
    testHost(urlLists['All'], svc, done, BrowserData, collectedCookies, Parameters, urlOverrides, urlCurrentllyProccesed);

}

exports.testHARFIle = function (svc, filename, done, BrowserData, oblackListHosts, ovuser, collectedCookies, Parameters, urlOverrides) {
    vuser = ovuser;
    blackListHosts = oblackListHosts;

    testHARFIle(svc, filename, done, BrowserData, collectedCookies, Parameters, urlOverrides);
};
