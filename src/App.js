/*
 * File: App.js
 * Type: Component
 * Application logic.
 *
 * Note: This is a terrible way to use
 * React, since ideally every component
 * should be very modular.
 */

import React, { Component } from 'react';
import * as RB from 'react-bootstrap';
import './App.css';

// Socket server client API.
import * as SlideClient from './SlideClient';

// Everything is in a single
// component, which is SAD!
class App extends Component {
  constructor() {
    super();
    this.StreamClient = null;
    this.playTick = null;
    this.defaultState = {
      // Debug info.
      error: null,
      // Input fields.
      server: 'localhost:6020',
      username: '',
      UUID: '',
      stream: '',
      // Connection info.
      clientSet: false,
      loggedIn: false,
      loggingIn: false,
      hosting: false,
      joined: false,
      joining: false,
      // Stream info.
      members: [], // In view: None.
      timestamp: (new Date).getTime(),
      privateMode: false,
      voting: false,
      autopilot: false,
      limited: false,
      // Track state.
      trackName: 'None',
      seek: 0, // Epoch.
      playState: 'Paused',
      // List states.
      lockedActive: false,
      queueActive: false,
      suggestionActive: false,
      autoplayActive: false,
      lockedAdd: '',
      queueAdd: '',
      suggestionAdd: '',
      autoplayAdd: '',
      locked: [],
      queue: [],
      suggestion: [],
      autoplay: [],
      trackData: {}
    };

    // Keep default state around on stream disconnect.
    this.state = Object.assign({}, this.defaultState);
  };

  // CLEANERS
  // Post-logout.
  processLogout() {
    let thisObj = this;
    let server = this.state.server;
    let username = this.state.username;
    let UUID = this.state.UUID;

    this.setState(this.defaultState,
      (data) =>
        thisObj.setState({
          clientSet: true,
          server: server,
          username: username,
          error: 'Disconnect',
          errorMsg: 'Disconnected',
          UUID: UUID
        })
    );
  };

  // Post-stream.
  processStreamDeath(intentional) {
    let thisObj = this;
    return () => {
      let server = thisObj.state.server;
      let username = thisObj.state.username;
      let UUID = thisObj.state.UUID;

      thisObj.setState(thisObj.defaultState,
        (data) =>
          thisObj.setState({
            clientSet: true,
            loggedIn: true,
            server: server,
            username: username,
            error: intentional ? null : 'Dead',
            errorMsg: 'Stream Dead',
            UUID: UUID
          })
      );
    };
  };

  // STATE MUTATORS
  // Set server name.
  setServerName(event) {
    this.setState({ server: event.target.value });
  };

  // Set username.
  setUsername(event) {
    this.setState({ username: event.target.value });
  };

  // Set UUID.
  setUUID(event) {
    this.setState({ UUID: event.target.value });
  };

  // Set stream name.
  setStreamName(event) {
    this.setState({ stream: event.target.value });
  };

  // Set private mode.
  setPrivateMode(event) {
    let thisObj = this;
    this.setState({ privateMode: event.target.checked },
      (data) => thisObj.state.hosting ? thisObj.updateHostedStream() : null);
  };

  // Set voting mode.
  setVotingMode(event) {
    let thisObj = this;
    this.setState({ voting: event.target.checked },
      (data) => thisObj.state.hosting ? thisObj.updateHostedStream() : null);
  };

  // Set autopilot mode.
  setAutopilotMode(event) {
    let thisObj = this;
    this.setState({ autopilot: event.target.checked },
      (data) => thisObj.state.hosting ? thisObj.updateHostedStream() : null);
  };

  // Set limited mode.
  setLimitedMode(event) {
    let thisObj = this;
    this.setState({ limited: event.target.checked },
      (data) => thisObj.state.hosting ? thisObj.updateHostedStream() : null);
  };

  // Set stream data.
  setStreamData(data) {
    let hosting = this.state.hosting;
    let joined = this.state.joined;
    let joining = this.state.joining;

    this.setState({
      members: data.users.slice(0, -1).split(','),
      timestamp: data.timestamp,
      privateMode: data.private,
      voting: data.voting,
      autopilot: data.autopilot,
      limited: data.limited,
      // Track state updates.
      trackName: data.playData !== null
        ? data.playData.name : 'None',
      seek: data.seek !== null ? data.seek : 0,
      playState: data.state !== null
        ? data.state : 'Unknown',
      // List state updates.
      lockedActive: hosting || ((joined || joining) && !data.limited),
      queueActive: hosting || ((joined || joining) && !data.limited),
      suggestionActive: data.voting && !data.autopilot,
      autoplayActive: hosting || ((joined || joining) && !data.limited)
    });
  };

