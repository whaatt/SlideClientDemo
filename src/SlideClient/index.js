/*
 * File: index.js
 * Type: Module Index
 * Exports the SlideClient.
 *
 * Note: There is little validation of
 * function parameters in the client
 * API. Passing invalid parameters or
 * not passing parameters will result
 * in UNDEFINED behavior. To avoid
 * debugging headaches, however, a
 * few common mistakes are checked.
 *
 * Additional Note: A Promise-based
 * interface is available by leaving
 * off any trailing callback parameters
 * and calling functionAsync instead of
 * function for any given function name.
 */

// For sanity.
'use strict';

// Locator prefixes.
const LOGIN_PREFIX = 'login/';
const STREAM_PREFIX = 'stream/';
const LOCKED_PREFIX = 'locked/';
const QUEUE_PREFIX = 'queue/';
const AUTOPLAY_PREFIX = 'autoplay/';
const SUGGESTION_PREFIX = 'suggestion/';

// RPC agent endpoints.
const EDIT_STREAM_SETTINGS = 'edit-stream-settings';
const KEEP_STREAM_ALIVE = 'keep-stream-alive';
const REGISTER_WITH_STREAM = 'register-with-stream';
const DEREGISTER_FROM_STREAM = 'deregister-from-stream';
const CREATE_LIST_TRACK = 'create-list-track';
const MODIFY_STREAM_LISTS = 'modify-stream-lists';
const VOTE_ON_TRACK = 'vote-on-track';
const PLAY_TRACK = 'play-track';

// Various intervals.
const LOGIN_TIMEOUT = 1000;
const KEEP_ALIVE_INTERVAL = 15000;
const INACTIVITY_THRESHOLD = 60000;

// Error objects.
const Errors = {
  already: new Error('You are already logged in to Slide.'),
  auth: new Error('You must authenticate a user first.'),
  busy: new Error('You cannot stream and join a stream at the same time.'),
  callbacks: new Error('Could not instantiate client callbacks.'),
  dead: new Error('You are not part of an active stream.'),
  login: new Error('Could not either establish connection or login.'),
  server: new Error('A remote error occurred.'),
  unknown: new Error('An unknown server error occurred.')
};

/**
 * A generic Node-style callback.
 *
 * @callback requestCallback
 * @param {Error} error - The operation error if any.
 * @param {Object} data - The operation data if any.
 */

// The SlideClient is basically a nice shim over this.
const Deepstream = require('deepstream.io-client-js');

// Used to export promise-compatibility.
var PromisifyAll = require('es6-promisify-all');

/**
 * Constructor for SlideClient. Takes in a
 * server URI, and instantiates SlideClient.
 *
 * @constructor
 * @param {string} serverURI - The URI of the Deepstream server.
 * @param {Function} disconnectCB - Called on disconnect from server.
 */
