/*
 har-tester test is meant to simulate load on server based on har(HTTP Archive format) files, that can be created using developers tools of commonly used browsers.

 Current implementation take into consideration the following:
 - Url
 - Method
 - User Agent
 Current implementation simulate several concurrent connections per host or for 'All' hosts -  depends on configuration, in a similar manner to common browsers.
 Browsers are randomly chosen, the 'all' option is added to support flows that are cross hosts (for example authentication host)

 Current implementation support black list - add block hosts to black-list.json
 */

exports = module.exports = function (vuser) {
    var harHelper = require('./har-helper.js');
    var path = require('path');
    var fs = require("fs");
    var async = require("async");

    // setting defaults
    var vuserId;
    var BrowserData = {name: "", userAgent: ""};
    var blackListHosts = {blackListHosts:{}};
    var CollectedCookies = {collectedCookies:[]};
    var Parameters = {parameters:{}};

    var urlOverrides =
            [
                {
                    url: "https://SomeSite.com/initalPage",
                    beforeRequest: function (svc, urlItem, collectedCookies, Parameters,reqOpts) {
                        if ((undefined !== urlItem) && (undefined !== urlItem.request.url)) {
                            svc.logger.info("beforeRequest-->", urlItem.request.url);
                        }
                    },
                    afterRequest: function (svc, urlItem, collectedCookies, Parameters, res, body) {
                        if ((undefined !== urlItem) && (undefined !== urlItem.request.url)) {
                            svc.logger.info("afterRequest:", urlItem.request.url);
                            if (undefined!==body.body)
                            {
                                //grab authenticity_token (for csrf form submission used in diffrent sites
                                if (body.body.indexOf("authenticity_token")>=0)
                                {
                                    svc.logger.info("body:",body.body.substr(body.body.indexOf("authenticity_token")+56,44));
                                    Parameters["authenticity_token"] = body.body.substr(body.body.indexOf("authenticity_token")+56,44)
                                }
                            }
                        }
                    }
                },
                {
                    url: "https://SomeOath.com/login", //some oath authentication site/server
                    beforeRequest: function (svc, urlItem, collectedCookies, Parameters,reqOpts) {
                        if ((undefined !== urlItem) && (undefined !== urlItem.request.url)) {
                            svc.logger.info("beforeRequest-->", urlItem.request.url);

                            reqOpts.body =  "_registrationSiteId=prgrsvp2&emailAddress=" + encodeURIComponent(Parameters["emailAddress"]) + "&password="+ encodeURIComponent(Parameters["password"]) +"&_rememberMe=false&_locale=en_US&client_id=mU5e7Ox2xbYZW6cHgW5GhzNqeiWcHcAc&ux_id=com.somesite.program.rsvp&transactionId=937dd2c1-c7e3-4237-8ef7-082afd088d87&_backendEnvironment=ecn54";

                        }
                    },
                    afterRequest: function (svc, urlItem, collectedCookies, Parameters, res, body) {
                        if ((undefined !== urlItem) && (undefined !== urlItem.request.url)) {
                            svc.logger.info("afterRequest:", urlItem.request.url);
                            if (undefined!==body.body)
                            {
                                if (body.body.indexOf('access_token":"')>=0)
                                {
                                    Parameters["user_Baccess_token"] = body.body.substr((15+body.body.indexOf('access_token":"')),28);
                                    svc.logger.info("user_Baccess_token:",Parameters["user_Baccess_token"]);
                                }
                                if (body.body.indexOf('uuid":"')>=0)
                                {
                                    Parameters["user_uuid"] = body.body.substr((7+body.body.indexOf('uuid":"')),7);
                                    svc.logger.info("user_uuid:", Parameters["user_uuid"]);
                                }
                            }
                        }
                    }
                },
                {
                    url: "https://SomeSite.com/users",
                    beforeRequest: function (svc, urlItem, collectedCookies, Parameters,reqOpts) {
                        if ((undefined !== urlItem) && (undefined !== urlItem.request.url)) {
                            svc.logger.info("beforeRequest-->", urlItem.request.url);
                            reqOpts.body =  "authenticity_token="+ encodeURIComponent(Parameters["authenticity_token"]) +"&user%5Buuid%5D="+ encodeURIComponent(Parameters["user_uuid"]) +"&user%5Baccess_token%5D="+ encodeURIComponent(Parameters["user_Baccess_token"]) +"";
                            svc.logger.info("reqOpts",JSON.stringify(reqOpts));
                        }
                    },
                    afterRequest: function (svc, urlItem, collectedCookies, Parameters, res, body) {
                        if ((undefined !== urlItem) && (undefined !== urlItem.request.url)) {
                            svc.logger.info("afterRequest:", urlItem.request.url);
                            if (undefined!==body.body)
                            {
                                svc.logger.info("body:",body.body);
                            }
                        }
                    }
                }
            ]
        ;

    vuserId = vuser.getVUserId();

    /* init action */
    vuser.init('Vuser init action', function (svc, done) {
        svc.logger.info('Vuser %s init', vuserId);

        // setting user name and password, values can be taken from separate file/can be randomized
        Parameters.parameters["emailAddress"] = "eyal.fingold@hp.com";
        Parameters.parameters["password"] = "Nike0123";
        // starting requests in parallel same as browsers actually behave
        var browsersInfo = [
            {browser: "Firefox 31.0", threadsPerDomain: 6, UserAgent: "Mozilla/5.0 (Windows NT 5.1; rv:31.0) Gecko/20100101 Firefox/31.0"},
            {browser: "Opera 12.x", threadsPerDomain: 6, UserAgent: "Mozilla/5.0 (Windows NT 6.0; rv:2.0) Gecko/20100101 Firefox/4.0 Opera 12.14"},
            {browser: "Safari 8.0", threadsPerDomain: 6, UserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10) AppleWebKit/600.1.25 (KHTML, like Gecko) Version/8.0 Safari/600.1.25"},
            {browser: "IE 10", threadsPerDomain: 8, UserAgent: "Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; Trident/6.0"},
            {browser: "IE 11", threadsPerDomain: 13, UserAgent: "Mozilla/5.0 (Windows NT 6.3; Trident/7.0; rv:11.0) like Gecko"},
            {browser: "Chrome 37.0", threadsPerDomain: 6, UserAgent: "Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/37.0.2049.0 Safari/537.36"}
        ]
        var chosenBrowserID = Math.floor((Math.random() * (browsersInfo.length - 1)) + 1);
        BrowserData.browsersThreads = browsersInfo[chosenBrowserID]['threadsPerDomain'];
        BrowserData.name = browsersInfo[chosenBrowserID]['browser'];
        BrowserData.userAgent = browsersInfo[chosenBrowserID]['UserAgent'];

        // get all the blacklist hosts
        blackListHostsFile = 'black-list.json';
        var tmpdata = JSON.parse(harHelper.loadFromFile(blackListHostsFile));
        blackListHosts.blackListHosts = tmpdata.blackListHostNames;

        done();
    });

    vuser.action('Vuser main action', function (svc, done) {

        // testHARFIle(svc, 'www.ynet.co.il3 - 31sec load.har', done);
        svc.transaction.start(BrowserData.name);
        var fileNameTotest = "";
        async.series({
                 f1: function (callback) {
                 fileNameTotest = "www.baidu.com.har";
                 svc.transaction.start(fileNameTotest);
                 svc.logger.info(" going to test %s", fileNameTotest);
                 harHelper.testHARFIle(svc, fileNameTotest, callback,BrowserData,blackListHosts.blackListHosts,vuser,CollectedCookies.collectedCookies,Parameters.parameters,urlOverrides);
                 }
                /*,
                 f1T: function(callback)
                 {
                 svc.transaction.thinkTime(fileNameTotest, 1000 * 2, function () {
                 svc.logger.info(" thinkTime %s", fileNameTotest);
                 callback();
                 });
                 },
                 f2: function (callback) {
                 fileNameTotest = "har-files/2-open.har";
                 svc.transaction.start(fileNameTotest);
                 svc.logger.info(" going to test %s", fileNameTotest);
                 harHelper.testHARFIle(svc, fileNameTotest, callback,BrowserData,blackListHosts.blackListHosts,vuser,CollectedCookies.collectedCookies,Parameters.parameters,urlOverrides);
                 },
                 f2T: function(callback)
                 {
                 svc.transaction.thinkTime(fileNameTotest, 1000 * 2, function () {
                 svc.logger.info(" thinkTime %s", fileNameTotest);
                 callback();
                 });
                 },
                 f3: function (callback) {
                 fileNameTotest = "har-files/3-getStarted.har";
                 svc.transaction.start(fileNameTotest);
                 svc.logger.info(" going to test %s", fileNameTotest);
                 harHelper.testHARFIle(svc, fileNameTotest, callback,BrowserData,blackListHosts.blackListHosts,vuser,CollectedCookies.collectedCookies,Parameters.parameters,urlOverrides);
                 },
                 f3T: function(callback)
                 {
                 svc.transaction.thinkTime(fileNameTotest, 1000 * 5, function () {
                 svc.logger.info(" thinkTime %s", fileNameTotest);
                 callback();
                 });
                 },*/


            },
            function (err, results) {
                svc.logger.info('collectedCookies:%s',JSON.stringify(CollectedCookies.collectedCookies));
                svc.logger.info('parameters:%s',JSON.stringify(Parameters.parameters));
                svc.transaction.end(fileNameTotest, svc.transaction.PASS);
                svc.transaction.end(BrowserData.name, svc.transaction.PASS);
                svc.logger.info("going to call Done");
                done();
            });
    });

};