  // Set list add.
  setListAdd(list) {
    let thisObj = this;
    return (event) => {
      thisObj.setState({
        [list + 'Add']: event.target.value
      });
    };
  };

  // Set list data.
  setListData(list) {
    let thisObj = this;
    return (data) => {
      let trackCBS = {}
      data.map((locator) => {
        trackCBS[locator] = thisObj.setTrackData(locator).bind(thisObj);
      });
      thisObj.StreamClient.setTrackCallbacksAsync(trackCBS, [])
        .then(() => thisObj.setState({ [list]: data }));
    };
  };

  // Set track data.
  setTrackData(locator) {
    let thisObj = this;
    return (track) => {
      // TODO: Validate rogue clients...
      let trackData = thisObj.state.trackData;
      trackData[locator] = {
        name: track.playData.name,
        URI: track.URI,
        score: track.score,
        ups: track.up,
        downs: track.down
      }

      thisObj.setState({ trackData: trackData });
    };
  };

  // HANDLER HELPERS
  // Update hosted stream.
  updateHostedStream() {
    let thisObj = this;
    this.StreamClient.streamAsync({
      live: true,
      privateMode: thisObj.state.privateMode,
      voting: thisObj.state.voting,
      autopilot: thisObj.state.autopilot,
      limited: thisObj.state.limited
    }, {
      streamData: thisObj.setStreamData.bind(thisObj),
      locked: thisObj.setListData('locked').bind(thisObj),
      queue: thisObj.setListData('queue').bind(thisObj),
      suggestion: thisObj.setListData('suggestion').bind(thisObj),
      autoplay: thisObj.setListData('autoplay').bind(thisObj)
    })
      .then((data) => {
        thisObj.setState({
          error: null,
          hosting: true,
          stream: thisObj.state.username,
          lockedActive: true,
          queueActive: true,
          suggestionActive: thisObj.state.voting &&
            !thisObj.state.autopilot,
          autoplayActive: true
        });
      })
      .catch((error) =>
          thisObj.setState({ error: 'Host', errorMsg: 'Stream Error' }));
  };

  
  // Update joined stream.
  updateJoinedStream() {
    let thisObj = this;
    thisObj.setState({
      error: null,
      joining: false,
      joined: true
    });
  };

  // INPUT HANDLERS
  // Create stream client.
  createClient() {
    let thisObj = this;

    // Set up SlideClient and write disconnect handler.
    this.StreamClient = new SlideClient(this.state.server,
      () => { thisObj.processLogout() });

    // Action cannot be undone without refresh.
    this.setState({ clientSet: true });
  };

  // Login user.
  loginLogoutUser() {
    let thisObj = this;
    let username = this.state.username;
    let UUID = this.state.UUID;

    if (this.state.loggedIn) {
      this.StreamClient.logoutAsync()
        .then(() => thisObj.processLogout());
    } else {
      this.setState({ loggingIn: true },
        (data) =>
          thisObj.StreamClient.loginAsync(username, UUID)
            .then((data) => {
              thisObj.setState({
                error: null,
                loggingIn: false,
                loggedIn: true
              });
            })
            .catch((error) => {
              thisObj.setState({
                error: 'Login',
                errorMsg: 'Login Error',
                loggingIn: false
              });
            })
      );
    }
  };

  // Host stream.
  hostLeaveStream() {
    let thisObj = this;
    if (this.state.hosting) {
      this.StreamClient.streamAsync({ live: false }, {})
        .then((data) => thisObj.processStreamDeath(true)());
    } else this.updateHostedStream();
  };

