// ==UserScript==
// @name			Kinect Browser
// @description		Defining Spatial Gestures for Web Browsing Tasks
// @author			Alexander Huber
// @namespace		http://dev.globis.ethz.ch
// @include			http://*
// @include			https://*
// @grant			GM_getResourceURL
// @grant			GM_addStyle
// @grant			GM_getValue
// @grant			GM_setValue
// @require			http://ajax.googleapis.com/ajax/libs/jquery/2.0.0/jquery.min.js
// @require			dollar.js
// @resource		imgLeft				img/left.svg
// @resource		imgLeftGrip			img/left-grip.svg
// @resource		imgRight			img/right.svg
// @resource		imgRightGrip		img/right-grip.svg
// @resource		imgMarkYellow		img/mark-yellow.svg
// --resource		logWriter			php/log.php
// ==/UserScript==

// Ignore frames and iframes
if (window.top != window.self)
	return;

this.$ = this.jQuery = jQuery.noConflict(true);

/* Set Greasemonkey variables (run on first start)
GM_setValue("isMapped", false);
GM_setValue("leftFlickLeft", 1);
GM_setValue("leftFlickRight", 0);
GM_setValue("rightFlickLeft", 1);
GM_setValue("rightFlickRight", 0);
GM_setValue("scroll", 1);
*/

// #### CSS ########################################################################################

GM_addStyle("\
	#kb_wrapper {\
		position: fixed;\
		top: 0;\
		left: 0;\
		z-index: 1000000;\
		width: 100%;\
		height: 40px;\
		line-height: 40px;\
		background-color: #FFFFFF;\
		margin: 0;\
		padding: 0;\
	}\
	#kb_website {\
		position: absolute;\
		top: 41px;\
		left: 0;\
		margin: 0;\
		padding: 0;\
	}\
	.kb_hisnav {\
		float: left;\
		width: 6%;\
		height: 100%;\
		background-color: #FFFFFF;\
		margin: 0;\
		padding: 0;\
        text-align: center;\
        font-weight:bold;\
	}\
	#kb_tabbar {\
		float: left;\
		width: 85%;\
		height: 100%;\
		background-color: #FFFFFF;\
		margin: 0;\
		padding: 0;\
	}\
	.kb_tab {\
		display: inline-block;\
		height: 100%;\
		margin: 0;\
		margin-right: 0.25%;\
		padding: 0;\
		background-color: #D8D8D8;\
		overflow: hidden;\
		text-align: left;\
	}\
	.kb_tabline {\
		margin-left: 3px;\
		vertical-align: middle;\
		font-family: Verdana;\
		font-size: 14px;\
		color: #000000;\
	}\
	.kb_tab.active {\
		background-color: #B0B0B0;\
	}\
	#kb_status {\
		float: left;\
		height: 100%;\
		width: 3%;\
		background-color: #F78181;\
		margin: 0;\
		padding: 0;\
	}\
	#kb_status.connected {\
		background-color: #A5DF00;\
	}\
	#kb_website {\
		position: absolute;\
		top: 40;\
		right: 0;\
		width: 100%; \
		margin: 0;\
		padding: 0;\
	}\
	.kb_pointer {\
		position: fixed;\
		z-index: 1000001;\
		width: 81px; \
		height: 81px;\
		top: 1px;\
		background-repeat: no-repeat;\
		margin: 0;\
		padding: 0;\
	}\
	#kb_left {\
		left: 0;\
		background-image: url(" + GM_getResourceURL("imgLeft") + ");\
	}\
	#kb_left.grip {\
		background-image: url(" + GM_getResourceURL("imgLeftGrip") + ");\
	}\
	#kb_right {\
		right: 0;\
		background-image: url(" + GM_getResourceURL("imgRight") + ");\
	}\
	#kb_right.grip {\
		background-image: url(" + GM_getResourceURL("imgRightGrip") + ");\
	}\
	.kb_highlight {\
		background-color: #FFFF99;\
	}\
	.kb_mark {\
		position: fixed;\
		background-repeat: no-repeat;\
		margin: 0;\
		padding: 0;\
		z-index: 1000003;\
		width: 16px; \
		height: 16px;\
		background-image: url(" + GM_getResourceURL("imgMarkYellow") + ");\
	}\
");

