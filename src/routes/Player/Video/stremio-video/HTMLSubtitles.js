var EventEmitter = require('events');
var subtitlesParser = require('./subtitlesParser');
var subtitlesRenderer = require('./subtitlesRenderer');

var ERROR_CODE = Object.freeze({
    FETCH_FAILED: 70,
    PARSE_FAILED: 71
});
var FONT_SIZE = Object.freeze({
    1: '3vmin',
    2: '4vmin',
    3: '5vmin',
    4: '8vmin',
    5: '10vmin'
});

function HTMLSubtitles(options) {
    var containerElement = options && options.containerElement;
    if (!(containerElement instanceof HTMLElement) || !containerElement.hasAttribute('id')) {
        throw new Error('Instance of HTMLElement with id attribute required');
    }
    if (!document.body.contains(containerElement)) {
        throw new Error('Container element not attached to body');
    }

    var destroyed = false;
    var events = new EventEmitter();
    var cuesByTime = null;
    var tracks = Object.freeze([]);
    var selectedTrackId = null;
    var delay = null;
    var stylesElement = document.createElement('style');
    var subtitlesElement = document.createElement('div');

    events.on('error', function() { });
    containerElement.appendChild(stylesElement);
    var subtitlesStylesIndex = stylesElement.sheet.insertRule('#' + containerElement.id + ' .subtitles { position: absolute; right: 0; bottom: 0; left: 0; z-index: 0; font-size: ' + FONT_SIZE[2] + '; color: white; text-align: center; }', stylesElement.sheet.cssRules.length);
    stylesElement.sheet.insertRule('#' + containerElement.id + ' .subtitles .cue { display: inline-block; padding: 0.2em; text-shadow: 0 0 0.03em #222222, 0 0 0.03em #222222, 0 0 0.03em #222222, 0 0 0.03em #222222, 0 0 0.03em #222222; }', stylesElement.sheet.cssRules.length);
    stylesElement.sheet.insertRule('#' + containerElement.id + ' .subtitles.dark-background .cue { text-shadow: none; background-color: #222222; }', stylesElement.sheet.cssRules.length);
    containerElement.appendChild(subtitlesElement);
    subtitlesElement.classList.add('subtitles');

    function on(eventName, listener) {
        if (destroyed) {
            return;
        }

        events.on(eventName, listener);
    }
    function addTracks(extraTracks) {
        if (destroyed || !Array.isArray(extraTracks)) {
            return;
        }

        tracks = extraTracks
            .filter(function(track) {
                return track &&
                    typeof track.url === 'string' &&
                    track.url.length > 0 &&
                    typeof track.origin === 'string' &&
                    track.origin.length > 0 &&
                    track.origin !== 'EMBEDDED';
            })
            .map(function(track) {
                return Object.freeze(Object.assign({}, track, {
                    id: track.url
                }));
            })
            .concat(tracks)
            .filter(function(track, index, tracks) {
                for (var i = 0; i < tracks.length; i++) {
                    if (tracks[i].id === track.id) {
                        return i === index;
                    }
                }

                return false;
            });
        Object.freeze(tracks);
        events.emit('propChanged', 'tracks');
    }
    function updateText(mediaTime) {
        while (subtitlesElement.hasChildNodes()) {
            subtitlesElement.removeChild(subtitlesElement.lastChild);
        }

        if (cuesByTime === null || isNaN(mediaTime) || mediaTime === null) {
            return;
        }

        var time = mediaTime + delay;
        subtitlesRenderer.render(cuesByTime, time)
            .forEach(function(cueNode) {
                cueNode.classList.add('cue');
                subtitlesElement.append(cueNode, document.createElement('br'));
            });
    }
    function clearTracks() {
        updateText(NaN);
        cuesByTime = null;
        tracks = Object.freeze([]);
        selectedTrackId = null;
        delay = null;
        events.emit('propChanged', 'tracks');
        events.emit('propChanged', 'selectedTrackId');
        events.emit('propChanged', 'delay');
    }
    function destroy() {
        destroyed = true;
        clearTracks();
        events.emit('propChanged', 'size');
        events.emit('propChanged', 'darkBackground');
        events.emit('propChanged', 'offset');
        events.removeAllListeners();
        events.on('error', function() { });
        containerElement.removeChild(stylesElement);
        containerElement.removeChild(subtitlesElement);
    }

    Object.defineProperties(this, {
        tracks: {
            configurable: false,
            enumerable: true,
            get: function() {
                return Object.freeze(tracks.slice());
            }
        },
        selectedTrackId: {
            configurable: false,
            enumerable: true,
            get: function() {
                return selectedTrackId;
            },
            set: function(value) {
                if (destroyed) {
                    return;
                }

                cuesByTime = null;
                selectedTrackId = null;
                delay = null;
                updateText(NaN);
                var selecterdTrack = tracks.find(function(track) {
                    return track.id === value;
                });
                if (selecterdTrack) {
                    selectedTrackId = selecterdTrack.id;
                    delay = 0;
                    fetch(selecterdTrack.url)
                        .then(function(resp) {
                            return resp.text();
                        })
                        .catch(function(error) {
                            events.emit('error', Object.freeze({
                                code: ERROR_CODE.FETCH_FAILED,
                                message: 'Failed to fetch subtitles from ' + selecterdTrack.origin,
                                track: selecterdTrack,
                                error: error
                            }));
                        })
                        .then(function(text) {
                            if (typeof text === 'string' && selectedTrackId === selecterdTrack.id) {
                                cuesByTime = subtitlesParser.parse(text);
                                events.emit('trackLoaded', selecterdTrack);
                            }
                        })
                        .catch(function(error) {
                            events.emit('error', Object.freeze({
                                code: ERROR_CODE.PARSE_FAILED,
                                message: 'Failed to parse subtitles from ' + selecterdTrack.origin,
                                track: selecterdTrack,
                                error: error
                            }));
                        });
                }

                events.emit('propChanged', 'selectedTrackId');
                events.emit('propChanged', 'delay');
            }
        },
        delay: {
            configurable: false,
            enumerable: true,
            get: function() {
                return delay;
            },
            set: function(value) {
                if (destroyed || isNaN(value) || value === null || selectedTrackId === null) {
                    return;
                }

                delay = parseInt(value);
                updateText(NaN);
                events.emit('propChanged', 'delay');
            }
        },
        size: {
            configurable: false,
            enumerable: true,
            get: function() {
                if (destroyed) {
                    return null;
                }

                return parseInt(Object.keys(FONT_SIZE).find(function(size) {
                    return FONT_SIZE[size] === stylesElement.sheet.cssRules[subtitlesStylesIndex].style.fontSize;
                }));
            },
            set: function(value) {
                if (destroyed || isNaN(value) || value === null) {
                    return;
                }

                stylesElement.sheet.cssRules[subtitlesStylesIndex].style.fontSize = FONT_SIZE[Math.max(1, Math.min(5, parseInt(value)))];
                events.emit('propChanged', 'size');
            }
        },
        darkBackground: {
            configurable: false,
            enumerable: true,
            get: function() {
                if (destroyed) {
                    return null;
                }

                return subtitlesElement.classList.contains('dark-background');
            },
            set: function(value) {
                if (destroyed) {
                    return;
                }

                if (value) {
                    subtitlesElement.classList.add('dark-background');
                } else {
                    subtitlesElement.classList.remove('dark-background');
                }

                events.emit('propChanged', 'darkBackground');
            }
        },
        offset: {
            configurable: false,
            enumerable: true,
            get: function() {
                if (destroyed) {
                    return null;
                }

                return parseInt(stylesElement.sheet.cssRules[subtitlesStylesIndex].style.bottom);
            },
            set: function(value) {
                if (destroyed || isNaN(value) || value === null) {
                    return;
                }

                stylesElement.sheet.cssRules[subtitlesStylesIndex].style.bottom = Math.max(0, Math.min(100, parseInt(value))) + '%';
                events.emit('propChanged', 'offset');
            }
        }
    });

    this.on = on;
    this.addTracks = addTracks;
    this.updateText = updateText;
    this.clearTracks = clearTracks;
    this.destroy = destroy;

    Object.freeze(this);
};

Object.freeze(HTMLSubtitles);

module.exports = HTMLSubtitles;