  // Join stream.
  joinLeaveStream() {
    let thisObj = this;
    let stream = this.state.stream;

    if (this.state.joined) {
      this.StreamClient.leaveAsync(false)
        .then(() => thisObj.processStreamDeath(true)());
    } else {
      this.setState({ joining: true }, (data) => 
        thisObj.StreamClient.joinAsync(stream, {
          streamData: thisObj.setStreamData.bind(thisObj),
          locked: thisObj.setListData('locked').bind(thisObj),
          queue: thisObj.setListData('queue').bind(thisObj),
          suggestion: thisObj.setListData('suggestion').bind(thisObj),
          autoplay: thisObj.setListData('autoplay').bind(thisObj)
        }, thisObj.processStreamDeath(false).bind(thisObj))
          .then((data) => thisObj.updateJoinedStream())
          .catch((error) =>
            thisObj.setState({
              joining: false,
              error: 'Join',
              errorMsg: 'Join Error'
            })));
    }
  }

  // Add box submit handler.
  submitTrackFor(list) {
    let thisObj = this;
    return (event) => {
      event.preventDefault();
      thisObj.StreamClient.createTrackAsync(
        new Array(37).join('0'), // Dummy URI.
        { name: thisObj.state[list + 'Add'] }
      ).then((locator) => {
        return thisObj.StreamClient.setTrackCallbacksAsync(
          { [locator]: thisObj.setTrackData(locator).bind(thisObj) }, []
        ).then(() => locator);
      }).then((locator) => {
        let listArr = thisObj.state[list];
        let snapshot = listArr.slice();
        listArr.push(locator);

        return thisObj.StreamClient.editStreamListAsync(list, snapshot,
          listArr);
      })
      .then(() => thisObj.setState({ [list + 'Add']: '' }));
    };
  };

  // Generic voting handler.
  vote(locator, list, up) {
    let thisObj = this;
    return (event) => {
      event.preventDefault();
      event.target.blur();
      return thisObj.StreamClient.voteOnTrackAsync(locator, up, list)
        .then((data) => thisObj.setState({ error: null }))
        .catch((error) =>
          thisObj.setState({
            error: 'Vote',
            errorMsg: 'Voting Error'
          }));
    };
  };

  // Track move up handler.
  moveTrackUp(locator, list) {
    let thisObj = this;
    return (event) => {
      event.preventDefault();
      event.target.blur();
      let snapshot = this.state[list].slice()
      let edited = this.state[list].slice()
      let lIndex = snapshot.indexOf(locator);

      if (lIndex == 0) return thisObj.setState({ error: null });
      [edited[lIndex], edited[lIndex - 1]] = [edited[lIndex - 1], edited[lIndex]];
      return thisObj.StreamClient.editStreamListAsync(list, snapshot, edited)
        .then((data) => thisObj.setState({ error: null }))
        .catch((error) =>
          thisObj.setState({
            error: 'Edit',
            errorMsg: 'Edit Error'
          }));
    };
  };

  // Track move handler.
  moveTrack(locator, list, up) {
    let thisObj = this;
    return (event) => {
      event.preventDefault();
      event.target.blur();
      let snapshot = this.state[list].slice()
      let edited = this.state[list].slice()
      let lIndex = snapshot.indexOf(locator);
      let d = up ? -1 : 1;

      // RPC edit call using the edit method.
      [edited[lIndex], edited[lIndex + d]] = [edited[lIndex + d], edited[lIndex]];
      return thisObj.StreamClient.editStreamListAsync(list, snapshot, edited)
        .then((data) => thisObj.setState({ error: null }))
        .catch((error) =>
          thisObj.setState({
            error: 'Edit',
            errorMsg: 'Edit Error'
          }));
    };
  };

  // Track play handler.
  playTrack(locator, list) {
    let thisObj = this;
    return (event) => {
      event.preventDefault();
      event.target.blur();
      let trackData = this.state.trackData[locator];

      // Just in case...
      if (trackData === undefined)
        return thisObj.setState({
          error: 'delay',
          errorMsg: 'Delay Error'
        });

      return thisObj.removeTrack(locator, list)()
        .then((data) => {
          let offset = 0;
          if (thisObj.playTick) clearInterval(thisObj.playTick);
          return thisObj.playTick = setInterval(() => {
            if (offset < 15) {
              offset += 1;
              return thisObj.StreamClient.playTrackAsync(trackData.URI,
                { name: trackData.name }, offset, 'playing');
            } else {
              clearInterval(thisObj.playTick);
              thisObj.playTick = null;
              return thisObj.StreamClient.playTrackAsync(trackData.URI,
                { name: trackData.name }, offset, 'paused');
            }
          }, 1000);
        })
        .then((data) => thisObj.setState({ error: null }))
        .catch((error) =>
          thisObj.setState({
            error: 'Play',
            errorMsg: 'Play Error'
          }));
    };
  };

