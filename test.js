const Selenium = require('./selenium_wetransfer.js');

const reference = process.argv[2] || "https://we.tl/t-oOPL90fzI7";
const download_path = process.argv[3] ;

console.log("reference = ", reference );
console.log("download_path = ", download_path );

Selenium.example(reference, download_path).then(res=>{
    console.log(">>>from test.js: RES=",res);	
	if (process.send) { process.send(res); }
}).catch(ex=>{console.log(">>>from test.js: EX=",ex)});