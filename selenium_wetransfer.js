//https://dxr.mozilla.org/mozilla-release/source/modules/libpref/init/all.js
const {Builder, By, Key, until} = require('selenium-webdriver');
const fs = require('fs');
const path = require('path'); 
const firefox = require('selenium-webdriver/firefox');
const EventEmitter = require('events');

const allowed_file_types = ['rar', 'mp4'];

async function example(reference, download_path) 
{	
	let curtime = JSON.stringify(new Date()).replace(/[^\d]*/g, "");
	let crc = crc32(reference);
	let foldname = (download_path) ? download_path : __dirname;
	foldname = foldname + "\\" + crc + "_" + curtime;
	
	let go = {driver: null, foldname: foldname,  
		allowed_file_types:allowed_file_types,  
		is_download_started:false, is_download_complete:false, 
		approx_fsize:null, fname: null, ftype:null, error:null 
	};
    //? MAIN FUNCTIONS CHAIN BELOW
	try {
		//? STEP 1. driver object used to manage firefox browser
		go.driver = await start_download(reference, go);
		
		//? if the driver object is not empty it means it was created
		if (go.driver) {
			go.emitter = new EventEmitter();
			go.emitter.once('check_browser_closed', ()=>{
				console.log("Emitter event 'check_browser_closed'");
				//return new
				isBrowserClosed(go.driver).then(res=>{
					go.emitter.emit('end_up', 'end up, because file size is not increasing');
					//console.log("RESOLVED:",res);
					clearInterval(go.tracking);
					clearInterval(go.check_fsize);
					throw ("BROWSER IS NOT CLOSED!!!", res);
				}).catch(ex=>{
					go.emitter.emit('end_up', 'end up, because browser is closed');
					//console.log("REJECTED:",ex);
					clearInterval(go.tracking);
                    clearInterval(go.check_fsize);
					throw ("BROWSER IS CLOSED!!!", ex);
				});
				
			});
			
			//console.log(JSON.stringify(go.driver));
			//? if this process called by parent process
			if (process.send) {
				let msg = {
					type: "we_file_details",
					data: {fname:go.fname, ftype: go.ftype, approx_fsize:go.approx_fsize}
				};
				process.send(msg);
			}
		}
		//? STEP 2. at this time download is probably has started, because file appeared in directory
		let fname_from_folder = await wait_file_appears_in_folder(go);
		if (go.fname) {
			if (fname_from_folder != go.fname) {
				//? most likely this situation is impossible
				console.log("WETRANSFER CHILD PROCESS WARNING: Filename from browser don't match with filename appeared in directory:");
				console.log("fname_from_folder=", fname_from_folder, ", fname_from_browser=", go.fname);
			}
        }
        track_file_size_increasing(go);
		//? STEP 3. We wait until the file is fully downloaded
		//? Also, inside this function, we will report the percentage of file download to the parent process
        let result = await wait_file_to_load(go);
        //? STEP 4. Close Browser and return to parent process
        clearInterval(go.tracking);
        go.driver.quit();
        return result ;
	}
	catch(er) {
        clearInterval(go.tracking);
        clearInterval(go.check_fsize);
		if (process.send) {
			let msg = {
				type: "we_error",
				data: er
			};
            process.send(msg);
            throw er;
		}
        if ( (typeof (er) != 'undefined') && (er !== null) ) {  
		  console.log("selenium: EXAMPLE: er=", er);
        }
		else { console.log("selenium: EXAMPLE: er2=", er); }
	}
};

