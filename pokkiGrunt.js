/*global module:false*/
module.exports = function(grunt) {

	// Project configuration.
	grunt.initConfig({
		trac: {
			ticketUrl: 'https://trac-pokki.sea.opencandy.com/ticket/{id}'
		}
	});

	var xml2js = require('xml2js');

	var svn = {

		getUrl: function(dir) {

			dir = dir.split(/[\/\\]/);
			var folder = dir.shift();

			var repo = {
				trunk: this.config.url + 'trunk',
				tags: this.config.url + 'tags',
				smoke: this.config.url + 'tags/smoke'
			};

			if (!repo[folder]) throw new Error('Unsupported SVN folder "' + folder +  '" (use trunk,tags,smoke)');

			return [repo[folder]].concat(dir).join('/') + '/';
		},

		setup: function(options) {
			this.config = options;
		},

		getHeadRevision: function(cb) {
			this.getRevision('trunk',cb);
		},

		getLatestTag: function(cb) {
			this.getRevision('smoke',cb,{verbose:true});
		},

		getTag: function(rev,cb) {
			// TODO:
			this.getRevision('smoke' + (rev ? ('/'+rev) : ''), cb);
		},

		getHistory: function(folder,revFrom,revTo,cb) {

			revTo||(revTo='HEAD');

			folder||(folder='trunk');
			var args = ['log', this.getUrl(folder), '--xml'];
			revFrom && args.push('-r' + revFrom + ':' + revTo);

			this.cmd(args,function(err,res) {
				if (err) return cb(err);
				if (!Array.isArray(res.log.logentry)) res.log.logentry=[res.log.logentry];
				cb(null,res.log.logentry);
			});

		},

		getRevision: function(folder,cb,options) {

			options||(options={});

			folder||(folder='trunk');
			var args = ['log', this.getUrl(folder), '-l 1', '--xml'];
			options.verbose && args.push('-v');
			this.cmd(args ,function(err,res) {
				if (err) return cb(err);
				cb(null,res.log.logentry);
			});
		},

		getInfo: function(cb) {

			this.cmd(['info', '--xml'],function(err,res) {
				if (err) return cb(err);
				cb(null,res.info.entry);
			});
		},

		parse: function(output, cb) {
			if (output.match(/<\?xml\s/)) {
				var parser = new xml2js.Parser({
					mergeAttrs: true,
					explicitArray: false
				});
				parser.parseString(output, function(err,res){
					//console.log('XXXX',res);
					cb(null,res);
				});
			} else {
				var rev = (output.match(/revision (\d+)/)||[])[1];
				cb(null,{revision: rev, message: output.replace(/\n+/g,' ')});
			}
		},

		msgArg: function(msg) {
			// all machine-generated commits' comments start with @
			return '-m@ ' + (msg||'Grunt task');
		},

		copy: function(msg, folderFrom, folderTo, cb) {

			this.cmd(['copy', this.getUrl(folderFrom), this.getUrl(folderTo), this.msgArg(msg), '--parents'], cb);

		},

		commit: function(msg, files, cb) {

			var self = this;

			// delay to avoid concurrency on locked SVN files.
			setTimeout(function() {
				self.cmd(['commit', self.msgArg(msg)].concat(files), cb);
			}, 2000);

		},

		cmd: function(args,cb) {

			var self = this;
			this.config||(this.config={});

			//args = args.concat(['--trust-server-cert']); //requires --non-interactive
			args = args.concat([]); //copy
			if (this.config.username) args = args.concat(['--username',this.config.username]);
			//if (!this.config.interactive) args.push('--non-interactive');

			//console.log('CMD',args);

			grunt.utils.spawn({
				cmd: 'svn',
				args: args,
				fallback: ''
			}, function(err, result, code) {
				if (err || result.stderr) return cb(err||result.stderr);
				//console.log('SVN OUT',result);
				self.parse(result.stdout, cb);
			});

		}

	};

	var searchFiles = function(pattern, options) {
		options||(options={});
		options.limit||(options.limit=0);

		var toProcess = grunt.file.expandFiles(pattern);
		options.limit && (toProcess = toProcess.slice(0,options.limit));

		return toProcess;
	};

	var updateManifest = function(toProcess, data, options) {
		options||(options={});

		var manifests = [];
		toProcess || (toProcess = searchFiles('**/manifest.template.json', options));
		toProcess.forEach( function(manifest){

			var dest = manifest.replace('.template','');
			manifests.push(dest);
			grunt.log.ok('Updating ' + dest + ' (version ' + data.version + ')');
			grunt.file.copy( manifest, dest, {
				process: function(content) {
					return grunt.template.process(content, data);
				}
			});

		});

		return manifests;
	};

	var V = '0.1.17';

	var logo = function() {
		return [
			'\n __  (\\_',
			'(  \\ ( \') ___',
			' )  \\/_)=(___)  POKKI BUILD SYSTEM',
			' (_(___)_ \\_/   ' + V + '\n'
		].join('\n');
	};

	// Default task.
	//grunt.registerTask('default', 'lint qunit concat min');
	grunt.registerTask('default', 'Help', function(version){
		console.log( logo() );
		grunt.log.ok('USAGE: pokkibld tag:<version>');
		grunt.log.ok('i.e.\npokkibld tag:1.0.8');
	});

	// Tag
	grunt.registerTask('tag', 'Create a tag', function(version){

		console.log( logo() );

		if (!version || !version.match(/^\d+\.\d+\.\d+$/)) {
			grunt.log.error('Invalid version! EXAMPLE: grunt tag:1.0.9');
			return grunt.fail.fatal('...there was nothing we could do, sorry :-(');
		}

		// this task is asynch!
		var taskDone = this.async();
		var conf;

		grunt.utils.async.waterfall([

			function(cb){

				svn.getInfo(function(err,res) {

					if (err) {
						if ((err+'').match(/execvp/)) return cb('Seriously!? you don\'t have SVN command line client?!!!');
						return cb(err);
					}

					var username = res.url.split(/[\/\@]+/)[1];
					var baseUrl = res.url.replace(username+'@','').split(/\//);
					baseUrl = baseUrl.slice(0, baseUrl.indexOf('trunk')).join('/') + '/';

					conf = {
						svn: { //grunt.config.get('svn'),
							url: baseUrl,
							username: username,
							interactive: false
						},
						trac:  grunt.config.get('trac')
					};

					svn.setup(conf.svn);

					console.log(' SVN User: ' + conf.svn.username);
					console.log(' SVN Repo: ' + conf.svn.url);
					console.log('');

					cb();

				});
			},

			function(cb){

				var pokkiType = ({
					'1': 'package',
					'3': 'happ'
				})[searchFiles('**/manifest.template.json').length];

				if (!pokkiType) {
					return cb('You need to create "manifest.template.json" files for every manifest.json');
				}

				grunt.log.ok('Pokki Type: ' + pokkiType);

				var tag = {
					pokkiType: pokkiType,
					createdAt: new Date(),
				};

				svn.getHeadRevision( function(err,rev){
					if (err) return cb(err);
					grunt.log.ok('Current HEAD revision is ' + rev.revision);
					tag.head = parseInt(rev.revision,10);
					cb(err,tag);
				});
			},

			function(tag, cb){
				svn.getLatestTag( function(err,rev){
					if (err) return cb(err);
					grunt.log.ok('Latest TAG revision is ' + rev.revision);
					tag.latestTag = parseInt(rev.revision,10);
					cb(err,tag);
				});
			},

			function(tag, cb){

				var wait = false;
				tag.manifests = {};

				if (tag.pokkiType === 'happ') {
					wait = true;
					// hosted app, check which bundles have changed
					svn.getRevision('trunk/hostedfiles', function(err,rev){
						if (err) return cb(err);
						rev.revision = parseInt(rev.revision,10);
						var manifest = {
							id: 'hostedfiles',
							folder: 'trunk/hostedfiles',
							base: rev.revision,
							bump: rev.revision > tag.latestTag,
							files: searchFiles('hostedfiles' + '/manifest.template.json'),
							bundles: tag.manifests
						};
						try {
							manifest.json = grunt.file.readJSON(manifest.files[0].replace('.template',''));
						} catch(e) {
							manifest.json = {};
						}
						tag.manifests[manifest.id]=manifest;

						svn.getRevision('trunk/pokki', function(err,rev){
							if (err) return cb(err);
							var manifest = {
								id: 'pokki',
								folder: 'trunk/pokki',
								base: rev.revision,
								bump: rev.revision > tag.latestTag,
								files: searchFiles('pokki' + '/manifest.template.json'),
								bundles: tag.manifests
							};
							try {
								manifest.json = grunt.file.readJSON(manifest.files[0].replace('.template',''));
							} catch(e) {
								manifest.json = {};
							}
							tag.manifests[manifest.id]=manifest;
							cb(null,tag);
						});

					});

				}

				svn.getRevision('trunk', function(err,rev){
					var manifest = {
						folder: 'trunk',
						base: rev.revision,
						bump: rev.revision > tag.latestTag,
						files: searchFiles('.' + '/manifest.template.json'),
						bundles: tag.manifests
					};
					try {
						manifest.json = grunt.file.readJSON(manifest.files[0].replace('.template',''));
					} catch(e) {
						manifest.json = {};
					}
					tag.manifests['trunk']=manifest;

					// move to next unless happs
					wait || cb(null,tag);
				});

			},

			function(tag, cb){

				var dummy = tag.manifests['trunk'];
				var dummyFile = dummy.files.slice(0,1);
				dummy.version = version + '.' + 'DUMMY' + (new Date()).getTime();

				dummyFile = updateManifest(dummyFile, dummy);

				svn.commit('testing version number', dummyFile, function(err, rev){
					if (err) return cb(err);

					tag.head = parseInt(rev.revision,10);
					cb(null,tag);
				});

			},

			function(tag, cb){
				tag.version = version + '.' + (tag.head + 1);
				grunt.log.ok('Tag version is ' + tag.version);

				// this first to make sure all versions are up-to-date when updating templates
				Object.keys(tag.manifests).forEach(function(id){
					var manifest = tag.manifests[id];
					manifest.version = manifest.bump ? tag.version : (manifest.json.version||('1.0.0.'+manifest.base));
					grunt.log.ok('Changes found in "' + manifest.folder + '": ' + (manifest.bump ? 'YES' : 'NO') );
				});

				var commitList = [];
				Object.keys(tag.manifests).forEach(function(id){
					var manifest = tag.manifests[id];
					commitList = commitList.concat( updateManifest(manifest.files, manifest) );
				});

				grunt.log.ok('Committing updated manifest.json(s): ' + commitList.length + ' file(s)');
				svn.commit('updating version number to ' + tag.version, commitList, function(err,rev){
					if (err) return cb(err);
					tag.head = rev.revision;
					cb(err,tag);
				});

			},

			function(tag, cb){
				grunt.log.ok('Preparing release notes of v.' + tag.version + '(from rev.' + tag.latestTag + ')');
				svn.getHistory('trunk', tag.latestTag, '', function(err,res){

					if (err) return cb(err);

					if (!Array.isArray(res)) res = [res];

					var comments = [];
					res.forEach(function(log){
						comments = comments.concat( log.msg.split(/[\r\n]+/) );
					});

					var releaseNotes=[];
					var fixedTickets=[];
					comments.forEach(function(comment){
						if (comment.match(/^\s*\*/)) {
							releaseNotes.push( comment.replace(/^\s*\*\s*/,'') );
						}
						if (comment.match(/\#\d+/)) {
							fixedTickets = fixedTickets.concat( comment.match(/\#\d+/g).map( function(id){
									return id.replace(/[^\d]/g,'');
								})
							);
						}

					});
					tag.rawComments = comments;
					tag.fixedTickets = fixedTickets;
					tag.releaseNotes = releaseNotes;

					cb(null,tag);

				});
			},

			function(tag, cb) {

				grunt.log.ok('Creating tag ' + tag.version);

				// store release notes in the tag comments too
				var releaseNotes = tag.releaseNotes.length ? ('- ' + tag.releaseNotes.join('\n- ') + '\n') : '[empty release notes]';
				var fixedTickets = tag.fixedTickets.length ? ('- ' + tag.fixedTickets.map(function(id){return conf.trac.ticketUrl.replace(/\{id\}/,id);}).join('\n- ') + '\n') : '[empty ticket list]';

				grunt.log.ok('Release Notes:\n' + releaseNotes);
				grunt.log.ok('Worked Tickets:\n' + fixedTickets);

				svn.copy('creating tag ' + tag.version + ':\n' + releaseNotes, 'trunk', 'smoke/' + tag.version, cb);


			},

		], function(err, res){

			if (err) {

				if (err.match(/Authentication realm/)) {
					grunt.log.ok( 'Password stored' );
					return taskDone();
				}

				grunt.log.error('Oops! something went wrong...');
				grunt.log.error( '' + err );
				return grunt.fail.fatal('...there was nothing we could do, sorry :-(');
			}
			taskDone();

		});


	});

	// Upgrade framework

};