function SlideClient(serverURI, disconnectCB) {
  let clientObject = this;
  clientObject.client = null;
  clientObject.serverURI = serverURI;
  clientObject.authenticated = false;
  clientObject.hostingStream = false;
  clientObject.joinedStream = null;
  clientObject.enteredStream = false;
  clientObject.streamPing = null;
  clientObject.streamDeadCB = null;
  clientObject.disconnectCB = disconnectCB;
  clientObject.username = null;

  // Closes connection and resets client.
  clientObject.reset = function(callback) {
    // Wait for the closed connection to register.
    clientObject.client.on('connectionStateChanged', state => {
      if (state === Deepstream.CONSTANTS.CONNECTION_STATE.CLOSED) {
        // Reset client properties.
        clientObject.authenticated = false;
        clientObject.hostingStream = false;
        clientObject.joinedStream = null;
        clientObject.enteredStream = false;
        clientObject.streamPing = null;
        clientObject.streamDeadCB = null;
        clientObject.username = null;

        // Reset data callbacks.
        clientObject.streamDataCB = null;
        clientObject.lockedCB = null;
        clientObject.queueCB = null;
        clientObject.autoplayCB = null;
        clientObject.suggestionCB = null;
        clientObject.trackCBS = {};

        // Call disconnect handler.
        clientObject.disconnectCB();
        callback(null, null);
      }
    });

    // Fire the close call.
    clientObject.client.close();
  };

  // Generic Deepstream error handler (private).
  clientObject.errorHandler = function(error, event, topic) {
    // Connection error case.
    if (event === 'connectionError')
      clientObject.reset((error, data) => null);
    // Handle messages being denied on current stream [UNCLEAR IF WORKS].
    else if (error === Deepstream.CONSTANTS.EVENT.MESSAGE_DENIED &&
      clientObject.joinedStream !== null && topic === 'R' &&
      event === STREAM_PREFIX + clientObject.joinedStream) {
      // Leave the stream (no adequate permissions)
      // and implicitly fire the dead CB (first param).
      clientObject.leave(true, (error, data) => true);
    } else {
      // Print any unhandled error.
      console.log('Unhandled Error!');
      console.log('Error:', error);
      console.log('Event:', event);
      console.log('Topic:', topic);
    }
  };

  // Data callbacks for view.
  clientObject.streamDataCB = null;
  clientObject.lockedCB = null;
  clientObject.queueCB = null;
  clientObject.autoplayCB = null;
  clientObject.suggestionCB = null;
  clientObject.trackCBS = {};
};

/**
 * Gets the current state of the SlideClient.
 *
 * @param {requestCallback} callback - Node-style callback for result.
 * @returns {Object} Contains authentication data and stream status.
 */
SlideClient.prototype.getState = function(callback) {
  let clientObject = this;
  const state = {
    username: clientObject.username,
    authenticated: clientObject.authenticated,
    hostingStream: clientObject.hostingStream,
    joinedStream: clientObject.joinedStream
  };

  // Compatibility with Promises.
  if (callback !== undefined)
    callback(null, state);
  else return state;
};

/**
 * Sets view callbacks on stream data.
 *
 * @param {Object} dataCallbacks - A map from properties to callbacks.
 * @param {Function} dataCallbacks.streamData - A callback for new stream data.
 * @param {Function} dataCallbacks.locked - A callback for locked list data.
 * @param {Function} dataCallbacks.queue - A callback for queue list data.
 * @param {Function} dataCallbacks.autoplay - A callback for autoplay list data.
 * @param {Function} dataCallbacks.suggestion - A callback for suggestion list data.
 * @param {requestCallback} callback - Node-style callback for result.
 */
