/* Browser integration test for the co-op vertical slice.
 *
 * Uses the installed Chrome (playwright-core, no bundled browser) against the
 * local Next dev server. Run with:
 *   node tests/browser.mjs
 * while `npm run dev` is running on :3000.
 */
import { chromium } from 'playwright-core';

const CHROME =
  process.env.CHROME_PATH ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : '/usr/bin/google-chrome');
const URL = process.env.GAME_URL || 'http://localhost:3000/';

function log(...args) {
  console.log('[browser]', ...args);
}

async function waitForNet(page, predicate, timeout = 30000) {
  await page.waitForFunction(predicate, null, { timeout });
}

async function main() {
  let browser = null;
  try {
    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--enable-unsafe-swiftshader',
        '--use-angle=swiftshader',
      ],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await context.newPage();
  const client = await context.newPage();

  const errors = [];
  for (const [name, page] of [
    ['host', host],
    ['client', client],
  ]) {
    page.on('pageerror', (err) => {
      errors.push(`${name}: ${err.message}`);
      console.log('[browser]', name, 'pageerror', err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().includes('[net]')) {
        console.log('[browser]', name, 'net warning', msg.text());
      }
      if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
        errors.push(`${name} console: ${msg.text()}`);
        console.log('[browser]', name, 'console error', msg.text());
      }
    });
  }

  log('opening host page');
  await host.goto(URL, { waitUntil: 'domcontentloaded' });
  await host.waitForSelector('#menu:not([hidden])', { timeout: 60000 });
  await host.click('.genderBtn[data-gender="female"]');
  const pickedGender = await host.evaluate(() => ({
    pressed: document.querySelector('.genderBtn[data-gender="female"]')?.getAttribute('aria-pressed'),
    stored: localStorage.getItem('grasshopperGender'),
    deathMenu: !!document.getElementById('deathMenu'),
  }));
  log('avatar picker', JSON.stringify(pickedGender));
  if (pickedGender.pressed !== 'true' || pickedGender.stored !== 'female') {
    throw new Error('avatar picker did not persist the selection');
  }
  if (!pickedGender.deathMenu) throw new Error('respawn menu is missing');
  await host.fill('#mpName', 'HostTest');
  log('creating room');
  await Promise.all([
    host.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
    host.click('#mpHost'),
  ]);
  await host.waitForSelector('#hud:not([hidden])', { timeout: 60000 });
  await host.waitForFunction(() => window.__GH_NET__?.role === 'host' && !!window.__GH_NET__.room, null, {
    timeout: 30000,
  });
  const room = await host.evaluate(() => window.__GH_NET__.room);
  const hostChecksum = await host.evaluate(() => window.__GH_NET__.checksum);
  log('room', room, 'host checksum', hostChecksum);

  log('checking third-person toggle');
  await host.keyboard.press('F3');
  await host.waitForFunction(() => window.__GH_NET__?.thirdPerson === true, null, { timeout: 10000 });
  const third = await host.evaluate(() => ({
    thirdPerson: window.__GH_NET__.thirdPerson,
    avatarVisible: window.__GH_NET__.avatarVisible,
    gender: window.__GH_NET__.gender,
  }));
  log('third person', JSON.stringify(third));
  if (!third.avatarVisible || third.gender !== 'female') throw new Error('third-person avatar not visible');
  await host.keyboard.press('F3');
  await host.waitForFunction(() => window.__GH_NET__?.thirdPerson === false, null, { timeout: 10000 });

  log('checking invite link and QR');
  await host.keyboard.press('i');
  await host.waitForSelector('#invitePanel:not([hidden])', { timeout: 10000 });
  const invite = await host.evaluate(() => ({
    code: document.getElementById('inviteCode')?.textContent,
    link: document.getElementById('inviteLink')?.value,
    qrBytes: document.getElementById('inviteQr')?.toDataURL?.().length || 0,
  }));
  log('invite', JSON.stringify(invite));
  if (invite.code !== room) throw new Error('invite code does not match room');
  if (!invite.link.includes('?join=' + room)) throw new Error('invite link is missing the room code');
  if (invite.qrBytes < 1000) throw new Error('invite QR code was not rendered');

  const guest = await context.newPage();
  await guest.goto(invite.link, { waitUntil: 'domcontentloaded' });
  await guest.waitForSelector('#menu:not([hidden])', { timeout: 60000 });
  await guest.waitForFunction((code) => document.getElementById('mpCode')?.value === code, room, {
    timeout: 10000,
  });
  log('invite link prefilled the join code');
  await guest.close();
  await host.bringToFront();
  await host.keyboard.press('Escape');
  await host.waitForFunction(() => document.getElementById('invitePanel')?.hidden === true, null, {
    timeout: 10000,
  });

  log('opening client page');
  await client.goto(URL, { waitUntil: 'domcontentloaded' });
  await client.waitForSelector('#menu:not([hidden])', { timeout: 60000 });
  await client.waitForSelector('#mpName', { state: 'visible', timeout: 60000 });
  await client.bringToFront();
  /* give the guest a different avatar so gender sync can be verified */
  await client.evaluate(() => document.querySelector('.genderBtn[data-gender="male"]')?.click());
  await client.waitForTimeout(150);
  const guestPicked = await client.evaluate(() => ({
    pressed: document.querySelector('.genderBtn[data-gender="male"]')?.getAttribute('aria-pressed'),
    stored: localStorage.getItem('grasshopperGender'),
    gender: window.__GH_NET__?.gender,
  }));
  log('client avatar picker', JSON.stringify(guestPicked));
  if (guestPicked.pressed !== 'true' || guestPicked.stored !== 'male' || guestPicked.gender !== 'male') {
    throw new Error('client avatar picker did not persist the male selection');
  }
  /* React controlled inputs: set the native value then dispatch input so the
   * component state updates. This avoids actionability flakiness in a second
   * software-rendered WebGL tab. */
  await client.evaluate(({ name, code }) => {
    const setValue = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue(document.getElementById('mpName'), name);
    setValue(document.getElementById('mpCode'), code);
  }, { name: 'ClientTest', code: room });
  await client.waitForTimeout(200);
  log('joining room');
  await client.evaluate(() => document.getElementById('mpJoin').click());
  await client.waitForURL(/\?mp=1/, { timeout: 60000 });
  /* The host must be the visible tab for its rAF loop to keep simulating and
   * sending snapshots; a background host is a documented limitation. */
  await host.bringToFront();
  try {
    await client.waitForFunction(() => {
      const hud = document.getElementById('hud');
      return !!hud && !hud.hidden;
    }, null, { timeout: 60000 });
  } catch (err) {
    const diag = await client.evaluate(() => ({
      hud: !document.getElementById('hud').hidden,
      state: window.__GH_NET__?.state,
      welcome: window.__GH_NET__?.welcome,
      recent: window.__GH_NET__?.recent,
      counters: window.__GH_NET__?.counters,
      netLost: !document.getElementById('netLost').hidden,
      netLostMsg: document.getElementById('netLostMsg')?.textContent,
      debug: window.__GH_NET__?.debug,
      errorText: document.getElementById('mpStatus')?.textContent,
    }));
    const hdiag = await host.evaluate(() => ({
      remotes: window.__GH_NET__?.remoteCount,
      counters: window.__GH_NET__?.counters,
      debug: window.__GH_NET__?.debug,
      recent: window.__GH_NET__?.recent,
    }));
    log('HUD timeout client', JSON.stringify(diag));
    log('HUD timeout host', JSON.stringify(hdiag));
    throw err;
  }

  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const h = await host.evaluate(() => ({ net: window.__GH_NET__?.debug, connected: window.__GH_NET__?.connected, remotes: window.__GH_NET__?.remoteCount }));
    const c = await client.evaluate(() => ({ net: window.__GH_NET__?.debug, connected: window.__GH_NET__?.connected, remotes: window.__GH_NET__?.remoteCount }));
    log('probe', i, 'host', JSON.stringify(h), 'client', JSON.stringify(c));
    if (h.connected && c.connected && h.remotes >= 1 && c.remotes >= 1) break;
  }

  await waitForNet(host, () => window.__GH_NET__?.connected === true && window.__GH_NET__.remoteCount >= 1, 45000);
  await waitForNet(
    client,
    () => window.__GH_NET__?.connected === true && window.__GH_NET__.remoteCount >= 1,
    45000
  );

  const hostState = await host.evaluate(() => ({
    role: window.__GH_NET__.role,
    room: window.__GH_NET__.room,
    checksum: window.__GH_NET__.checksum,
    remotes: window.__GH_NET__.remotes,
    entities: window.__GH_NET__.entityCount,
  }));
  const clientState = await client.evaluate(() => ({
    role: window.__GH_NET__.role,
    room: window.__GH_NET__.room,
    checksum: window.__GH_NET__.checksum,
    remotes: window.__GH_NET__.remotes,
    entities: window.__GH_NET__.entityCount,
  }));
  log('host state', JSON.stringify(hostState));
  log('client state', JSON.stringify(clientState));

  if (hostState.checksum !== clientState.checksum) {
    throw new Error(`world checksum mismatch: ${hostState.checksum} vs ${clientState.checksum}`);
  }
  if (hostState.remotes.length < 1) throw new Error('host has no remote player');
  if (clientState.remotes.length < 1) throw new Error('client has no host avatar');

  /* world layout: a bridge beside each city river, and two cities per biome */
  const world = await host.evaluate(() => window.__GH_NET__.world);
  const clientWorld = await client.evaluate(() => window.__GH_NET__.world);
  log('world layout', JSON.stringify({
    bridges: world.bridges.length,
    biomeCities: world.biomeCities.length,
    villages: world.villages.length,
  }));
  if (JSON.stringify(world) !== JSON.stringify(clientWorld)) {
    throw new Error('host and client generated different world layouts');
  }
  if (world.bridges.length !== 4) throw new Error(`expected 4 bridges, found ${world.bridges.length}`);
  if (world.homeCities.length !== 6) throw new Error(`expected 6 home cities, found ${world.homeCities.length}`);
  if (world.villages.length !== 12) throw new Error(`expected 12 cities, found ${world.villages.length}`);
  const segDist = (pts, x, z) => {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
    }
    return best;
  };
  for (const b of world.bridges) {
    const hit = world.rivers
      .map((river) => ({ river, d: segDist(river.pts, b.x, b.z) }))
      .sort((a, c) => a.d - c.d)[0];
    if (hit.d > hit.river.w / 2 + 2) {
      throw new Error(`bridge at ${b.x},${b.z} is not on a river (${hit.d.toFixed(1)})`);
    }
    if (b.len < hit.river.w + 10) throw new Error('bridge is too short for its river');
    const city = world.homeCities
      .map((c) => ({ c, d: Math.hypot(c.x - b.x, c.z - b.z) }))
      .sort((a, c) => a.d - c.d)[0];
    if (city.d > 350) {
      throw new Error(`bridge at ${b.x},${b.z} is ${city.d.toFixed(1)} from the nearest city`);
    }
  }
  for (const name of ['desert', 'snow', 'savanna']) {
    const B = world.biomes[name];
    const cities = world.biomeCities.filter((c) => c.biome === name);
    if (cities.length !== 2) throw new Error(`expected 2 ${name} cities, found ${cities.length}`);
    for (const c of cities) {
      if (Math.hypot(c.x - B.x, c.z - B.z) > B.r - 60) {
        throw new Error(`${name} city at ${c.x},${c.z} is outside its island`);
      }
    }
    const villages = world.villages.filter((v) => v.biome === name);
    if (villages.length !== 2) throw new Error(`expected 2 ${name} towns, found ${villages.length}`);
  }

  /* each player's chosen gender must be what the other device sees */
  const hostSeesGuest = hostState.remotes[0];
  const guestSeesHost = clientState.remotes[0];
  log('gender sync host sees', JSON.stringify(hostSeesGuest), 'client sees', JSON.stringify(guestSeesHost));
  if (hostSeesGuest.g !== 'male' || hostSeesGuest.avatarGender !== 'male') {
    throw new Error(`host does not see the guest as male: ${JSON.stringify(hostSeesGuest)}`);
  }
  if (guestSeesHost.g !== 'female' || guestSeesHost.avatarGender !== 'female') {
    throw new Error(`client does not see the host as female: ${JSON.stringify(guestSeesHost)}`);
  }

  /* the host owns the day/night clock */
  const firstDay = await Promise.all([
    host.evaluate(() => window.__GH_NET__.dayT),
    client.evaluate(() => window.__GH_NET__.dayT),
  ]);
  await host.waitForTimeout(1500);
  const secondDay = await Promise.all([
    host.evaluate(() => window.__GH_NET__.dayT),
    client.evaluate(() => window.__GH_NET__.dayT),
  ]);
  const dayDiff = [Math.abs(firstDay[0] - firstDay[1]), Math.abs(secondDay[0] - secondDay[1])];
  log('day sync', JSON.stringify({ host: secondDay[0], client: secondDay[1], diff: dayDiff }));
  if (dayDiff[0] > 0.02 || dayDiff[1] > 0.02) throw new Error(`day/night is out of sync: ${JSON.stringify(dayDiff)}`);

  const before = hostState.remotes[0];
  /* Simulate input through the same client→host path the keyboard uses. The
   * client tab may be backgrounded in headless Chrome, so its rAF loop cannot
   * be relied on to pump input; the host is kept visible to apply it. */
  await host.bringToFront();
  let animSample = null;
  let poseAmp = 0;
  for (let i = 0; i < 30; i++) {
    await client.evaluate(() => window.__GH_NET__.sendInput(0, 1));
    await host.waitForTimeout(150);
    const r = await host.evaluate(() => window.__GH_NET__.remotes[0]);
    poseAmp = Math.max(poseAmp, Math.abs(r.legX || 0), Math.abs(r.armX || 0));
    if (r.netSpeed > 1 && poseAmp > 0.01 && r.walkT > before.walkT + 0.1) {
      animSample = r;
      break;
    }
  }
  await client.evaluate(() => window.__GH_NET__.sendInput(0, 0));
  await host.waitForTimeout(700);

  const after = await host.evaluate(() => window.__GH_NET__.remotes[0]);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  log('remote moved', moved.toFixed(3), before, after);
  log('remote animation', JSON.stringify({ animSample, poseAmp }));
  if (!animSample || animSample.netSpeed < 1 || animSample.walkT < before.walkT + 0.1) {
    throw new Error(`host did not animate the moving remote player: ${JSON.stringify(animSample)}`);
  }
  if (poseAmp < 0.01) throw new Error('remote avatar limbs never moved');
  if (moved < 0.2) {
    const cdiag = await client.evaluate(() => ({
      keys: window.__GH_NET__?.keys,
      focus: window.__GH_NET__?.focus,
      state: window.__GH_NET__?.state,
      counters: window.__GH_NET__?.counters,
      recent: window.__GH_NET__?.recent,
      debug: window.__GH_NET__?.debug,
      wel: window.__GH_NET__?.welcome,
    }));
    log('movement diag', JSON.stringify(cdiag));
    throw new Error('host did not observe client movement');
  }

  /* the reverse direction: the host's avatar must animate on the client too */
  const guestBeforeMove = await client.evaluate(() => window.__GH_NET__.remotes[0]);
  await host.bringToFront();
  const hostStart = await host.evaluate(() => window.__GH_NET__.player);
  await host.keyboard.down('w');
  await host.waitForTimeout(1200);
  /* Keep the host key held while the client comes forward: the last snapshot
   * the client polls still describes a moving host. */
  await client.bringToFront();
  let guestAnim = null;
  let guestPoseAmp = 0;
  for (let i = 0; i < 16; i++) {
    await client.waitForTimeout(250);
    const current = await client.evaluate(() => window.__GH_NET__.remotes[0]);
    guestAnim = current;
    if (current && current.netSpeed > 0.2) {
      const ticked = await client.evaluate(() => {
        let rows = [];
        for (let j = 0; j < 8; j++) rows = window.__GH_NET__.tickRemotes(0.05);
        return { rows, remote: window.__GH_NET__.remotes[0] };
      });
      guestAnim = ticked.remote;
      for (const row of ticked.rows) {
        guestPoseAmp = Math.max(guestPoseAmp, Math.abs(row.legX || 0), Math.abs(row.armX || 0));
      }
      break;
    }
  }
  await host.bringToFront();
  await host.keyboard.up('w');
  const hostEnd = await host.evaluate(() => window.__GH_NET__.player);
  const hostWalked = Math.hypot(hostEnd.x - hostStart.x, hostEnd.z - hostStart.z);
  log('host->guest animation', JSON.stringify({ hostWalked, guestBeforeMove, guestAnim, guestPoseAmp }));
  if (hostWalked < 0.2) throw new Error('host did not move for the animation test');
  if (!guestAnim || guestPoseAmp < 0.01 || guestAnim.walkT < guestBeforeMove.walkT + 0.1) {
    throw new Error(`client did not animate the host avatar: ${JSON.stringify(guestAnim)}`);
  }

  log('reloading client to test rejoin');
  await client.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await host.bringToFront();
  await client.waitForSelector('#hud:not([hidden])', { timeout: 60000 });
  await waitForNet(
    client,
    () => window.__GH_NET__?.connected === true && window.__GH_NET__.remoteCount >= 1,
    45000
  );
  await waitForNet(host, () => window.__GH_NET__?.remoteCount >= 1, 30000);
  log('client rejoined');

  log('leaving the room from the client and checking peer cleanup');
  await client.bringToFront();
  await client.keyboard.press('i');
  await client.waitForSelector('#invitePanel:not([hidden])', { timeout: 10000 });
  await client.click('#inviteCloseRoom');
  await host.bringToFront();
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const h = await host.evaluate(() => ({
      remotes: window.__GH_NET__.remoteCount,
      connected: window.__GH_NET__.connected,
      debug: window.__GH_NET__.debug,
    }));
    log('cleanup probe', i, JSON.stringify(h));
    if (h.remotes === 0) break;
  }
  await host.waitForFunction(() => window.__GH_NET__.remoteCount === 0, null, { timeout: 15000 });
  if (errors.length) {
    log('page errors', errors);
    throw new Error(errors[0]);
  }

    log('PASS room=', room, 'checksum=', hostState.checksum, 'entityCount=', hostState.entities);
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
}

main().catch(async (err) => {
  console.error('[browser] FAIL', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