// #### Logging ####################################################################################

var logging = true;
var logMsgs = [];

// z.B. log('pointer', '<hand> <x> <y>')
function log(action, msg) {
	if (logging) {
		if (typeof console == "object")
			console.log(action + ' ' + msg);

		//var ts = new Date();
		//logMsgs.push(ts.format('yyyy-mm-dd HH:MM:ss.l') + '\t' + action + '\t' + msg);			// TODO
		var ts = Date.now();
		logMsgs.push(ts + '\t' + action + '\t' + msg);
	}
}

function sendLog() {
	if (logMsgs.length == 0) {
		return;
	}

	data = {
		log: logMsgs.join('\n'),
		user_id: GM_getValue("userID", "P0")
	};

	$.ajax("http://test.globis.ethz.ch/kinectbrowser/log.php", {
		method: 'POST',
		data: data
	});
	logMsgs.length = 0; // clear log once submitted
}

window.setInterval(sendLog, 30000);

// #### Pointer class ##############################################################################

function Pointer(hand, x, y) {
	// Properties
	this.x = x;					// current x coordinate
	this.xPre = x;				// previous x coordinate
	this.y = y;					// current y coordinate
	this.yPre = y;				// previous y coordinate
	this.over = $();			// hovered over element
	this.grip = false;			// grip state
	this.points = [];			// $1 Unistroke Recognizer
	this.timeout = undefined;	// activation interval
	this.image = $();			// image for the pointer
	this.hand = hand;			// left or right
	// other hand
	if (hand == "left")
		this.other = "right";
	else if (hand == "right")
		this.other = "left";

	// Pointer reposition routine
	this.reposition = function (x, y) {
		// If inactive, reappear
		if (this.image.is(':hidden')) {
			this.image.show();
			this.over = $();
		// If active, keep-alive
		} else if (this.timeout != undefined)
			window.clearTimeout(this.timeout);

		// Reposition pointer image
		this.image.css({ 'top': y - 41 + 'px', 'left': x - 41 + 'px' });

		// Get the element over which the pointer is now
		var over = $(document.elementFromPoint(x, y));
		// Filter out pointers and marks
		var hidden = $();
		while (over.hasClass('kb_pointer') || over.hasClass('kb_mark')) {
			over.hide();
			hidden = hidden.add(over);
			over = $(document.elementFromPoint(x, y));
		}
		hidden.show();

		// If pointer moved between elements
		if (!(over.is(this.over))) {
			this.over.trigger('mouseleave');	// mouseleave event on previous hovered over element

			// Register a dwell click timer
			if (this.dwellClick) {
				// Clear old timer
				window.clearTimeout(this.over.data('dwellClick'));
				// Click event on element which is hovered over for a preset time
				over.data('dwellClick', window.setTimeout(function (elem, pointer) {
					log(operator, "dwellClick " + pointer.hand);									// Log
					over.get(0).click();
				}, GM_getValue("timeDwellClick", 3000), over, this));

			}

			over.trigger('mouseenter');			// mouseenter event on new hovered over element

			this.over = over;					// memorise new hovered over element
		}

		// Pointer changed position within hovered over element
		if (x !== this.x || y !== this.y) {
			over.trigger('mousemove');					// mousemove event on hovered over element
			this.xPre = this.x; this.yPre = this.y;		// memorise previous coordinates
			this.x = x; this.y = y;						// memorise new coordinates
		}

		// Deactivate pointer if no keep-alive within 1 second
		this.timeout = window.setTimeout(function (pointer) {
			// Hide pointer image and remove any grip state
			window.clearTimeout(pointer.over.data('dwellClick'));
			pointer.over.trigger('mouseleave');
			pointer.image.hide();
			pointer.image.children('.kb_mark').remove();
			pointer.points = new Array();
		}, GM_getValue("timeDeactivate", 2500), this);
	}

	// Grip event handler
	this.grips = function() {
		// Switch to grip state
		this.grip = true;

		// Change pointer image
		this.image.addClass('grip');

		// Register grip click event for a preset timeframe if enabled
		if (this.gripClick) {
			this.over.on('gripClick', function (event, hand) {
				log(operator, "gripClick " + hand);													// Log
				$(this).get(0).click();
			});
			setTimeout(function (over) {
				over.off('gripClick');
			}, GM_getValue("timeGripClick", 1000), this.over);
		}
	}

	// Release event handler
	this.releases = function() {
		// Switch to release state
		this.grip = false;

		// Trigger grip click event of hovered over element
		this.over.trigger('gripClick', this.hand);

		// Execute $1 Unistroke Recognizer if points available
		if (this.points.length > 0) {
			// Get and check result
			var result = dollarRecognizer.Recognize(this.points);
			if (result.Score >= 0.80)
				executeGesture(result.Name);
			// Remove point marks
			this.image.children('.kb_mark').remove();
			this.points = new Array();
		}

		// Change back pointer image
		this.image.removeClass('grip');
	}

	// Press event handler
	this.presses = function () {
		if (this.pressClick) {
			log(operator, "pressClick " + this.hand);												// Log
			this.over.get(0).click();
		}
	}

	// Settings
	this.dwellClick = false;
	this.pressClick = false;
	this.gripClick = false;
	this.onGrip = function() {};
	this.onFlickLeft = function() {};
	this.onFlickRight = function() {};
}

