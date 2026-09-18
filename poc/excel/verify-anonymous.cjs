'use strict';
const ExcelJS = require('./vendor/exceljs.min.js');
const core = require('./core.js');
const scenarios = require('./scenarios.js');
const master = require('./master.json');
scenarios.run(ExcelJS, core, master).then(result => {
  console.log(JSON.stringify({passed:true,assertions:result.passed,source:'public master + synthetic answers'}));
}).catch(error => {
  console.error(JSON.stringify({passed:false,name:error.name,message:error.message}));
  process.exitCode=1;
});