SlideClient.prototype.setStreamCallbacks = function(dataCallbacks, callback) {
  // In this and all subsequent functions, we use this as a fallback.
  if (callback === undefined) callback = (error, data) => null;
  let clientObject = this;

  // Auto-determine the currently playing stream.
  let stream = clientObject.hostingStream ? clientObject.username
                                          : clientObject.joinedStream;

  // No running stream.
  if (stream === null) {
    callback(Errors.dead, null);
    return;
  }

  // Locator names for convenience.
  const streamLocator = STREAM_PREFIX + stream;
  const lockedLocator = LOCKED_PREFIX + stream;
  const queueLocator = QUEUE_PREFIX + stream;
  const autoplayLocator = AUTOPLAY_PREFIX + stream;
  const suggestionLocator = SUGGESTION_PREFIX + stream;

  // The stream record is necessary to fetch the other records.
  const streamRecord = clientObject.client.record.getRecord(streamLocator);

  // Wait for record to be ready.
  streamRecord.whenReady((sRecord) => {
    // Get rid of stream data callback.
    if (clientObject.streamDataCB !== null) {
      sRecord.unsubscribe(clientObject.streamDataCB);
      clientObject.streamDataCB = null;
      sRecord.discard();
    }

    // Install the new one if we can.
    if (dataCallbacks.streamData) {
      clientObject.streamDataCB = (data) => {
        // Unfortunately read permissions in Deepstream are not dynamic.
        if (data.users.indexOf(clientObject.username + ',') === -1) {
          if (clientObject.enteredStream === true) {
            // Leave the stream and implicitly fire the dead CB.
            clientObject.leave(true, (error, data) => true);
            return;
          }
        } else {
          // We use this boolean to make sure the
          // dead CB is not fired before the user
          // was actually added to the stream.
          clientObject.enteredStream = true;
        }

        // TODO: Anything more to add?
        dataCallbacks.streamData(data);
      };

      // Re-add the callback and trigger it.
      sRecord.subscribe(clientObject.streamDataCB, true);
    }

    // Queue, locked, and autoplay are only
    // visible if the stream is not limited.
    if (sRecord.get('limited') === false) {
      // Do the same process for each of the subsidiary lists.
      const lockedRecord = clientObject.client.record.getList(lockedLocator);
      lockedRecord.whenReady((lRecord) => {
        // Get rid of locked callback.
        if (clientObject.lockedCB !== null) {
          lRecord.unsubscribe(clientObject.lockedCB);
          clientObject.lockedCB = null;
          lRecord.discard();
        }

        // Install the new one if we can.
        if (dataCallbacks.locked) {
          clientObject.lockedCB = (data) => {
            // TODO: More stuff goes here.
            dataCallbacks.locked(data);
          };

          // Re-add the callback and trigger it.
          lRecord.subscribe(clientObject.lockedCB, true);
        }
      });

      // Do the same process for each of the subsidiary lists.
      const queueRecord = clientObject.client.record.getList(queueLocator);
      queueRecord.whenReady((qRecord) => {
        // Get rid of queue callback.
        if (clientObject.queueCB !== null) {
          qRecord.unsubscribe(clientObject.queueCB);
          clientObject.queueCB = null;
          qRecord.discard();
        }

        // Install the new one if we can.
        if (dataCallbacks.queue) {
          clientObject.queueCB = (data) => {
            // TODO: More stuff goes here.
            dataCallbacks.queue(data);
          };

          // Re-add the callback and trigger it.
          qRecord.subscribe(clientObject.queueCB, true);
        }
      });

      // Do the same process for each of the subsidiary lists.
      const autoplayRecord = clientObject.client.record
        .getList(autoplayLocator);
      autoplayRecord.whenReady((aRecord) => {
        // Get rid of autoplay callback.
        if (clientObject.autoplayCB !== null) {
          aRecord.unsubscribe(clientObject.autoplayCB);
          clientObject.autoplayCB = null;
          aRecord.discard();
        }

        // Install the new one if we can.
        if (dataCallbacks.autoplay) {
          clientObject.autoplayCB = (data) => {
            // TODO: More stuff goes here.
            dataCallbacks.autoplay(data);
          };

          // Re-add the callback and trigger it.
          aRecord.subscribe(this.autoplayCB, true);
        }
      });
    }

    // Do the same process for each of the subsidiary lists.
    const suggestionRecord = clientObject.client.record
      .getList(suggestionLocator);
    suggestionRecord.whenReady((gRecord) => {
      // Get rid of suggestion callback.
      if (clientObject.suggestionCB !== null) {
        gRecord.unsubscribe(clientObject.suggestionCB);
        clientObject.suggestionCB = null;
        gRecord.discard();
      }

      // Install the new one if we can.
      if (dataCallbacks.suggestion) {
        clientObject.suggestionCB = (data) => {
          // TODO: More stuff goes here.
          dataCallbacks.suggestion(data);
        };

        // Re-add the callback and trigger it.
        gRecord.subscribe(clientObject.suggestionCB, true);
      }
    });

    // TODO: Failures?
    callback(null, null);
  });
};

/**
 * Sets view callbacks on stream track data.
 *
 * @param {Object} addTrackCBS - A map from track locators to callbacks to add.
 * @param {Object} removeTrackCBS - An array of locators to remove callbacks for.
 * @param {requestCallback} callback - Node-style callback for result.
 */
