const fs = require('fs');
function getConfig(path){
  let config;
  try{
    path = path || fs.readFileSync(__dirname+'/default_path').toString();
    const crypto = require('crypto');
    let _pass;
    const _config = fs.readFileSync(path+"/lms/config.json");
    if (_config) config = JSON.parse( _config ); 
    if(config.pass){
      const k = fs.readFileSync(path+'/lms/k/k');
      let iv = Buffer.from(config.pass.iv, 'hex');
      let encryptedText = Buffer.from(config.pass.encryptedData, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(k), iv);
      let decrypted = decipher.update(encryptedText);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      config.pass = decrypted.toString();
    }
    return config;
  }
  catch(err){
    console.warn('[LMS] : no config file found in', path, 'fallback to default config', err);
    return {
      port : 9090,
      host : "127.0.0.1"
    }
  }
}





const 	util = require('util'),
		net = require('net'),
		{EventEmitter} = require('events'),
		{networkInterfaces} = require("os");
		
util.inherits(_Connection, EventEmitter);	
util.inherits(LMS_interface, EventEmitter);	
util.inherits(_Player, EventEmitter);	
	
	
process.on('unhandledRejection',function(error,promise){
  console.log('Unhandled rejection',error,promise)
  process.exit(1)
})
	
	
function LMS_interface(){
	this.connections = [];
	this.network = networkInterfaces();
}

LMS_interface.prototype.connect = function(port, address){
	if(!port) throw	new Error("Connect function requires a port")	;
	if(!address) throw new Error("Connect function requires an IP address") ;
	
	let connection = new _Connection(port, address);
	return connection.init()
	.then(	x=>this._configureConnection(connection)	)
	
}
/*
LMS_interface.prototype.getLocalPcPSqueezeliteName = function(){
	const fs = require("fs"),
	path_to_pcp_config = "/usr/local/etc/pcp/pcp.cfg";
	
	return new Promise( (resolve,reject)=>{
		const readFileHandle =(err,data)=>{
			if(err) return reject(err);
			let LocalPcPSqueezeliteName = /NAME="(?<squeezeName>.*?)"/
			.exec(data)
			?.groups
			?.squeezeName;
			if(LocalPcPSqueezeliteName){
				this.LocalPcPSqueezeliteName = LocalPcPSqueezeliteName;
				return resolve(LocalPcPSqueezeliteName);
			}
			return reject(`pcp.cfg not found (should be found in ${path_to_pcp_config} )`);
		},
		request = fs.readFile(path_to_pcp_config, readFileHandle );
	});
}
*/
LMS_interface.prototype._configureConnection = function(connection){
	this.connections.push(connection);
	connection.LMS_interface = this;
	return connection;
}



/*
	Connection ( 1 _Connection object represents 1 LMS instance ) ___________________________________________________
*/

function _Connection(address,port){
	this.port = port;
	this.address = address;
	this.LMS_interface;
	this.buf = null;	// allocated by reference when needed
	this.players = [];
}

_Connection.prototype.printID4Err = function(){
	return `@ ${this.address}:${this.port}`;
}

_Connection.prototype._verifyConnection = function(){
	if( !this._com || this.isDead ) throw new Error("net socket missing in scan step");
};

_Connection.prototype.init = function(){
	return this.connect()
	.then	(	x=>	this.configure()		)
  .catch()
}

_Connection.prototype.connect = function(){ 
	
	const timeoutInSeconds = 1;
	let resolved = false;
	if( this._com ) this._com.destroy();
	return new Promise( (resolve, reject)=>{
		const 	com = net.createConnection(this.port, this.address),
				fail =(neterror)=>{
					com.off("success", success )
					com.destroy();
					reject( new Error(`CONNECTION ERROR : Cannot connect to LMS server ${this.printID4Err()}`) );
				},
				failTimeoutHandler = ()=>{
					if(resolved) return;
					com.destroy();
					reject( new Error(`TIMEOUT ERROR (after ${timeoutInSeconds} seconds) : Cannot connect to LMS server ${this.printID4Err()}`) );
				},
				success = ()=>{
					com.off("error", fail )
					resolved = true;
					this._com = com;
					resolve();
				}
		setTimeout(failTimeoutHandler,timeoutInSeconds*1000);
		com.once("connect", success );	
		com.once("error", fail );
		com.once("end", x=> {
      this.players.forEach( p => p.emit("connectionLost"));
      this.cleanUp();
    } );
		
	});
}

