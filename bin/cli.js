#!/usr/bin/env node

var path = require('path');

var options = {
	config: path.resolve(__dirname, '../pokkiGrunt.js'),
	base: process.cwd()
};

// Run grunt.
require('grunt').cli(options);