SlideClient.prototype.setTrackCallbacks = function(addTrackCBS,
  removeTrackCBS, callback) {
  if (callback === undefined) callback = (error, data) => null;
  const clientObject = this;
  // Explicitly enforced to avoid bugs.
  if (clientObject.authenticated === false)
    callback(Errors.auth, null);
  // Cannot set track callback if not part of a stream.
  else if (clientObject.hostingStream === false &&
    clientObject.joinedStream === null)
    callback(Errors.dead, null);
  // TODO: Explicitly warn the user if they
  // are about to set invalid callbacks that
  // never actually get set due to MESSAGE_DENIED.
  else {
    // Unsubscribe from tracks in the remove list.
    for (let i = 0; i < removeTrackCBS.length; i++) {
      let locator = removeTrackCBS[i];
      // Make sure locator is still around for sanity.
      if (!(locator in clientObject.trackCBS)) continue;

      const track = clientObject.client.record.getRecord(locator);
      // The callback will remain inactive in trackCBS[locator].
      track.whenReady((tRecord) =>
        tRecord.unsubscribe(clientObject.trackCBS[locator]));
    }

    // Subscribe to tracks in the add list.
    for (let locator in addTrackCBS) {
      const track = clientObject.client.record.getRecord(locator);
      clientObject.trackCBS[locator] = addTrackCBS[locator]
      track.whenReady((tRecord) =>
        tRecord.subscribe(addTrackCBS[locator], true));
    }

    // Assigns happen in background. TODO:
    // Maybe Promisify this function later?
    callback(null, null);
  }
};

/**
 * Logs the user in. This involves sending the login
 * event, and then waiting for confirmation from an
 * event listener on the login event.
 *
 * @param {string} username - Username logging in.
 * @param {string} UUID - UUID for the given username.
 * @param {requestCallback} callback - Node-style callback for result.
 */
SlideClient.prototype.login = function(username, UUID, callback) {
  if (callback === undefined) callback = (error, data) => null;
  let clientObject = this;
  let timeoutTimer;

  // Cannot log in if already logged in.
  if (clientObject.authenticated === true) {
    callback(Errors.already, null);
    return;
  }

  // Called if login successful.
  const loggedIn = (data) => {
    clearTimeout(timeoutTimer);
    clientObject.client.event.unsubscribe(LOGIN_PREFIX + username, loggedIn);
    clientObject.authenticated = true;
    callback(null, null);
  };

  // Called if login times out.
  const loginTimeout = () => {
    clearTimeout(timeoutTimer);
    // Double-check that we did not authenticate. Sometimes
    // the login event fires before we are able to really
    // create the login handler and login timeout callbacks.
    const state = clientObject.client.getConnectionState()
    if (state === Deepstream.CONSTANTS.CONNECTION_STATE.OPEN) {
      clientObject.authenticated = true;
      callback(null, null);
    } else callback(Errors.login, null);
  };

  // Instantiate the quarantined connection to Deepstream.
  clientObject.client = Deepstream(clientObject.serverURI);
  clientObject.client.on('error', clientObject.errorHandler);

  // Authenticate this connection.
  clientObject.username = username;
  clientObject.client.event.subscribe(LOGIN_PREFIX + username, loggedIn);
  timeoutTimer = setTimeout(loginTimeout, LOGIN_TIMEOUT);
  clientObject.client.login({ username: username, UUID: UUID });
};

/**
 * Logs the user out. This function will perform any
 * clean-up that is necessary on joined/hosted streams.
 *
 * @param {requestCallback} callback - Node-style callback for result.
 */
SlideClient.prototype.logout = function(callback) {
  if (callback === undefined) callback = (error, data) => null;
  let clientObject = this;

  // Cannot log out if not already logged in.
  if (clientObject.authenticated === false) {
    callback(Errors.auth, null);
    return;
  }

  // First: Gracefully leave the joined
  // stream or stop hosting the stream.
  new Promise((resolve, reject) => {
    if (clientObject.joinedStream !== null)
      clientObject.leave(false, (error, data) => resolve(data))
    else if (clientObject.hostingStream === true)
      clientObject.stream({ live: false }, {},
        (error, data) => resolve(data));
    else resolve(null);
  })
    .then(() => {
      // Then: Disconnect client.
      return new Promise((resolve, reject) =>
        clientObject.reset((error, data) => resolve(data)));
    })
    // Propagate successful logout.
    .then((data) => callback(null, data));
};