async function start_download(reference, go) 
{
    //console.log("START 1: ", new Date().getTime());
	var options = new firefox.Options();
	//options.addArguments("--no-sandbox");
	//options.setPreference('browser.download.manager.showWhenStarting', false);
	//options.setPreference('browser.download.manager.showAlertOnComplete', true);
	//options.setPreference("browser.helperApps.neverAsk.openFile", "");
	
    //? All 3 Options Below are necessary to save file into specific directory
	options.setPreference("browser.download.folderList",2);
	console.log('go.foldname=',go.foldname);
    options.setPreference("browser.download.dir", go.foldname);
    options.setPreference("browser.download.useDownloadDir", true);
    //? Automatically saving without asking dialog
	options.setPreference('browser.helperApps.neverAsk.saveToDisk', 'binary/octet-stream, video/mp4, application/zip');
	
  // open firefox browser
  let driver = await new Builder().forBrowser('firefox')
  .setFirefoxOptions(options)
  .build();
  
  try {
    await driver.get(reference);
	//----PRESS AGREE BUTTON-------
    await driver.findElement(By.className("welcome__agree")).click();
    await driver.sleep(1000);
	//----LOOK FILE SIZE-------
	try {
		let fsize = await driver.findElement(By.css(".file-system-entry__detail:nth-child(1)")).getText();
        go.approx_fsize = parse_wetransfer_fsize(fsize);
		console.log("APPROX FSIZE =", go.approx_fsize);
	} catch(er){ console.log("ERR1:", (er ? er.name : er) ); }
	//----LOOK FILE TYPE-------
	try {
		go.ftype = await driver.findElement(By.css(".file-system-entry__detail:nth-child(2)")).getText();
		console.log("FTYPE =", go.ftype);
	} catch(er){ console.log("ERR2:", (er ? er.name : er) ); }
	//----LOOK FILE NAME-------
	try {
		go.fname = await driver.findElement(By.className("file-system-entry__title")).getText();
		console.log("FNAME =", go.fname);
	} catch(er){ console.log("ERR3:", (er ? er.name : er) ); }
	
	await driver.sleep(500);
	//----PRESS DOWNLOAD BUTTON-------
    await driver.wait(until.elementLocated(By.className('transfer__button')), 5000).click();
    go.is_download_started = true;
	await driver.sleep(500);
    //console.log("END 1: ", new Date().getTime());
    return driver;
  }
    catch(er) {
		console.log("ERR4:", (er ? er.name : er) );
        go.error = er;
        throw er;
    }
    //finally { return driver; }
};

function parse_wetransfer_fsize(fsize)
{
    let result_size;
    let parsed_arr = try_split_fsize(fsize);
    if (Array.isArray(parsed_arr)) {
        switch (parsed_arr[1]){
            case "GB":
            case "GiB":
                result_size = Number(parsed_arr[0]) * 1000000000;
                break;
            case "MB":
            case "MiB":
                result_size = Number(parsed_arr[0]) * 1000000;
                break;
            case "KB":
            case "KiB":
                result_size = Number(parsed_arr[0]) * 1000;
                break;
            default:
                break;
        }
    }
    return result_size;
    
    function try_split_fsize(str){
        var re_nums = /[\d]+/g;
        var re_notnums = /[^\d]+/g;
        let is_match = false;
        let arr;
        if (typeof(str) == 'string' ) {
            arr = str.split(' ');
            if (arr.length == 2) {
                if (arr[0].search(re_nums) != -1) {
                    if (arr[1].search(re_notnums) != -1) {
                        is_match = true;
                    }
                }
            }
        }
        if (is_match) return arr;
        else return null;
    }
}

function wait_file_appears_in_folder(go)
{
	return new Promise((resolve, reject)=>{
		const TIMES = 10;
		let times_count = 0;
        let filename;
		const INTERVAL = 3000;
		go.emitter.once('end_up', (signal)=>{reject("wait_file_appears_in_folder():"+signal)});
        
        var look = function(foldname, trial, t_out){
			console.log("selenium: look dir:", trial);
            fs.readdir(foldname, (err, list) => {
                //? if dir is not exist or empty dir
                if ((err)|| ((list)&&(list.length==0))) {
                    if (trial > 0) {
                        setTimeout(()=>{
                            look(foldname, trial-1, t_out)
                        }, t_out)
                    }
                    else { reject("wait_file_appears_in_folder(): TIMEOUT"); } 
                }
                else {
                    if ((list)&&(list.length > 0)) {
                        list.forEach(file=>{
                            for (let i in go.allowed_file_types) {
                                //? if file type 'rar' or 'mp4'
                                if (file.endsWith(go.allowed_file_types[i])) filename = file;
                            }
                        });
                        resolve(filename);
                    }
                }
            });
        }
		look(go.foldname, TIMES, INTERVAL);   
	});
}