  // Track remove handler.
  removeTrack(locator, list) {
    let thisObj = this;
    return (event) => {
      if (event !== undefined) {
        event.preventDefault();
        event.target.blur();
      }

      let snapshot = this.state[list].slice()
      let edited = this.state[list].slice()
      edited.splice(snapshot.indexOf(locator), 1);

      // RPC delete call using the edit method.
      return thisObj.StreamClient.editStreamListAsync(list, snapshot, edited)
        .then((data) => thisObj.setState({ error: null }))
        .catch((error) =>
          thisObj.setState({
            error: 'Delete',
            errorMsg: 'Delete Error'
          }));
    };
  };

  // RENDERERS
  // Render add box.
  addTrackFor(list) {
    let active = this.state[list + 'Active'];
    let joined = this.state.joined;

    return (
      <form id={ list + 'Add' } className="addForm"
        onSubmit={ this.submitTrackFor(list).bind(this) }>
        <RB.FormGroup>
          <RB.FormControl type="text" placeholder="Enter track name to add."
            disabled={ !active || (list === 'locked' && joined) }
            value={ this.state[list + 'Add'] }
            onChange={ this.setListAdd(list).bind(this) } />
        </RB.FormGroup>
      </form>
    );
  };

  // Render vote for track in various configurations.
  voteFor(locator, list, disabled, up, symbol) {
    return (
      <span>
        { symbol === '∧' && '\u00a0' }
        <a onClick={ this.vote(locator, list, up).bind(this) } href="#"
          className={ disabled ? 'disabledAnchor' : '' }>
          { symbol }
        </a>
        { symbol === '∨' && '\u00a0' }
      </span>
    );
  };

  // Render each track.
  trackFor(locator, idx, list) {
    let trackData = this.state.trackData[locator];
    let trackName, trackScore, index, inState;
    let doVote = (list === 'queue' && this.state.voting && this.state.autopilot) ||
      (list === 'suggestion' && this.state.voting && !this.state.autopilot)

    // Might not have subscribed to
    // the appropriate callback yet.
    if (trackData !== undefined) {
      trackName = trackData.name;
      trackScore = trackData.score;
      index = idx.toString();
      inState = trackData.ups.indexOf(this.state.username) !== -1 ? 'up'
        : (trackData.downs.indexOf(this.state.username) !== -1 ? 'down'
          : 'neutral');
    } else {
      trackName = 'Unknown Track';
      trackScore = 0;
      index = idx.toString();
    }

    let editDisabled = (list === 'locked' && !this.state.hosting) ||
      (this.state.voting && !this.state.hosting)
    let moveDisabled = editDisabled ||
      (list === 'queue' && this.state.voting && this.state.autopilot) ||
      (list === 'suggestion' && this.state.voting && !this.state.autopilot)
    let moveUpDisabled = moveDisabled ||
      this.state[list].indexOf(locator) == 0;
    let moveDownDisabled = moveDisabled ||
      (this.state[list].indexOf(locator) ==
        this.state[list].length - 1);

    // This code is a piece of absolute
    // shit. Do not reuse if you love
    // puppies of any kind.
    return (
      <tr>
        <td>{ index }</td>
        <td>{ trackName }</td>
        <td>
          { !doVote
            ? this.voteFor(locator, list, true, false, '∨')
            : (inState === 'up'
              ? this.voteFor(locator, list, false, true, '∨')
              : (inState === 'neutral'
                ? this.voteFor(locator, list, false, false, '∨')
                : this.voteFor(locator, list, true, false, '∨'))) }
          { trackScore >= 0 ? '+' + trackScore.toString() : trackScore }
          { !doVote
            ? this.voteFor(locator, list, true, true, '∧')
            : (inState === 'down'
              ? this.voteFor(locator, list, false, false, '∧')
              : (inState === 'neutral'
                ? this.voteFor(locator, list, false, true, '∧')
                : this.voteFor(locator, list, true, true, '∧'))) }
        </td>
        <td>
          <a onClick={ this.moveTrack(locator, list, true).bind(this) } href="#"
            className={ moveUpDisabled ? 'disabledAnchor' : '' }>&and;</a>&nbsp;
          <a onClick={ this.moveTrack(locator, list, false).bind(this) } href="#"
            className={ moveDownDisabled ? 'disabledAnchor' : '' }>&or;</a>&nbsp;
          <a onClick={ this.playTrack(locator, list).bind(this) } href="#"
            className={ editDisabled ? 'disabledAnchor' : '' }>&sim;</a>&nbsp;
          <a onClick={ this.removeTrack(locator, list).bind(this) } href="#"
            className={ editDisabled ? 'disabledAnchor' : '' }>&empty;</a>
        </td>
      </tr>
    );
  };