/**
 * Initializes or reinitializes the logged in user
 * stream with the passed parameters. User must have
 * called login() first, or this function will fail.
 *
 * @param {Object} settings - Stream settings object (see below for props).
 * @param {string} settings.live - Toggles whether the stream is running.
 * @param {string} settings.privateMode - Sets stream visibility to private.
 * @param {string} settings.voting - Sets voting on or off for the stream.
 * @param {string} settings.autopilot - Sets autopilot on or off.
 * @param {string} settings.limited - Makes list visibility limited.
 * @param {Object} dataCallbacks - A map from properties to callbacks.
 * @param {Function} dataCallbacks.streamData - A callback for new stream data.
 * @param {Function} dataCallbacks.locked - A callback for locked list data.
 * @param {Function} dataCallbacks.queue - A callback for queue list data.
 * @param {Function} dataCallbacks.autoplay - A callback for autoplay list data.
 * @param {Function} dataCallbacks.suggestion - A callback for suggestion list data.
 * @param {requestCallback} callback - Node-style callback for result.
 */
SlideClient.prototype.stream = function(settings, dataCallbacks, callback) {
  if (callback === undefined) callback = (error, data) => null;
  let clientObject = this;
  // Explicitly enforced to avoid bugs.
  if (clientObject.authenticated === false)
    callback(Errors.auth, null);
  // Cannot host a stream AND be part of one.
  else if (clientObject.joinedStream !== null)
    callback(Errors.busy, null);
  else {
    const keepAliveCall = {
      username: clientObject.username,
      stream: clientObject.username
    };

    const streamCall = {
      username: clientObject.username,
      stream: clientObject.username,
      live: settings.live !== undefined
        ? settings.live : true,
      private: settings.privateMode !== undefined
        ? settings.privateMode : false,
      voting: settings.voting !== undefined
        ? settings.voting : false,
      autopilot: settings.autopilot !== undefined
        ? settings.autopilot : false,
      limited: settings.limited !== undefined
        ? settings.limited : false
    };

    // Make the RPC call to [re]initialize a stream and create CBS.
    clientObject.client.rpc.make(EDIT_STREAM_SETTINGS, streamCall,
      (error, data) => {
      if (error) callback(Errors.server, null);
      else {
        // Start stream keep-alive ping.
        if (!clientObject.hostingStream && settings.live === true) {
          clientObject.hostingStream = true;
          clientObject.streamPing = setInterval(() =>
            clientObject.client.rpc.make(KEEP_STREAM_ALIVE, keepAliveCall,
              (error, data) => true /* TODO: What goes here? */),
          KEEP_ALIVE_INTERVAL);
        }

        // Instantiate the new callbacks passed to stream.
        clientObject.setStreamCallbacks(dataCallbacks, (error, data) => {
          // Disable streaming. This call must come after
          // we set the callbacks, since unsetting the
          // callbacks depends on having a live stream.
          if (settings.live === false) {
            clientObject.hostingStream = false;
            clearInterval(clientObject.streamPing);
            clientObject.streamPing = null;
          }

          if (error) callback(Errors.callbacks, null);
          else callback(null, null);
        });
      }
    });
  }
};

/**
 * Joins a stream and instantiates relevant data callbacks.
 *
 * @param {string} stream - The stream you are trying to join.
 * @param {Object} dataCallbacks - A map from properties to callbacks.
 * @param {Function} dataCallbacks.streamData - A callback for new stream data.
 * @param {Function} dataCallbacks.locked - A callback for locked list data.
 * @param {Function} dataCallbacks.queue - A callback for queue list data.
 * @param {Function} dataCallbacks.autoplay - A callback for autoplay list data.
 * @param {Function} dataCallbacks.suggestion - A callback for suggestion list data.
 * @param {Function} streamDeadCB - Called when the stream goes dead somehow.
 * @param {requestCallback} callback - Node-style callback for result.
 */
