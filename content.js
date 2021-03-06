
var ce = chrome.extension;
var $ = console.log.bind(console);
var de = document.documentElement;
var is_windows = navigator.platform.indexOf('Win32') > -1;

var dragging = false;
var cursor_pos = {};
var source, selection;

var mouse_status = {}, last_status = {};
resetMouseStatus();

var settings = {};

function mixin(to, from) {
	for (var key in from) {
		if (from[key] instanceof Object)
			to[key] = mixin(to[key] instanceof Object ? to[key] : {}, from[key]);
		else if (from[key] instanceof Array)
			to[key] =	from[key].slice(0);
		else
			to[key] = from[key];
	}
	return to;
}

function disableSharing() {
	var disabled = {
		enableGesture: false,
		enableMidButton: false,
		ctrlKey: false
	};
	mixin(settings, disabled);
}

function endSharing() {
	resetMouseStatus();
	source = null;
	selection = '';
	dragging = false;
}

function setCursorPos(e) {
	cursor_pos.x = e.screenX + 20;
	cursor_pos.y = e.screenY + 20;
}

function setStatus(event) {
	last_status = mouse_status;
	mouse_status = {
		button: event.button,
		type: event.type,
		pos: {
			x: event.screenX,
			y: event.screenY
		}
	};
}

function resetMouseStatus() {
	setStatus({
		button: -1,
		screenX: 0,
		screenY: 0
	});
	last_status = mixin({}, mouse_status);
}

var Port = function() {
	this.port = ce.connect();
	this.onCreated = {
		addListener: function(listener) {
			this.listeners.push(listener);
		},
		listeners: []
	};
	this.addListener(this._listener.bind(this));
	this.port.postMessage({
		type: 'create_popup',
		pos: cursor_pos
	});
}
Port.prototype = {
	postMessage: function(type, msg) {
		var post = function() {
			if (type == 'post_details') {
				msg.page_tit = document.title;
				msg.page_url = location.href;
				msg.sel = getSelection() + '';
			}
			this.port.postMessage({
				type: type,
				msg: msg
			});
		}.bind(this);
		if (this.onCreated.created) {
			post();
		} else {
			this.onCreated.addListener(post);
		}
	},
	_listener: function(msg) {
		if (msg.type === 'popup_created') {
			var listeners = this.onCreated.listeners;
			var listener;
			while (listeners.length) {
				listener = listeners.shift();
				listener.call(this, msg);
			}
			this.onCreated.created = true;
			endSharing();
		}
	},
	addListener: function(listener) {
		this.port.onMessage.addListener(listener);
	}
};

function shareImage(url) {
	var src = url || ((source || {}).src);
	if (! src) return;
	if (url) {
		var imgs = document.images;
		for (var i = 0, len = imgs.length; i < len; i++) {
			if (imgs[i].src == url) {
				source = imgs[i];
				break;
			}
		}
	}
	if (! source) return;

	var port = new Port;
	port.postMessage('post_details', {
		type: 'image',
		img_desc: source.alt,
		img_tit: source.title,
		img_url: src
	});

	if (src.indexOf('data:image/') == 0) return;

	function updatePhotoError() {
		port.postMessage('update_photo', { });
	}

	loadImageInfo(src, function(data) {
		if (data.format === 'UNKNOWN')
			data.format = 'PNG';

		port.postMessage('update_photo', {
			img_data: data.binaryData,
			img_type: 'image/' + data.format.toLowerCase()
		});
	}, updatePhotoError);
}

function shareSelection(from_context_menu) {
	selection = getSelection() + '';
	if (! selection.length && ! from_context_menu) return;
	var port = new Port;
	port.postMessage('post_details', {
		type: 'selection'
	});
}

function shareLink(link) {
	if (typeof link == 'string') {
		var links = document.links;
		for (var i = 0, len = links.length; i < len; i++) {
			if (links[i].href == link) {
				link = links[i];
				break;
			}
		}
	}
	if (! link.nodeType || ! link.href) return;

	var url = link.href;
	if (url.indexOf('http://') != 0 &&
		url.indexOf('https://') != 0 &&
		url.indexOf('ftp://') != 0) {
			return;
	}
	var title = link.title;
	var desc = link.textContent;

	var port = new Port;
	port.postMessage('post_details', {
		type: 'link',
		link_desc: desc != url && desc,
		link_url: url,
		link_tit: title != url && title != desc && title
	});
}