  // Render each list.
  tableFor(list) {
    let thisObj = this;
    let addOrderList = this.state[list];
    let scoreOrderList = this.state[list].slice();
    scoreOrderList.sort((a, b) => {
      let aTrackData = thisObj.state.trackData[a];
      let bTrackData = thisObj.state.trackData[b];
      let aScore = aTrackData !== undefined ? aTrackData.score : 0;
      let bScore = bTrackData !== undefined ? bTrackData.score : 0;
      return bScore - aScore;
    });

    return (
      <RB.Table id={list} className="list" bordered hover>
        <thead>
          <tr>
            <th>#</th>
            <th>Track Name</th>
            <th>Score</th>
            <th>Move</th>
          </tr>
        </thead>
        <tbody>
          { !(list === 'queue' && this.state.voting && this.state.autopilot) &&
            !(list === 'suggestion' && this.state.voting && !this.state.autopilot)
              ? addOrderList.map((locator, idx) => this.trackFor(locator, idx, list))
              : scoreOrderList.map((locator, idx) => this.trackFor(locator, idx, list)) }
          <tr> 
            <td colSpan={4} className="addContainer">
              { this.addTrackFor(list) }
            </td>
          </tr>
        </tbody>
      </RB.Table>
    );
  };

  // Render each setting.
  settingsInputs() {
    let clientSet = this.state.clientSet;
    let loggedIn = this.state.loggedIn;
    let hosting = this.state.hosting;
    let joined = this.state.joined;

    let server = this.state.server;
    let username = this.state.username;
    let UUID = this.state.UUID;
    let stream = this.state.stream;

    let privateMode = this.state.privateMode;
    let voting = this.state.voting;
    let autopilot = this.state.autopilot;
    let limited = this.state.limited;

    return (
      <form id="settingsInputs">
        <RB.FormGroup>
          <RB.FormControl type="text" id="serverName" placeholder="Enter server name." autoComplete="off"
            value={ server } disabled={ clientSet } onChange={ this.setServerName.bind(this) } />
          <RB.FormControl type="text" id="username" placeholder="Enter username." autoComplete="off"
            value={ username } disabled={ !clientSet || loggedIn } onChange={ this.setUsername.bind(this) } />
          <RB.FormControl type="text" id="UUID" placeholder="Enter UUID." autoComplete="off"
            value={ UUID } disabled={ !clientSet || loggedIn } onChange={ this.setUUID.bind(this) } />
          <RB.FormControl type="text" id="streamName" placeholder="Enter stream name." autoComplete="off"
            value={ stream } disabled={ !loggedIn || hosting || joined }
            onChange={ this.setStreamName.bind(this) } />
          <RB.FormGroup id="streamOptions">
            <RB.Checkbox id="privateMode" disabled={ !loggedIn || joined }
              checked={ privateMode } onChange={ this.setPrivateMode.bind(this) } inline>
              Private
            </RB.Checkbox>
            <RB.Checkbox id="votingMode" disabled={ !loggedIn || joined }
              checked={ voting } onChange={ this.setVotingMode.bind(this) } inline>
              Voting
            </RB.Checkbox><br />
            <RB.Checkbox id="autopilotMode" disabled={ !loggedIn || joined }
              checked={ autopilot } onChange={ this.setAutopilotMode.bind(this) } inline>
              Autopilot
            </RB.Checkbox>
            <RB.Checkbox id="limitedMode" disabled={ !loggedIn || joined }
              checked={ limited } onChange={ this.setLimitedMode.bind(this) } inline>
              Limited
            </RB.Checkbox>
          </RB.FormGroup>
        </RB.FormGroup>
      </form>
    );
  };