SlideClient.prototype.join = function(stream, dataCallbacks, streamDeadCB,
  callback) {
  if (callback === undefined) callback = (error, data) => null;
  if (streamDeadCB === undefined) streamDeadCB = (error, data) => false;
  const clientObject = this;
  // Explicitly enforced to avoid bugs.
  if (clientObject.authenticated === false)
    callback(Errors.auth, null);
  // Cannot host and join at same time.
  else if (clientObject.hostingStream === true)
    callback(Errors.busy, null);
  else {
    const registerCall = {
      username: clientObject.username,
      stream: stream,
      password: 'default'
    };

    // Register with the stream and register any callbacks passed to join.
    clientObject.client.rpc.make(REGISTER_WITH_STREAM, registerCall,
      (error, data) => {
      if (error) callback(Errors.server, null);
      else {
        clientObject.joinedStream = stream;
        // Called on disconnect or loss of permissions.
        clientObject.streamDeadCB = streamDeadCB;

        // Joiner ping is to check activity status.
        clientObject.streamPing = setInterval(() => {
          let locator = STREAM_PREFIX + stream;
          let streamData = clientObject.client.record.getRecord(locator);
          streamData.whenReady((sRecord) => {
            const now = (new Date).getTime();
            // If the stream has been inactive for long enough of a
            // time, call leave on the stream and fire the dead CB.
            if (now - sRecord.get('timestamp') > INACTIVITY_THRESHOLD ||
              sRecord.get('live') === false) // Explicitly dead stream.
              clientObject.leave(true, (error, data) => true);
          });
        }, KEEP_ALIVE_INTERVAL);

        // Register any callbacks passed to join using setStreamCallbacks().
        clientObject.setStreamCallbacks(dataCallbacks, (error, data) => {
          if (error) callback(Errors.callbacks, null);
          else callback(null, null);
        });
      }
    });
  }
}

/**
 * Leaves a stream and uninstantiates relevant data callbacks.
 *
 * @param {boolean} fireDead - Whether to fire the dead callback.
 * @param {requestCallback} callback - Node-style callback for result.
 */
SlideClient.prototype.leave = function(fireDead, callback) {
  if (callback === undefined) callback = (error, data) => null;
  const clientObject = this;
  // You can only leave a stream if you belong to one.
  if (clientObject.joinedStream === null)
    callback(Errors.dead, null);
  else {
    const deregisterCall = {
      username: clientObject.username,
      stream: clientObject.joinedStream
    };

    let CBLocators = Object.keys(clientObject.trackCBS);
    // Remove callbacks and then deregister client from stream.
    clientObject.setStreamCallbacks({}, (error, data) => {
      clientObject.setTrackCallbacks({}, CBLocators, (error, data) => {
        clearInterval(clientObject.streamPing); // Stop the ping.
        clientObject.client.rpc.make(DEREGISTER_FROM_STREAM, deregisterCall,
          (error, data) => {
          if (error) callback(Errors.unknown, null);
          else {
            if (fireDead) clientObject.streamDeadCB();
            clientObject.joinedStream = null;
            clientObject.streamDeadCB = null;
            clientObject.enteredStream = false;
            callback(null, null);
          }
        });
      });
    });
  }
};

/**
 * Creates a track on the server and returns the record locator
 * for the given track.
 *
 * @param {string} URI - Spotify URI for the track.
 * @param {Object} trackData - Spotify track data for the track.
 * @param {requestCallback} callback - Node-style callback for result.
 * @returns {string} A newly-created track locator.
 */
SlideClient.prototype.createTrack = function(URI, trackData, callback) {
  if (callback === undefined) callback = (error, data) => null;
  const clientObject = this;
  // Explicitly enforced to avoid bugs.
  if (clientObject.authenticated === false)
    callback(Errors.auth, null);
  // Cannot stream if not part of a stream.
  else if (clientObject.hostingStream === false &&
    clientObject.joinedStream === null)
    callback(Errors.dead, null);
  // TODO: Should we explicitly make
  // sure that permissions are fine?
  else {
    const trackCall = {
      username: clientObject.username,
      URI: URI, playData: trackData,
      stream: clientObject.hostingStream === true
        ? clientObject.username : clientObject.joinedStream
    };

    // The RPC call will return the newly-created locator.
    clientObject.client.rpc.make(CREATE_LIST_TRACK, trackCall,
      (error, data) => {
      if (error) callback(Errors.server, null);
      else callback(null, data);
    });
  }
};

