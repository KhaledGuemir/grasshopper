'use client';

import { useEffect } from 'react';
import { start } from '@/lib/game';

// lib/game.js's start() is not idempotent (it creates a WebGL renderer on #c
// and registers window listeners) and has no unmount cleanup, so guard the
// mount to guarantee the world boots exactly once even under dev HMR remounts.
let booted = false;

export default function Game() {
  useEffect(() => {
    if (booted) return;
    booted = true;
    start();
  }, []);

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
        <div className="card" style={{ textAlign: 'center' }}>
          <h1>Loading World...</h1>
          <p>Generating terrain, cities, and wildlife.</p>
          <span className="spinner" />
        </div>
      </div>

      <div className="wrap" id="menu" hidden>
        <div className="card">
          <h1>Grasshopper Pasture</h1>
          <p>
            Walk the pasture in first person, lift animals (sheep, chickens, bunnies, and more!), explore the
            sprawling cities with modern wind turbines, ride horses, camels and bulls. Every house has an open
            door — walk right in, and the downtown skyscrapers are open too: step into the lobby and take the
            lift (<kbd>F</kbd> up, <kbd>G</kbd> down) to any of their many floors. Follow the beach west to the
            sun-baked desert island, home to camels you can ride and striking cobras — while slender green snakes
            slither through the home pasture — south to the golden savanna, where lions and tigers prowl,
            elephants and zebras roam, meerkats keep watch and locusts leap and buzz, or north to the frozen
            snowfield island where penguins waddle and polar bears prowl. Watch your ten hearts: a bull&apos;s
            charge costs 7, a tiger&apos;s bite 5, a bear&apos;s or polar bear&apos;s maul 5, a lion&apos;s swipe
            4, a wolf&apos;s bite 3, a cobra&apos;s strike 2, a snake&apos;s bite 1. Grasshoppers are ant-sized
            now, and bears sleep by day — bears and gray wolves only come out at night. Log every kind of
            creature in your field notes.
          </p>
          <p>
            <b>Hunting:</b> your fist is always ready — punch any animal you meet: cows, sheep and chickens, but
            also deer, camels, bears, wolves, lions, tigers, elephants, zebras, cobras and snakes. Press{' '}
            <kbd>E</kbd> (or right click), then walk to the dropped meat and press <kbd>F</kbd> to eat it and
            refill your hunger. The bull is a 100 HP tank — bring a gun or a sword. Your ten-point hunger bar
            drains as the day goes by: when it hits zero you start losing hearts, and when your hearts run out
            you collapse.
          </p>
          <p>
            <b>Loot chests:</b> wooden chests are hidden inside the villages — search around the houses and
            skyscrapers, walk up and press <kbd>F</kbd> to open one. They hold food, swords, guns, and sometimes
            a rare <b>AK-47</b>.
          </p>
          <dl className="keys">
            <dt>Move</dt>
            <dd>
              <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>, <kbd>Shift</kbd> to run
            </dd>
            <dt>Jump</dt>
            <dd>
              <kbd>Space</kbd>
            </dd>
            <dt>Look</dt>
            <dd>Move mouse (click to lock) or drag screen</dd>
            <dt>View</dt>
            <dd>
              <kbd>F3</kbd> switch between first person and seeing your avatar
            </dd>
            <dt>Action</dt>
            <dd>
              <kbd>F</kbd> or click to Lift/Feed/Ride/Eat
            </dd>
            <dt>Punch</dt>
            <dd>
              <kbd>E</kbd> or right click to hit any animal — cow, sheep, chicken, deer, bear, wolf, lion, tiger,
              cobra, snake…
            </dd>
            <dt>Guns</dt>
            <dd>
              Once found: <kbd>1</kbd>–<kbd>4</kbd> switch weapons, <kbd>E</kbd> or right-click to fire (hold for
              AK-47 full-auto)
            </dd>
          </dl>
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
            turn on god mode, and one-shot every animal. Press <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>{' '}
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
              God Mode: OFF
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