_Connection.prototype.configure = function(){
	this._verifyConnection();
	this._com.on(	"data"	, 	x=>this.handleData(x)	);
	this._com.on(	"error"	, 	x=>this.handleErr(x) 	);
	this._com.on(	"end"	, 	  x=> {  this.isDead = true; this.cleanUp(); }	);
  this._com.on(	"close"	, 	x=> { this.isDead = true;  this.cleanUp(); }	);
	return this;
};



_Connection.prototype.login = async function(config, timeoutInSeconds){
  console.log("login")
	this.write(`login ${config.login} ${config.pass}`+'\n', 3);
	timeoutInSeconds = timeoutInSeconds || 5;
	
	let resolved = false;
  
	
	// what do we do with the response from current lms server (if any)
	return new Promise(	(resolve,reject)=>{	
		this._verifyConnection();
		// no satisfying response (bad scenario)
		const failTimeoutHandler =()=>{	
			this.off("message",responseHandler);
        if(resolved) return;
        resolved = true;
        this.cleanUp();
        reject( new Error(`Timeout (${timeoutInSeconds}) Reached for login`) );	
      
		};
		setTimeout(	failTimeoutHandler, timeoutInSeconds * 1000 ); 
	
		const responseHandler = ( response )=>{
      if(resolved) return;
      resolved = true;
			resolve( true )
		};
		
		this.once("message", responseHandler);
	});
  
  
  
}

_Connection.prototype.write = function(x){
	this._verifyConnection();
	this._com.write(x+'\n')
}

_Connection.prototype.handleData = function(data){
	if(data[data.length-1] !== 0xa){	// end of msg is flagged by EOL, which evaluates to 0xa, here false means we reached the end of the telnet buffer but lms has more stuff to tell
		this.buf = this.buf?Buffer.concat([this.buf, data]):data;
		return;
	}
	this.emit( "message", Buffer.concat( [this.buf, data].filter(x=>x) ).slice(0, -1)  );	// slice to remove EOL
	this.buf = null;
}

_Connection.prototype.handleErr = function(error){
	console.err("[LMS] : error",error);
}

_Connection.prototype.cleanUp = function(){
  
  console.log("cleanUp")
  console.trace()
  
	for(let player of this.players){
		player.removeAllListeners();
	}
	this.removeAllListeners();
	if(this._com){
		this._com.removeAllListeners();
		this._com.destroy();
	}
  
  this.LMS_interface.connections = this.LMS_interface.connections.filter(c => c !== this)
  this.emit("connectionLost");
}

_Connection.prototype.query = function(query,timeoutInSeconds){
	
	timeoutInSeconds = timeoutInSeconds || 1;
	
	let resolved = false;
	
	// console.log("sending message",query )
	this.write(query);
	
	// what do we do with the response from current lms server (if any)
	return new Promise(	(resolve,reject)=>{	
		this._verifyConnection();
		// no satisfying response (bad scenario)
		const failTimeoutHandler =()=>{	
			this.off("message",responseHandler);
			if(!resolved) reject( new Error(`Timeout (${timeoutInSeconds}) Reached for query ${query}`) );	
		};
		setTimeout(	failTimeoutHandler, timeoutInSeconds * 1000 ); 
	
		const responseHandler = ( response )=>{
			const preprocessed = this.preprocessQueryResponse(query,response) ;
			if( ! preprocessed ) return;
			resolved = true;
			this.off("message",responseHandler);
			resolve( preprocessed )
		};
		
		this.on("message", responseHandler);
	});
}

_Connection.prototype.preprocessQueryResponse = function( query,response ){
	
	// This subroutine exists to make sure a message is a response to a specific query.	
	// A LMS telnet CLI response starts by repeating the initial query.
	// To safecheck the data, we have to ensure the response matches the query we just made
	// LMS CLI response are URIencoded by word, 
	// so to perform this check we need to build a regexp that follows the same encoding rule
	
	const query_sanitized_for_regex = query
	.replace(/\s\?$/,"")									//	remove last ' ?' for non-extended queries
	.split(" ")												//	split query by word
	.map(	x=>encodeURIComponent(x)	)					//	URIencode each word
	.join(" ")												//	join back to get a 'by word' URIencoded string
	.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");					//	escape all that for safe regex testing 
	
	const parsed_by_query = new RegExp(`(?<queryValidation>${query_sanitized_for_regex})\\s(?<queryResponse>.*)`)
	.exec(response);
	if( ! parsed_by_query?.groups?.queryValidation) return false;	// if query has not been found in response, ignore the message
	return parsed_by_query?.groups?.queryResponse					// else return queryResponse (response with the original query stripped)
};