/**
 * Edit a list for the current stream. Will fail if a racing
 * update beats the given update.
 *
 * @param {string} list - A valid list type.
 * @param {Array} snapshot - The list state prior to the edit.
 * @param {Array} edited - The list state after the edit.
 * @param {requestCallback} callback - Node-style callback for result.
 */
SlideClient.prototype.editStreamList = function(list, snapshot, edited,
  callback) {
  if (callback === undefined) callback = (error, data) => null;
  const clientObject = this;
  // Explicitly enforced to avoid bugs.
  if (clientObject.authenticated === false)
    callback(Errors.auth, null);
  // Cannot edit if not part of a stream.
  else if (clientObject.hostingStream === false &&
    clientObject.joinedStream === null)
    callback(Errors.dead, null);
  // TODO: Should we explicitly make
  // sure that permissions are fine?
  else {
    const editCall = {
      username: clientObject.username,
      stream: clientObject.hostingStream === true
        ? clientObject.username : clientObject.joinedStream,
      list: list, original: snapshot, update: edited
    };

    // The RPC call will return null on success.
    clientObject.client.rpc.make(MODIFY_STREAM_LISTS, editCall,
      (error, data) => {
      if (error) callback(Errors.server, null);
      else callback(null, null);
    });
  }
};

/**
 * Upvotes or downvotes a given track.
 *
 * @param {string} locator - A track locator with the track prefix.
 * @param {boolean} up - True if upvote and false otherwise.
 * @param {string} list - A valid list type.
 * @param {requestCallback} callback - Node-style callback for result.
 */
SlideClient.prototype.voteOnTrack = function(locator, up, list, callback) {
  if (callback === undefined) callback = (error, data) => null;
  const clientObject = this;
  // Explicitly enforced to avoid bugs.
  if (clientObject.authenticated === false)
    callback(Errors.auth, null);
  // Cannot vote if not part of a stream.
  else if (clientObject.hostingStream === false &&
    clientObject.joinedStream === null)
    callback(Errors.dead, null);
  // TODO: Should we explicitly make
  // sure that permissions are fine?
  else {
    const voteCall = {
      username: clientObject.username,
      locator: locator,
      list: list,
      up: up
    };

    // The RPC call will return null on success.
    clientObject.client.rpc.make(VOTE_ON_TRACK, voteCall,
      (error, data) => {
      if (error) callback(Errors.server, null);
      else callback(null, null);
    });
  }
};

/**
 * Plays a track on the stream.
 *
 * @param {string} URI - A valid Spotify track URI.
 * @param {Object} playData - Spotify track data.
 * @param {integer} offset - An offset in seconds from the track start.
 * @param {string} state - Set to either playing or paused.
 * @param {requestCallback} callback - Node-style callback for result.
 */
SlideClient.prototype.playTrack = function(URI, playData, offset, state,
  callback) {
  if (callback === undefined) callback = (error, data) => null;
  const clientObject = this;
  // Explicitly enforced to avoid bugs.
  if (clientObject.authenticated === false)
    callback(Errors.auth, null);
  // Cannot play if not part of a stream.
  else if (clientObject.hostingStream === false &&
    clientObject.joinedStream === null)
    callback(Errors.dead, null);
  // TODO: Should we explicitly make
  // sure that permissions are fine?
  else {
    const playCall = {
      username: clientObject.username,
      stream: clientObject.hostingStream === true
        ? clientObject.username : clientObject.joinedStream,
      state: state, seek: offset, URI: URI, playData: playData
    };

    // The RPC call will return null on success.
    clientObject.client.rpc.make(PLAY_TRACK, playCall,
      (error, data) => {
      if (error) callback(Errors.server, null);
      else callback(null, null);
    });
  }
};

// Export the class (in both NodeBack and Promises).
PromisifyAll(SlideClient.prototype);
module.exports = SlideClient;