// #### Grip actions ###############################################################################

// Scrolling
function gripScroll() {
	if (!pointers[this.other].grip) {
	    var deltaX = GM_getValue("scroll", -1)*(this.x - this.xPre);
	    var deltaY = GM_getValue("scroll", -1)*(this.y - this.yPre);
		scroll(deltaX, deltaY);
	}
}

// $1 Unistroke Recognizer
function oneDollar() {
	this.points.push(new Point(this.x, this.y));
	this.image.append('<div class="kb_mark" style="top: ' + (this.y - 8) + 'px; left: ' + (this.x - 8) + 'px;"></div>');
}

// #### General information and simple tab bar #####################################################

// GM_getValue("tabNumber", 4);			number of open tabs
// GM_getValue("tabActive", 0);			previously active or opened tab
// GM_getValue("historyPosition", 0);	position in the active tab's history
// GM_getValue("historyLength", 1);		maximal lenght of active tab's history

if (document.contentType == "text/html") {
	// Log general information
	log("info", document.URL + " " + GM_getValue("historyPosition", 0) + " " + GM_getValue("historyLength", 1) + " " + GM_getValue("tabActive", 0) + " " + GM_getValue("tabNumber", 4));

	// Add controls
    $('body').wrapInner('<div id="kb_website"></div>');
    $('body').prepend('<div id="kb_wrapper"><div id="kb_back" class="kb_hisnav">&lt;</div><div id="kb_forward" class="kb_hisnav">&gt;</div><div id="kb_tabbar"></div><div id="kb_status"></div></div>');

    // On/off (open/close WebSocket)
    $('#kb_status').click(function () {
        if (webSocket == undefined || webSocket.readyState === WebSocket.CLOSED)
            startKinectBrowser();
        else if (webSocket.readyState === WebSocket.OPEN)
            webSocket.close();
    });

    // Back button
    $('#kb_back').click(function () {
        log(operator, "clickBack");																	//	Log
        historyBack();
    });

    // Forward button
    $('#kb_forward').click(function () {
        log(operator, "clickForward");																//	Log
        historyForward();
    });

    // Load tabs
    for (var i = 0; i < GM_getValue("tabNumber", 4) ; i++) {
        // Re-write active tab
    	if (GM_getValue("tabActive", 0) === i) {
			GM_setValue("tabTitle" + i, document.title);
            GM_setValue("tabURL" + i, document.URL);
            $('#kb_tabbar').append('<div class="kb_tab active">\
				<img class="kb_tabline" src="https://plus.google.com/_/favicon?domain=' + document.domain + '"></img><span class="kb_tabline">' + document.title + '</span>\
			</div>');
            // Display other tabs
        } else {
            $('#kb_tabbar').append('<div class="kb_tab" data-id="' + i + '">\
				<img class="kb_tabline" src="https://plus.google.com/_/favicon?domain_url=' + GM_getValue("tabURL" + i) + '"></img><span class="kb_tabline">' + GM_getValue("tabTitle" + i) + '</span>\
			</div>');
        }
    }

    // Adapt size
    $('.kb_tab').css('width', (100 / GM_getValue("tabNumber", 4) - 0.25) + '%');

    // Change tab
    $('.kb_tab:not(.active)').click(function () {
        var id = $(this).data('id');
        log(operator, "clickTab " + id);															//	Log
        tabSwitch(id);
    });

    // Set font size
    $('body').css('font-size', GM_getValue("fontSize", 100) + '%');

    // If an anchor is clicked, add entry to tab history
    $('a').click(function () {
        log(operator, "clickLink " + $(this).attr("href"));											// Log

        // history adaptions
        var position = GM_getValue("historyPosition", 0) + 1;
        GM_setValue("historyLength", position + 1);
        GM_setValue("historyPosition", position);
    });

    // Highlight control and anchor elements whenever pointer is hovering over them
    $('.kb_hisnav, .kb_tab:not(.active), a').hover(
		function () {
		    $(this).addClass('kb_highlight');
		},
		function () {
		    $(this).removeClass('kb_highlight');
		}
	);
}