_Connection.prototype.getPlayers = function(){
	return this.query("players - ") // The trailing empty space needs to stay
	.then( response=>{
		//const all_players_info = response.split(" ").map(decodeURIComponent),
		const all_data = response.split(encodeURIComponent("playerindex:")),
		raw_player_count = all_data.shift(),
		players_data = all_data;

		for( let player_info of players_data ){
			this.players.push(  new _Player(player_info, this) )
		}
		return this.players;
	})
};

/*
	Player ___________________________________________________
*/

function _Player(player_info, connection){
	
	
	this.serverData = this.parseStatusResponse(player_info); // not parsing nor validating anything beyond this point is kinda risky
	this.connection = connection;
	
	this.isLocal = this._checkIsLocal();
	this.id = this.serverData.playerid;
	this.name = this.serverData.name;
	this.playerData = {};
  
  this.state = "stop";
  this.formatedMainString = "";
  this.watchingIdle = false;
	this.iddle = false;
	this._iddleTimeout = null;
	this.iddletime = 900;
	
	//this._subscription = null;
}


_Player.prototype.subscribe = function(refreshRate){
	
	refreshRate = refreshRate || 1;
	const query = `${this.id} status - 1 tags:aCJjKTolrx subscribe:${refreshRate}`;
	
	return this.connection.query(query)
	.then(response=>{
		this.updateStatus(this.parseStatusResponse(response));
		// keep listening to follow up messages
		
		const followUpHandler = msg =>{
			const preprocessed = this.connection.preprocessQueryResponse(query,msg);
			if(!preprocessed) return;
			const newStatus = this.parseStatusResponse(preprocessed);
			this.updateStatus(newStatus);
		};
		
		this.connection.on("message", followUpHandler);
		this._subscribeHandler = followUpHandler; 
	
		
		return;
	})
}

_Player.prototype.unSubscribe = function(force){
	if( !this._subscribeHandler && !force) return Promise.resolve(true);
	const query = `${this.id} status - 1 tags:aCJjKTolrx subscribe:-`;
	return this.connection.query(query)
	.then(response=>{
		if( this._subscribeHandler )  this.connection.off("message", this._subscribeHandler);
		return true;
	})
}

_Player.prototype.parseStatusResponse = function( rawmessage_string ){
	
	const ignored_keys = ["remoteMeta"],
	message = rawmessage_string.split(" ").map(decodeURIComponent),
	parsed = {};
	
	message.map(x=>{
		let parser = /(?<key>.*?):(?<value>.*)/.exec(x);
		if(! parser?.groups?.key || ignored_keys.includes(parser?.groups?.key) ) return;
		parsed[parser.groups.key] = parser.groups?.value;
	});
	return parsed;
};

_Player.prototype.updateStatus = function(newStatus){
	
	const oldkeys = Object.keys( this.playerData ),
	newkeys = Object.keys( newStatus ),
	need_update = [ 
		...oldkeys.filter( 	key => (!newStatus[key] || this.playerData[key] !== newStatus[key]   )  )   ,
		...newkeys.filter(	newkey => !oldkeys.includes(newkey)  )
	],
	updatesequence = [
		...need_update.map(	x=>[x,newStatus[x]]	)
	];
	
	if(!updatesequence.length) return;
	this.playerData = newStatus;
	
	for( let update of updatesequence ){
    this.processChanges(...update);
	}
}

