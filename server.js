//----------------------------------------------------------------------------
//
// aeschat Node.js server
// https://github.com/ronaegis/aeschat
//
// Usage: node server.js [port]
//
// Config variables:
// Default listening interface (use 0.0.0.0 for all)
var CONFIG_HTTP_INTERFACE = '127.0.0.1';

// Default listening port
var CONFIG_HTTP_PORT = 8888;

// Number of chat lines to keep in memory for each channel
var CONFIG_BUFFER_LINES = 32;

//----------------------------------------------------------------------------

var http = require("http"),
  url = require("url"),
  path = require("path"),
  fs = require("fs"),
  crypto = require('crypto'),
  port = process.argv[2] || CONFIG_HTTP_PORT;

var chatLines = {};

function processJsonRequest(jsonString) {
  var json = JSON.parse(jsonString);
  if (!Object.keys(json).length) {
    response.end();
    return;
  }

  var func = json["function"];
  var chan = json["chan"];
  if (!func || !chan) return;

  // Check that "chan" is a valid hash
  if (chan.match(/^[a-f0-9]{64}$/i) === null)
    return "{}";

  switch (func) {
    case 'get':
      var t = parseInt(json["t"]);
      if (t < 0) return;
      if (!(chan in chatLines))
        return;
      var log = {};
      var lastLine = chatLines[chan][0];
      log["t"] = lastLine;
      log["text"] = "";
      for (i = t + 1; i < lastLine + 1; i++)
        if (i in chatLines[chan])
          log["text"] += chatLines[chan]["time" + i] + "," +
          chatLines[chan][i] + "\n";
      return JSON.stringify(log);

    case 'post':
      var line = json["line"];
      if (!line) return;
      if (line.length > 1024) return;
      var lastLine = 1;
      if (chan in chatLines)
        lastLine = chatLines[chan][0] + 1;
      else
        chatLines[chan] = {};
      chatLines[chan][0] = lastLine;
      chatLines[chan][lastLine] = line;
      chatLines[chan]["time" + lastLine] =
        new Date().getTime() / 1000;
      var log = {};
      log["t"] = lastLine - 1;

      // Purge old chat lines from memory
      for (var key in chatLines[chan]) {
        if (isNaN(key)) continue;
        var r = parseInt(key);
        if (r == 0) continue;
        if (r <= (lastLine - CONFIG_BUFFER_LINES)) {
          // Purge entry
          delete chatLines[chan][r];
          delete chatLines[chan]["time" + r];
        }
      }

      return JSON.stringify(log);
  }
}

//----------------------------------------------------------------------------

http.createServer(function(request, response) {

  if (request.method == "POST") {

    var jsonString = '';

    request.on('data', function(data) {
      jsonString += data;
    });

    request.on('end', function() {
      var ret = "";
      try {
        ret = processJsonRequest(jsonString);
      } catch (err) {
        console.log("Error: " + err);
      }

      if (ret === undefined || ret == "")
        ret = "{}";

      response.write(ret);
      response.end();
    });
    return;
  }

  // Serve static file
  var uri = url.parse(request.url).pathname;
  var filename = path.join(process.cwd() + "/web", uri);

  if (request.url == '/') filename += "index.html";

  var exists = false;
  try {
    exists = fs.statSync(filename).isFile();
  } catch (err) {}
  if (!exists) {
    response.writeHead(404, {
      "Content-Type": "text/plain"
    });
    response.write("404 Not Found\n");
    response.end();
    return;
  }

  fs.readFile(filename, "binary", function(err, file) {
    if (err) {
      response.writeHead(500, {
        "Content-Type": "text/plain"
      });
      response.write(err + "\n");
      response.end();
      return;
    }

    // Process special files
    if (uri == "/xkcd_pw-min.js") {
      // Add server time as seed for the random hash
      var hash = crypto.createHash('sha1').update(new Date().getTime() +
        "slkfjsdleiu").digest('hex');
      file += "var xkcd_pw_gen_server_hash=\"" + hash + "\"";
    }
    if (uri == "/emo.js") {
      // Enumerate all available emoticons
      var p = "./web/emo";
      file += "var emoticons = ["
      var files = fs.readdirSync(p);
      var i = 0;
      files.forEach(function(f) {
        if (i != 0) file += ", ";
        file += '"' + path.basename(f, ".gif") + '"';
        i++;
      });
      file += "];";
    }

    response.writeHead(200);
    response.write(file, "binary");
    response.end();
  });

}).listen(port, CONFIG_HTTP_INTERFACE);

//----------------------------------------------------------------------------

console.log("aeschat server running at\n  => http://localhost:" + port +
  "/\nCTRL + C to shutdown");