// #### Start Kinect Browser Client ################################################################

var kinectBrowser = $(window);

function startKinectBrowser() {
	// **** Pointers *******************************************************************************
	window.pointers = {
		left: new Pointer("left", 41, 41),
		right: new Pointer("right", window.innerWidth - 41, 41)
	};

	window.operator = (GM_getValue("isMapped", true) ? "browser" : "manual");

	// %%%% Left pointer %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

	// Click
	/* press element */			pointers.left.pressClick = true;
	/* grip and element */		pointers.left.gripClick = true;
	/* dwell on element */		pointers.left.dwellClick = true;

	// Grip
	switch(GM_getValue("leftOnGrip", 1)) {
	    case 1:
            pointers.left.onGrip = gripScroll;      // scrolling
            break;
	    case 2:
	        pointers.left.onGrip = oneDollar;      // 1$ Recognizer
	        break;
	}

	// Flick to the left
	switch (GM_getValue("leftFlickLeft", 2)) {
		case 1:
			pointers.left.onFlickLeft = historyBack;	// go back in browser history
			break;
		case 2:
			pointers.left.onFlickLeft = historyForward;	// go forward in browser histrory
			break;
		case 3:
			pointers.left.onFlickLeft = tabPrevious;	// switch to previous tab
			break;
		case 4:
			pointers.left.onFlickLeft = tabNext;		// switch to next tab
			break;				
	}

	// Flick to the right
	switch (GM_getValue("leftFlickRight", 1)) {
		case 1:
			pointers.left.onFlickRight = historyBack;		// go back in browser history
			break;
		case 2:
			pointers.left.onFlickRight = historyForward;	// go forward in browser histrory
			break;
		case 3:
			pointers.left.onFlickRight = tabPrevious;		// switch to previous tab
			break;
		case 4:
			pointers.left.onFlickRight = tabNext;			// switch to next tab
			break;				
	}

	// %%%% Right pointer %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

	// Click
	/* press element */			pointers.right.pressClick = true;
	/* grip and element */		pointers.right.gripClick = true;
	/* dwell on element */		pointers.right.dwellClick = true;

	// Grip
	switch (GM_getValue("rightOnGrip", 1)) {
	    case 1:
	        pointers.right.onGrip = gripScroll;      // scrolling
	        break;
	    case 2:
	        pointers.right.onGrip = oneDollar;      // 1$ Recognizer
	        break;
	}

	// Flick to the left
	switch (GM_getValue("rightFlickLeft", 2)) {
		case 1:
			pointers.right.onFlickLeft = historyBack;	// go back in browser history
			break;
		case 2:
			pointers.right.onFlickLeft = historyForward;	// go forward in browser histrory
			break;
		case 3:
			pointers.right.onFlickLeft = tabPrevious;	// switch to previous tab
			break;
		case 4:
			pointers.right.onFlickLeft = tabNext;		// switch to next tab
			break;				
	}

	// Flick to the right
	switch (GM_getValue("rightFlickRight", 1)) {
		case 1:
			pointers.right.onFlickRight = historyBack;		// go back in browser history
			break;
		case 2:
			pointers.right.onFlickRight = historyForward;	// go forward in browser histrory
			break;
		case 3:
			pointers.right.onFlickRight = tabPrevious;		// switch to previous tab
			break;
		case 4:
			pointers.right.onFlickRight = tabNext;			// switch to next tab
			break;				
	}


	// **** WebSocket ******************************************************************************

	window.webSocket = new WebSocket('ws://localhost:8181/kinectbrowser');

	// Set-up when WebSocket is opened
	webSocket.onopen = function() {
		// Add pointer images to body of document and change status indicator image, only for HTML
		if (document.contentType == "text/html") {
			$('#kb_status').addClass('connected');

			// Add pointer images
			$('body').append('<div id="kb_left" class="kb_pointer"></div>');	// left
			pointers.left.image = $('#kb_left');
			$('body').append('<div id="kb_right" class="kb_pointer"></div>');	// right
			pointers.right.image = $('#kb_right');
			$('.kb_pointer').hide();

			// Get elements over which the pointers are hovering
			pointers.left.over = $(document.elementFromPoint(pointers.left.x, pointers.left.y));
			pointers.right.over = $(document.elementFromPoint(pointers.right.x, pointers.right.y));
		
			// $1 Unistroke Recognizer
			window.dollarRecognizer = new DollarRecognizer();
		}
	}

	// Clean-up when WebSocket is closed
	webSocket.onclose = function() {
		if (document.contentType == "text/html") {
			$('.kb_pointer').remove();
			$('#kb_status').removeClass('connected');
		}
	}

	// Routine when message is received
	webSocket.onmessage = function (event) {
	    var message = JSON.parse(event.data);	// Parse received JSON
		kinectBrowser.trigger(message);			// Trigger received event type
	}
}