function track_file_size_increasing(go) {
    //return new Promise((resolve, reject)=>{
        let fname_without_ext = path.basename(go.fname);
        let filestat = go.foldname + "\\" + fname_without_ext + '.part';
        //console.log("selenium.js: wait_file_to_load(): filestat =",filestat);
        const INTERVAL = 5000;
        let timelapse = 0;
        let approx_fsize = go.approx_fsize || 0; 
        const TIME_LIMIT = (approx_fsize > 0) ? (Math.round(approx_fsize/5)) : 120000000;
        let cur_fsize = 0;
        let trying_download_froze = 5;

        go.tracking = setInterval(()=>{
            fs.stat(filestat, (err, stats)=>{
                if (err) { 
					//console.log('fail to read file ', filestat) 
				}
                else {
                    //console.log("tracking: File size =", stats.size);
                    if (stats.size > cur_fsize) {
                        cur_fsize = stats.size;
                        trying_download_froze = 5;
                        if (process.send) {
                            let msg = {
                                type: "we_size_inc",
                                data: cur_fsize
                            };
                            process.send(msg);
                        }
                    }
					else if(stats.size == cur_fsize){
                        //?it looks like file not donwloading more...
                        if (trying_download_froze > 0) trying_download_froze--;
                        else go.emitter.emit('check_browser_closed');
					}
                }
            });
        }, INTERVAL)
    //});
}

function isBrowserClosed(WebDriver){
	return new Promise((resolve, reject)=>{
        try{
            WebDriver.getTitle().then(res=>{
				resolve(res);
			}).catch(ex=>{ reject(ex); });
        }
		catch(UnreachableBrowserException){
			reject(UnreachableBrowserException);
        }
		//finally {resolve("FINALLY ...");}
	});
}

function wait_file_to_load(go)
{
    return new Promise((resolve, reject)=>{
		go.emitter.once('end_up', (signal)=>{reject("wait_file_to_load():"+signal)});
        let file = go.foldname + "\\" + go.fname;
		console.log("selenium.js: wait_file_to_load(): file=",file);
        const INTERVAL = 5000;
        let timelapse = 0;
        let approx_fsize = go.approx_fsize || 0; 
        const TIME_LIMIT = (approx_fsize > 0) ? (Math.round(approx_fsize/5)) : 120000000;
        console.log("TIME_LIMIT=",TIME_LIMIT); 
        go.check_fsize = setInterval(()=>{
            fs.stat(file, (err, stats)=>{
                if (err) { reject(err); }
                else {
                    //console.log(stats.isDirectory());
                    //console.log("check_fsize: File size =", stats.size);           
                    if (stats.size > 0) {
                        clearInterval(go.check_fsize);
                        resolve(file);
                    }
                    else {
                        if (timelapse > TIME_LIMIT) {
                            clearInterval(go.check_fsize);
                            reject(file);
                        }
                        else {
                            timelapse = timelapse + INTERVAL;
                        }
                    }
                }
            });
        }, INTERVAL);
    });
}


//===============================================

function crc32(r)
{
    for(var a,o=[],c=0;c<256;c++){
        a=c;
        for(var f=0;f<8;f++)a=1&a?3988292384^a>>>1:a>>>1;o[c]=a
    }
    for(var n=-1,t=0;t<r.length;t++)n=n>>>8^o[255&(n^r.charCodeAt(t))];
    return ((-1^n)>>>0).toString(16).toUpperCase();
}

module.exports = {example}