  // Render stream state.
  stateIndicators() {
    let trackName = this.state.trackName;
    let seek = this.state.seek;
    let playState = this.state.playState;
    let members = this.state.members;
    let timestamp = new Date(this.state.timestamp);

    playState = playState[0].toUpperCase() + playState.slice(1);
    timestamp = timestamp.toUTCString().substr(4)

    let mins = ((seek - (seek % 60)) / 60).toString();
    let secs = (seek % 60).toString(); // May be one digit.
    if (secs.length == 1) secs = '0' + secs;

    let memStr = members.length > 0
      ? members.join(', ') : 'None'

    return (
      <RB.Col md={6}>
        <h3>Current Track:</h3>
        <span id="currentTrack">{ trackName }</span>&nbsp;
        <span id="seek">({ mins }:{ secs })</span><br />
        [<span id="playState">{ playState }</span>]
        <h3>Who's Here:</h3>
        <span id="members">{ memStr }</span>.
        <h3>Timestamp:</h3>
        <span id="timestamp">{ timestamp }</span>.
      </RB.Col>
    );
  };

  // Render buttons.
  buttons() {
    let clientSet = this.state.clientSet;
    let loggedIn = this.state.loggedIn;
    let loggingIn = this.state.loggingIn;
    let hosting = this.state.hosting;
    let joined = this.state.joined;

    return (
      <div>
        <RB.Button id="createClient" bsStyle="danger" disabled={ clientSet }
          onClick={ this.createClient.bind(this) }>
          Create Client
        </RB.Button>&nbsp;
        <RB.Button id="loginLogout" bsStyle="info" disabled={ !clientSet || loggingIn }
          onClick={ this.loginLogoutUser.bind(this) }>
          { loggingIn ? 'Logging In...' : (loggedIn ? 'Logout User' : 'Login User') }
        </RB.Button><br />
        <RB.Button id="hostStream" bsStyle="success" disabled={ joined || !loggedIn }
          onClick={ this.hostLeaveStream.bind(this) }>
            { hosting ? 'Leave' : 'Host' } Stream
        </RB.Button>&nbsp;
        <RB.Button id="joinStream" bsStyle="primary" disabled={ hosting || !loggedIn }
          onClick={ this.joinLeaveStream.bind(this) }>
            { joined ? 'Leave Stream' : 'Join Stream' }
        </RB.Button>
      </div>
    );
  };

  // Render grid.
  gridLayout() {
    return (
      <div className="App">
        <RB.Grid fluid>
          <RB.Row id="header">
            <RB.Col md={12}><h2>Slide Client API Demo</h2></RB.Col>
          </RB.Row>

          <RB.Row>
            <RB.Col md={2}>
              <RB.Label bsStyle={this.state.lockedActive ? 'success' : 'primary'}>
                Locked Queue List
              </RB.Label>
              { this.tableFor('locked') }
            </RB.Col>
            <RB.Col md={2}>
              <RB.Label bsStyle={this.state.queueActive ? 'success' : 'primary'}>
                Queue List
              </RB.Label>
              { this.tableFor('queue') }
            </RB.Col>
            <RB.Col md={2}>
              <RB.Label bsStyle={this.state.suggestionActive ? 'success' : 'primary'}>
                Suggestion List
              </RB.Label>
              { this.tableFor('suggestion') }
            </RB.Col>
            <RB.Col md={2}>
              <RB.Label bsStyle={this.state.autoplayActive ? 'success' : 'primary'}>
                Autoplay List
              </RB.Label>
              { this.tableFor('autoplay') }
            </RB.Col>
            <RB.Col md={4}>
              <RB.Row>
              { this.stateIndicators() }
                <RB.Col md={6}>
                  { this.buttons() }
                  { this.settingsInputs() }
                  <RB.Label id="errorState" bsStyle={ this.state.error === null ? 'success' : 'primary' }>
                    { this.state.error !== null ? this.state.errorMsg : 'No Errors' }
                  </RB.Label>
                </RB.Col>
              </RB.Row>
            </RB.Col>
          </RB.Row>
        </RB.Grid>
      </div>
    );
  };

  // Main call.
  render() {
    return this.gridLayout();
  };
};

// Weird React syntax.
export default App;