startKinectBrowser();

// Log scrolling events
var xOffset = 0;
var yOffset = 0;

window.onscroll = function (data) {
	var deltaX = window.pageXOffset - xOffset;
	var deltaY = window.pageYOffset - yOffset;
	log(operator, "scroll " + deltaX + " " + deltaY);												// Log
	xOffset = window.pageXOffset;
	yOffset = window.pageYOffset;
}

// Close WebSocket properly
window.onbeforeunload = function() {
	if (webSocket != undefined) {
		webSocket.onclose = function () {};
		webSocket.close();
	}
};

// #### Pointer position update events #############################################################

kinectBrowser.on('pointer', function (data) {
	if (GM_getValue("isMapped", true)) {
		// Translate from Kinect's floating point representation to screen pixels
		var x = Math.round(data.x * window.innerWidth);
		var y = Math.round(data.y * window.innerHeight);

		// Reposition
		log("pointer", data.hand + " " + x + " " + y);												// Log
		pointers[data.hand].reposition(x, y);

		// Grip functionality
		if (pointers[data.hand].grip)
			pointers[data.hand].onGrip();
	}
});

// #### Gesture events #############################################################################

// Hand grips
kinectBrowser.on('grip', function (data) {
	log("gesture", "grip " + data.hand);															// Log
	if (GM_getValue("isMapped", true))
		pointers[data.hand].grips();
});