_Player.prototype.processChanges = function(key, data){
  if( ["current_title", "title", "artist", "album"].includes(key) ){
    this.formatMainString();
    this.emit( "trackChange", this.formatedMainString );
    if(this.state === "play") this.resetIdleTimeout(); // sinon les webradios sortent l'écran de veille 
  }
	else if(key === "mode"){
		this.state = data;
		this.resetIdleTimeout();
		this.emit( "stateChange", data );
	}
	else if( ["can_seek", "time", "duration"].includes(key)){
		this.seekFormat();
		this.emit( "seekChange", this.formatedSeek );
	}
	else if(key === "mixer volume"){
		this.resetIdleTimeout();
		this.emit( "volumeChange", data );
	}
  else if(key === "bitrate"){
		this.emit( "bitRateChange", data );
		this.emit( "line2", "Bit Rate : " + data );
	}
	else if(key === "samplerate"){
		this.emit( "sampleRateChange", data );
		this.emit( "line0", "Sample Rate : " + data );
	}
	else if(key === "type"){
		this.emit( "encodingChange", data );
		this.emit( "line4", "Track Type : " + data );
	}
	else if(key === "playlist_cur_index"){
		this.emit( "songIdChange", data );
		this.emit( "line5", "Playlist : " + data + " / " + this.playerData.playlist_tracks );
	}
	else if(key === "playlist repeat"){
		this.emit( "repeatChange", data );
		this.emit( "line6", "Repeat : " + data );
	}
  
}

// should use inheritance here 
_Player.prototype.watchIdleState = function(iddletime){
	this.watchingIdle = true;
	this.iddletime = iddletime;
	clearTimeout(this._iddleTimeout);
	this._iddleTimeout = setTimeout( ()=>{
		if(! this.watchingIdle ) return;
		this.iddle = true;
		this.emit("iddleStart")
	}, this.iddletime );
}
// should use inheritance here 
_Player.prototype.resetIdleTimeout = function(){
	if(! this.watchingIdle ) return;
	if( this.iddle  ) this.emit("iddleStop");
	this.iddle = false;
	this._iddleTimeout.refresh();
}
// should use inheritance here 
_Player.prototype.clearIdleTimeout = function(){
	this.watchingIdle = false;
	if( this.iddle  ) this.emit("iddleStop");
	this.iddle = false;
	clearTimeout(this._iddleTimeout);
}

_Player.prototype._checkIsLocal = function(){
	
	if(this.isLocal) return true;
	
	const raw_ip = (this.serverData?.ip || this.playerData?.player_ip || "").split(":")[0],
	test = !!Object.values(this.connection.LMS_interface.network)
	.flat()
	.find( x=>x.address === raw_ip);
	
	if(	!test ) return false;
	this.connection.emit("local_player_found", this);
	return true;
}

_Player.prototype.formatMainString = function (){
  this.formatedMainString = this.playerData.title + (this.playerData.artist?" - " + this.playerData.artist:"") + (this.playerData.album?" - " + this.playerData.album:"");
}

_Player.prototype.seekFormat = function (){
	
	let ratiobar, 
		seek_string, 
		seek = this.playerData.time, 
		duration = this.playerData.duration;
	try{
		if(!duration) ratiobar = 0;
		else ratiobar = (seek/duration*100);
	}
	catch(e){
		ratiobar = 0;
	}	
	try{
		duration = new Date(duration * 1000).toISOString().substr(14, 5);
	}
	catch(e){
		duration = "00:00";
	}
	try{
		seek = new Date(seek * 1000).toISOString().substr(14, 5);
	}
	catch(e){
	
		seek = "";
	} 
	seek_string = seek +" / "+ duration;
	
	this.formatedSeek = {seek_string:seek_string,ratiobar:ratiobar};
	
	return( this.formatedSeek );
}


/*
	LocalStreamer instance : 
	constructor to get a simplified object capable of handling all of the above 
	under the hood so I can plug the LMS CLI interface into my own scripts easily
*/


async function getlocalStreamer( path ){



  const config = getConfig(path);

  const lmsinterface = new LMS_interface();

	let localstreamer = null,
	error = null,
	connection;

  
	try{
    connection = await lmsinterface.connect(config.host,config.port);
    let login
    if(config.pass) login = await connection.login(config);
		players = await connection.getPlayers();
		localstreamer = players.find( x=>x.isLocal );
	}
	catch(err){
		if(connection) connection.cleanUp();
		error = err;
	}
	finally{
    if(!localstreamer && connection) connection.cleanUp();
    else console.log("[LMS] : connected.")
		return localstreamer;
	}
}

module.exports = getlocalStreamer;