function isMouseActionEnabled() {
	return settings.enableGesture || settings.enableMidButton;
}

function onMouseDown(e) {
	if (! isMouseActionEnabled()) {
		dragging = false;
		return;
	}
	if (e.button === 0) return;
	if (dragging) {
		if (mouse_status.type !== 'mousedown') {
			endSharing();
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		return;
	}
	setStatus(e);
	if (! settings.enableGesture ||
		settings.ctrlKey !== e.ctrlKey) {
			return endSharing();
	}

	source = e.target;
	// 接受的拖拽来源: img/canvas/a, 或者选中了文本
	if (['img', 'canvas', 'a'].indexOf(source.tagName.toLowerCase()) === -1 &&
		! getSelection().toString()) {
		endSharing();
		return;
	}

	if (e.ctrlKey) e.preventDefault();
	if (e.button === 2 ||
		(e.button === 1 && settings.enableMidButton)) {
		e.stopPropagation();
	}

	dragging = true;
	// 记录鼠标坐标
	setCursorPos(e);
}

function onMouseUp(e) {
	if (! isMouseActionEnabled()) {
		dragging = false;
		return;
	}
	if (e.button !== 0) setTimeout(endSharing, 0);
	setStatus(e);
	if (settings.ctrlKey !== e.ctrlKey) return;
	if (settings.enableMidButton) {
		if (e.button !== 1) return;
	}
	else if (! dragging || e.button !== 2) return;

	setCursorPos(e);
	var d = e.screenX - last_status.pos.x;
	// 拖拽结束, 如果水平拖拽距离小于 75px, 则忽略这次拖拽
	if (dragging && d < 75 && (d <= 0 ||
		(innerWidth + screenX - mouse_status.pos.x)/2 > d)) {
		endSharing();
		return;
	}
	e.stopPropagation();

	if (! source) return shareSelection();
	switch (source.tagName.toLowerCase()) {

		case 'img':
			shareImage();
			break;

		case 'canvas':
			shareImage(source.toDataURL());
			break;

		case 'a':
			// 中键点击链接会强制打开标签页, 无法阻止
			// 所以忽略掉这种情况
			if (e.button === 1) return;
			shareLink(source);
			break;

		default:
			shareSelection();
	}
}

function onContextMenu(e) {
	if (! is_windows) {
		setCursorPos(e);
		return;
	}
	if (! isMouseActionEnabled()) {
		dragging = false;
		return;
	}
	setTimeout(endSharing, 0);
	if (mouse_status.button !== 2) return;
	if (dragging) {
		// 如果刚刚在拖动, 则避免上下文菜单出现
		e.preventDefault();
		e.stopPropagation();
	} else {
		// 如果用户使用了上下文菜单, 则记录右击页面的位置
		setCursorPos(e);
	}
}

function getSettings() {
	(ce.sendMessage || ce.sendRequest)({
		type: 'get_settings'
	});
}
disableSharing();
getSettings();

de.addEventListener('contextmenu', onContextMenu, false);
if (is_windows) {
	de.addEventListener('mousedown', onMouseDown, false);
	de.addEventListener('mouseup', onMouseUp, false);
}

(function() {
	// 每次重新加载时, 接触事件绑定, 方便测试
	var event_type = 'FanjoyLoaded';
	var event = document.createEvent('MessageEvent');
	event.initMessageEvent(event_type);
	dispatchEvent(event);

	addEventListener(event_type, function onExtReloaded() {
		removeEventListener(event_type, onExtReloaded, false);
		de.removeEventListener('contextmenu', onContextMenu, false);
		if (is_windows) {
			de.removeEventListener('mousedown', onMouseDown, false);
			de.removeEventListener('mouseup', onMouseUp, false);
		}
	}, false);
})();