// Hand releases
kinectBrowser.on('release', function (data) {
	log("gesture", "release " + data.hand);															// Log
	if (GM_getValue("isMapped", true))
		pointers[data.hand].releases();
});

// Hand presses
kinectBrowser.on('press', function (data) {
	log("gesture", "press " + data.hand);															// Log
	if (GM_getValue("isMapped", true))
		pointers[data.hand].presses();
});

// Hand flicks to the left
kinectBrowser.on('flickLeft', function (data) {
	log("gesture", "flickLeft " + data.hand);														// Log
	if (GM_getValue("isMapped", true))
		pointers[data.hand].onFlickLeft();
});

// Hand flicks to the right
kinectBrowser.on('flickRight', function (data) {
	log("gesture", "flickRight " + data.hand);														// Log
	if (GM_getValue("isMapped", true))
		pointers[data.hand].onFlickRight();
});

// Zoom in
kinectBrowser.on('pinchOpen', function (data) {
	log("gesture", "pinchOpen");																	// Log
	if (GM_getValue("isMapped", true))
		zoomIn();
});

// Zoom out
kinectBrowser.on('pinchClose', function (data) {
	log("gesture", "pinchClose");																	// Log
	if (GM_getValue("isMapped", true))
		zoomOut();
});

// #### Speech events ##############################################################################

// Go back in browser history
kinectBrowser.on('historyBack', function (data) {
	log("speech", "historyBack");																	// Log
	if (GM_getValue("isMapped", true))
		historyBack();
});

// Go forward in browser history
kinectBrowser.on('historyForward', function (data) {
	log("speech", "historyForward");																// Log
	if (GM_getValue("isMapped", true))
		historyForward();
});

// Switch to previous tab
kinectBrowser.on('tabPrevious', function (data) {
	log("speech", "tabPrevious");																	// Log
	if (GM_getValue("isMapped", true))
		tabPrevious();
});

// Switch to next tab
kinectBrowser.on('tabNext', function (data) {
	log("speech", "tabNext");																		// Log
	if (GM_getValue("isMapped", true))
		tabNext();
});

// Switch to tab <number>
kinectBrowser.on('tabSwitch', function (data) {
	log("speech", "tabSwitch " + data.num);															// Log
	if (GM_getValue("isMapped", true))
		tabSwitch(data.num);
});

// Reload page
kinectBrowser.on('reload', function (data) {
	log("speech", "reload");																		// Log
	if (GM_getValue("isMapped", true))
		window.location.reload();
});

// Scroll down
kinectBrowser.on('scrollDown', function (data) {
	log("speech", "scrollDown");																	// Log
	if (GM_getValue("isMapped", true))
		scrollDown();
});

// Scroll up
kinectBrowser.on('scrollUp', function (data) {
	log("speech", "scrollUp");																		// Log
	if (GM_getValue("isMapped", true))
		scrollUp();
});

// Zoom in
kinectBrowser.on('zoomIn', function (data) {
	log("speech", "zoomIn");																		// Log
	if (GM_getValue("isMapped", true))
		zoomIn();
});

// Zoom out
kinectBrowser.on('zoomOut', function (data) {
	log("speech", "zoomOut");																		// Log
	if (GM_getValue("isMapped", true))
		zoomOut();
});

// Zoom reset
kinectBrowser.on('zoomReset', function (data) {
	log("speech", "zoomReset");																		// Log
	if (GM_getValue("isMapped", true))
		zoom(100);
});

