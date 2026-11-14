'use client';

import { useEffect, useState } from 'react';
import { start } from '@/lib/game';
import { createRoom, joinRoom, leaveRoom } from '@/lib/net/signaling';
import { clearSession, loadSession, saveSession } from '@/lib/net/session';

// lib/game.js's start() is not idempotent (it creates a WebGL renderer on #c
// and registers window listeners) and has no unmount cleanup, so guard the
// mount to guarantee the world boots exactly once even under dev HMR remounts.
let booted = false;

export default function Game() {
  const [mpName, setMpName] = useState('');
  const [mpCode, setMpCode] = useState('');
  const [mpStatus, setMpStatus] = useState('');
  const [mpBusy, setMpBusy] = useState(false);
  const [mpSession, setMpSession] = useState(null);

  useEffect(() => {
    if (booted) return;
    booted = true;
    start();
  }, []);

  useEffect(() => {
    setMpSession(loadSession());
    const code = new URLSearchParams(window.location.search).get('join');
    if (code) {
      const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (normalized) {
        setMpCode(normalized);
        setMpStatus('Invite code filled in — enter your name and join.');
        setTimeout(() => document.getElementById('mpName')?.focus(), 120);
      }
    }
  }, []);

  async function hostRoom() {
    if (mpBusy) return;
    setMpBusy(true);
    setMpStatus('Creating room…');
    try {
      const data = await createRoom(mpName.trim() || 'Host', 6);
      saveSession({
        room: data.code,
        seed: data.seed,
        role: 'host',
        peerId: data.peerId,
        token: data.token,
        hostPeerId: data.hostPeerId,
        name: data.name || mpName.trim() || 'Host',
        maxPlayers: data.maxPlayers || 6,
      });
      window.location.href = '/?mp=1';
    } catch (err) {
      setMpStatus('Could not create room: ' + (err.code || err.message || 'unknown error'));
      setMpBusy(false);
    }
  }

  async function join() {
    if (mpBusy) return;
    const code = mpCode.trim().toUpperCase();
    if (!code) {
      setMpStatus('Enter a room code first.');
      return;
    }
    setMpBusy(true);
    setMpStatus('Joining ' + code + '…');
    try {
      const data = await joinRoom(code, mpName.trim() || 'Player');
      saveSession({
        room: data.code,
        seed: data.seed,
        role: 'client',
        peerId: data.peerId,
        token: data.token,
        hostPeerId: data.hostPeerId,
        name: data.name || mpName.trim() || 'Player',
        maxPlayers: data.maxPlayers || 6,
      });
      window.location.href = '/?mp=1';
    } catch (err) {
      setMpStatus('Could not join: ' + (err.code || err.message || 'unknown error'));
      setMpBusy(false);
    }
  }

  function resume() {
    window.location.href = '/?mp=1';
  }

  function leave() {
    const session = mpSession || loadSession();
    if (session) leaveRoom(session);
    clearSession();
    setMpSession(null);
    setMpStatus('Left the room. Reloading…');
    window.location.href = '/';
  }

  return (
    <>
      <canvas id="c" aria-label="First-person 3D pasture" />
      <div id="flash" />

      <div id="hud" hidden>
        <div className="row" id="stats">
          <div className="pill stat" id="hpPill" title="Your hearts">
            <span className="k">HP</span>
            <span id="hearts" />
          </div>
          <div
            className="pill stat"
            id="foodPill"
            title="Hunger — punch any animal with E, then eat the meat with F"
          >
            <span className="k">Food</span>
            <span id="hunger" />
          </div>
          <div className="pill stat" id="foundPill" title="Kinds of creatures you have lifted or ridden">
            <span className="k">Found</span>
            <b id="foundN">0/13</b>
          </div>
          <div className="pill stat" id="timePill" title="Time of day">
            <span className="k">Time</span>
            <b id="timeN">07:12 Morning</b>
          </div>
          <div className="pill stat" id="compassPill" title="Compass direction">
            <span className="k">Dir</span>
            <b id="compassDir">N</b>
            <div id="compassNeedle">↑</div>
          </div>
          <div className="pill stat" id="netPill" title="Multiplayer room" hidden>
            <span className="k">Room</span>
            <b id="netRoom">—</b>
          </div>
          <button className="pill" id="inviteBtn" type="button" title="Invite players — code, link and QR (I)" hidden>
            INVITE
          </button>
          <div
            className="pill stat"
            id="ammoPill"
            title="Weapon ammo — 1 pistol, 2 shotgun, 3 rifle, 4 AK-47"
            hidden
          >
            <span className="k" id="gunName">Pistol</span>
            <b id="ammoN">12</b>
          </div>
          <div className="pill stat" id="flyPill" title="Admin flight is on — look up and press W to climb" hidden>
            <b>FLY</b>
          </div>
          <button className="pill" id="adminBtn" type="button" title="Open the admin panel (P)" hidden>
            ADMIN
          </button>
        </div>
        <div id="cross" />
        <div id="mobhp" hidden>
          <div className="mline">
            <b id="mobName">Cow</b>
            <span id="mobHpN">3/3</span>
          </div>
          <div id="mobbar">
            <i id="mobfill" />
          </div>
        </div>
        <div id="toast" />
        <div id="prompt" />
        <div id="touch">
          <div id="stick">
            <div id="knob" />
          </div>
          <button className="act" id="btnGrab" type="button">
            LIFT
          </button>
          <button className="act" id="btnJump" type="button">
            JUMP
          </button>
          <button className="act" id="btnPunch" type="button">
            PUNCH
          </button>
        </div>
      </div>

      <div className="wrap" id="loadingMenu">
        <div className="card" style={{ textAlign: 'center' }} role="status" aria-label="Loading world">
          <span className="spinner" />
        </div>
      </div>

      <div className="wrap" id="menu" hidden>
        <div className="card">
          <h1>Grasshopper Pasture 🦗</h1>
          <div className="mpPanel" hidden={process.env.NEXT_PUBLIC_MULTIPLAYER === '0'}>
            <h2>Play with friends</h2>
            <div className="mpRow">
              <input
                id="mpName"
                className="mpInput"
                value={mpName}
                onChange={(e) => setMpName(e.target.value)}
                placeholder="Your name"
                maxLength={20}
                autoComplete="off"
                spellCheck={false}
              />
              <input
                id="mpCode"
                className="mpInput"
                value={mpCode}
                onChange={(e) => setMpCode(e.target.value.toUpperCase())}
                placeholder="Room code"
                maxLength={6}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="mpRow">
              <button className="btn mpBtn" id="mpHost" type="button" onClick={hostRoom} disabled={mpBusy}>
                Host room
              </button>
              <button className="btn mpBtn" id="mpJoin" type="button" onClick={join} disabled={mpBusy}>
                Join room
              </button>
            </div>
            <p className="mpStatus" id="mpStatus" role="status">
              {mpStatus}
            </p>
            {mpSession ? (
              <div className="mpRow">
                <button className="btn mpBtn" type="button" onClick={resume}>
                  Resume {mpSession.room}
                </button>
                <button className="btn mpBtn ghost" type="button" onClick={leave}>
                  Leave room
                </button>
              </div>
            ) : null}
          </div>

          <div className="genderPick">
            <div className="genderQ" id="genderQ">
              What&apos;s your gender?
            </div>
            <div className="genderRow" role="group" aria-labelledby="genderQ">
              <button className="genderBtn" data-gender="unknown" type="button" aria-pressed="false">
                <span className="gFace" aria-hidden="true">
                  ?
                </span>
                <span className="gTag">Unknown</span>
                <span className="gSub">? skin</span>
              </button>
              <button className="genderBtn" data-gender="female" type="button" aria-pressed="false">
                <span className="gFace" aria-hidden="true">
                  ♀
                </span>
                <span className="gTag">Female</span>
                <span className="gSub">girl</span>
              </button>
              <button className="genderBtn" data-gender="male" type="button" aria-pressed="false">
                <span className="gFace" aria-hidden="true">
                  ♂
                </span>
                <span className="gTag">Male</span>
                <span className="gSub">boy</span>
              </button>
            </div>
          </div>
          <button className="btn" id="play" type="button">
            Start exploring
          </button>
        </div>
      </div>

      <div className="wrap" id="adminPanel" hidden>
        <div className="card adminCard">
          <h1>Admin</h1>
          <p className="adminHint">
            Admin unlocked — everything is yours. Press <kbd>F2</kbd> or <kbd>P</kbd> to open this panel.
            Spawn any creature or item, grant every weapon and food, teleport to every biome, lift anything,
            turn on Never Die, and one-shot every animal. Press <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>{' '}
            <kbd>4</kbd> to switch guns, <kbd>E</kbd> or right-click to fire. Flight: <kbd>V</kbd>, then look
            up and hold <kbd>W</kbd> to climb. Aim first, then open this panel: spawned things and the tornado
            land at your crosshair. Tornadoes lift animals and will carry you to the top. Turn Lift Everything
            off to open chests or eat meat.
          </p>
          <p className="adminMsg" id="adminMsg" />
          <div className="adminGrid">
            <button className="abtn" id="abGuns" type="button">
              All Weapons + Ammo
            </button>
            <button className="abtn" id="abAllFood" type="button">
              All Food + Meat
            </button>
            <button className="abtn" id="abHeal" type="button">
              Heal Hearts
            </button>
            <button className="abtn" id="abFeed" type="button">
              Fill Hunger
            </button>
            <button className="abtn" id="abGod" type="button">
              Never Die: OFF
            </button>
            <button className="abtn" id="abOneShot" type="button">
              One-Shot Kill: OFF
            </button>
            <button className="abtn" id="abKillAll" type="button">
              Kill All Animals
            </button>
            <button className="abtn" id="abInf" type="button">
              Infinite Ammo: OFF
            </button>
            <button className="abtn" id="abFly" type="button">
              Fly: OFF
            </button>
            <button className="abtn" id="abLift" type="button">
              Lift Everything: OFF
            </button>
            <button className="abtn" id="abNight" type="button">
              Make It Night
            </button>
            <button className="abtn" id="abDay" type="button">
              Make It Day
            </button>
            <button className="abtn" id="abTornado" type="button">
              Start Tornado
            </button>
            <button className="abtn" id="abTornadoHere" type="button">
              Tornado Here
            </button>
            <button className="abtn" id="abChest" type="button">
              Spawn Chest
            </button>
            <button className="abtn" id="abDesert" type="button">
              Teleport: Desert
            </button>
            <button className="abtn" id="abSnow" type="button">
              Teleport: Snowfield
            </button>
            <button className="abtn" id="abSavanna" type="button">
              Teleport: Savanna
            </button>
            <button className="abtn" id="abHome" type="button">
              Teleport: Home
            </button>
          </div>
          <div className="adminRow">
            <label htmlFor="abKind">Spawn anything</label>
            <select id="abKind">
              <option value="everything">EVERYTHING (one of each)</option>
              <option value="cow">Cow</option>
              <option value="bull">Bull</option>
              <option value="sheep">Sheep</option>
              <option value="chicken">Chicken</option>
              <option value="bunny">Bunny</option>
              <option value="horse">Horse</option>
              <option value="deer">Deer</option>
              <option value="bear">Bear</option>
              <option value="wolf">Wolf</option>
              <option value="camel">Camel</option>
              <option value="cobra">Cobra</option>
              <option value="snake">Snake</option>
              <option value="penguin">Penguin</option>
              <option value="snowbear">Snow Bear</option>
              <option value="lion">Lion</option>
              <option value="tiger">Tiger</option>
              <option value="elephant">Elephant</option>
              <option value="zebra">Zebra</option>
              <option value="meerkat">Meerkat</option>
              <option value="locust">Locust</option>
              <option value="cat">Cat</option>
              <option value="dog">Dog</option>
              <option value="hopper">Grasshopper</option>
              <option value="fish">Fish</option>
              <option value="bee">Bee</option>
              <option value="bird">Bird</option>
              <option value="ant">Ant</option>
              <option value="human">Human</option>
              <option value="farmer">Farmer</option>
              <option value="traveler">Traveler</option>
              <option value="bale">Hay Bale</option>
              <option value="rock">Rock</option>
              <option value="barrel">Barrel</option>
              <option value="chest">Loot Chest</option>
              <option value="meat">Meat</option>
              <option value="sword">Sword</option>
              <option value="pistol">Pistol</option>
              <option value="shotgun">Shotgun</option>
              <option value="rifle">Rifle</option>
              <option value="ak47">AK-47</option>
            </select>
            <button className="abtn" id="abSpawn" type="button">
              Spawn it
            </button>
            <button className="abtn" id="abSpawnAll" type="button">
              Spawn EVERYTHING
            </button>
          </div>
          <div className="adminRow">
            <button className="abtn" id="abHolster" type="button">
              Draw / Holster Guns
            </button>
          </div>
          <button className="abtn close" id="abClose" type="button">
            Back to the pasture
          </button>
        </div>
      </div>

      <div className="wrap" id="cheatBox" hidden>
        <div className="card cheatCard">
          <h1>Enter Code</h1>
          <p className="adminHint">Enter the admin code to unlock admin powers.</p>
          <input
            id="cheatInput"
            className="cheatIn"
            type="password"
            placeholder="Enter code"
            maxLength="24"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <p className="adminMsg" id="cheatMsg" />
          <div className="cheatRow">
            <button className="btn" id="cheatGo" type="button">
              Unlock
            </button>
            <button className="btn" id="cheatCancel" type="button">
              Close (Esc)
            </button>
          </div>
        </div>
      </div>

      <div className="wrap" id="invitePanel" hidden>
        <div className="card inviteCard">
          <h1>Invite players</h1>
          <p className="mpNote">
            Share the code or link. The host&apos;s browser runs the world, so keep this tab open and
            visible while you play.
          </p>
          <div className="inviteCode" id="inviteCode">
            —
          </div>
          <p className="mpNote" id="inviteHint" />
          <div className="inviteLinkRow">
            <input id="inviteLink" className="mpInput inviteLink" readOnly value="" aria-label="Invite link" />
            <button className="btn mpBtn" id="inviteCopy" type="button">
              Copy
            </button>
          </div>
          <div className="mpRow">
            <button className="btn mpBtn" id="inviteShare" type="button">
              Share
            </button>
            <button className="btn mpBtn ghost" id="inviteClose" type="button">
              Back
            </button>
          </div>
          <div className="inviteQrBox">
            <canvas id="inviteQr" width="220" height="220" aria-label="Invite QR code" />
          </div>
          <p className="mpNote invitePlayersLabel">Players</p>
          <div className="invitePlayers" id="invitePlayers" />
          <div className="mpRow">
            <button className="btn mpBtn ghost" id="inviteCloseRoom" type="button">
              Leave room
            </button>
          </div>
        </div>
      </div>

      <div className="wrap" id="webglError" hidden>
        <div className="card">
          <h1>3D graphics unavailable</h1>
          <p id="webglErrorMsg">
            This browser could not create a WebGL context. The game needs WebGL to render its
            world.
          </p>
          <p className="mpNote">
            Try enabling hardware acceleration in the browser settings, updating the browser or
            graphics driver, closing other 3D tabs/games, or opening the page in Chrome, Edge or
            Firefox. After changing a setting, reload this page.
          </p>
          <div className="mpRow">
            <button className="btn mpBtn" id="webglRetry" type="button">
              Reload
            </button>
          </div>
        </div>
      </div>

      <div className="wrap" id="netLost" hidden>
        <div className="card">
          <h1>Connection lost</h1>
          <p id="netLostMsg" className="mpNote">
            Trying to reach the host…
          </p>
          <div className="mpRow">
            <button className="btn mpBtn" id="netRetryBtn" type="button">
              Reconnect
            </button>
            <button className="btn mpBtn ghost" id="netLeaveBtn" type="button">
              Leave room
            </button>
          </div>
        </div>
      </div>

      <div className="wrap" id="deathMenu" hidden>
        <div className="card deathCard">
          <h1>You Collapsed</h1>
          <p id="deathMsg">Your hearts ran out.</p>
          <button className="btn" id="respawnBtn" type="button">
            Respawn
          </button>
        </div>
      </div>
    </>
  );
}