// #### Helper functions for browser functionality #################################################

function historyGo(step) {
    var position = GM_getValue("historyPosition", 0) + step;
	if (0 <= position && position < GM_getValue("historyLength", 1)) {	// Is history entry available?
		GM_setValue("historyPosition", position);
		log(operator, "history " + position);														// Log
		window.history.go(step);
	}
}

// Go back in browser history
function historyBack() {
	historyGo(-1);
}

// Go forward in browser history
function historyForward() {
	historyGo(1);
}

// Switch to tab <id>
function tabSwitch(id) {
	// If tab exists and is not already loaded
	if (id <= GM_getValue("tabNumber", 4) && id != GM_getValue("tabActive", 0)) {
		log(operator, "tab " + id);																	// Log

		// Clear history of new tab
		GM_setValue("historyPosition", 0);
		GM_setValue("historyLength", 1);

		// Change tab
		GM_setValue("tabActive", id);							// selected tab is now active							
		window.location.href = GM_getValue("tabURL" + id);		// load selected tab
	}
}

// Switch to next tab
function tabNext() {
	var id = GM_getValue("tabActive", 0) + 1;	// id of next tab
	if (id >= GM_getValue("tabNumber", 4))		// if rollover
		id = 0;									// jump to first
	tabSwitch(id);
}

// Switch to previous tab
function tabPrevious() {
	var id = GM_getValue("tabActive", 0) - 1;	// id of previous tab
	if (id < 0)									// if rollover
		id = GM_getValue("tabNumber", 4) - 1;	// jump to last
	tabSwitch(id);
}

// Scroll page in x-direction (deltaX) or y-direction (deltaY)
function scroll(deltaX, deltaY) {
	//log(operator, "scroll " + deltaX + " " + deltaY);												// Log (depricated)
	scrollBy(deltaX, deltaY);
}

// Scroll down for a window height
function scrollDown() {
	scroll(0,window.innerHeight - 41);
}

// Scroll up for a window height
function scrollUp() {
	scroll(0,-(window.innerHeight - 41));
}

// Set font zoom
function zoom(scale) {
	if (70 <= scale && scale <= 130) {
		log(operator, "zoom " + scale);																// Log
		GM_setValue("fontSize", scale);
		$('body').css('font-size', scale + '%');
	}
}

// Scale up font size
function zoomIn() {
	zoom(GM_getValue("fontSize", 100) + 10);		// increase scale by one scale step
}

// Scale down font size
function zoomOut() {
	zoom(GM_getValue("fontSize", 100) - 10);		// reduce scale by one scale step
}
function reload() {
	log(operator, "reload");																		// Log
	window.location.reload();
}

// #### Shortcuts for browser functions ############################################################

kinectBrowser.keypress(function (data) {
	var key = String.fromCharCode(data.which);
	log(operator, "keyPress " + key);																// Log

	switch (key) {
		// Scrolling
		case "d":
			scrollDown();
			break;
		case "u":
			scrollUp();
			break;
		// Zooming
		case "+":
			zoomIn();
			break;
		case "-":
			zoomOut();
			break;
		// History
		case "b":
			historyBack();
			break;
		case "f":
			historyForward();
			break;
		// Tabs
		case "1":
			tabSwitch(0);
			break;
		case "2":
			tabSwitch(1);
			break;
		case "3":
			tabSwitch(2);
			break;
		case "4":
			tabSwitch(3);
			break;
		case "n":
			tabNext();
			break;
		case "p":
			tabPrevious();
			break;
		// Reload page
		case "r":
			reload();
			break;
	}
});

// #### Helper functions for $1 Unistroke Recognizer ###############################################

// execution of recognised 1$ gestures 
function executeGesture(gesture) {
	log("onedollar", gesture);																		// Log
	if (gesture === "circle") {
		reload();
	}
}
