const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class EmeraldClient {
  constructor(log, config) {
    this.log = log;
    this.email = config.email;
    this.password = config.password;

    // Hard-coded python path (Your original behaviour)
    this.python = '/usr/bin/python3';

    // Path to Python script
    this.scriptPath = path.join(__dirname, '..', 'python', 'emerald_daemon.py');

    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';

    // Start daemon immediately (your requirement)
    this.startDaemon();
  }

  startDaemon() {
    const args = [
      this.scriptPath,
      '--email', this.email,
      '--password', this.password
    ];

    const sudoPath = '/usr/bin/sudo';

    let cmd = 'sudo';
    let spawnArgs = ['-u', 'homebridge', this.python, ...args];

    //
    // IMPORTANT FIX:
    // Homebridge Plugin Checker sandbox does NOT have sudo or homebridge user.
    // If sudo is unavailable → fall back to running python directly.
    //
    if (!fs.existsSync(sudoPath)) {
      cmd = this.python;
      spawnArgs = [this.scriptPath, '--email', this.email, '--password', this.password];
      this.log.warn('EmeraldHws: sudo not available, running python directly (safe fallback).');
    }

    this.log.info('EmeraldHws: starting python daemon...');

    //
    // CRITICAL FIX:
    // Wrap spawn() in try/catch, but ALSO attach an 'error' listener.
    //
    try {
      this.proc = spawn(cmd, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      // Synchronous spawn() failure
      this.log.error('EmeraldHws: spawn() failed:', err.message);
      return;
    }

    //
    // NON-NEGOTIABLE FIX:
    // If spawn emits an async "error" event and no handler exists,
    // Node crashes → Homebridge Plugin Checker FAILS startup.
    //
    this.proc.on('error', (err) => {
      this.log.error('EmeraldHws: python daemon failed to start:', err.message);
    });

    //
    // STDOUT handler
    //
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString();

      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;

        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          this.log.error('EmeraldHws: bad JSON from python:', line);
          continue;
        }

        const entry = this.pending.get(msg.id);
        if (!entry) continue;

        this.pending.delete(msg.id);

        if (msg.ok === false) entry.reject(new Error(msg.error || 'Python error'));
        else entry.resolve(msg.result);
      }
    });

    //
    // STDERR handler (debug only)
    //
    this.proc.stderr.on('data', (chunk) => {
      const t = chunk.toString().trim();
      if (t) this.log.debug('emerald-hws(py):', t);
    });

    //
    // EXIT HANDLER
    //
    this.proc.on('exit', (code, signal) => {
      this.log.error(`EmeraldHws: python daemon exited (code=${code}, signal=${signal})`);
      for (const { reject } of this.pending.values()) {
        reject(new Error('Python daemon exited'));
      }
      this.pending.clear();
    });
  }

  //
  // Standard command wrapper
  //
  sendCommand(cmd, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this.proc || this.proc.killed)
        return reject(new Error('Python daemon not running'));

      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });

      const msg = JSON.stringify({ id, cmd, ...payload }) + '\n';

      this.proc.stdin.write(msg, 'utf8', (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async discoverDevices() {
    return this.sendCommand('discover');
  }

  async getStatus(id) {
    return this.sendCommand('status', { hws_id: id });
  }

  async setMode(id, mode) {
    return this.sendCommand('set_mode', { hws_id: id, mode });
  }

  async turnOn(id) {
    return this.sendCommand('turn_on', { hws_id: id });
  }

  async turnOff(id) {
    return this.sendCommand('turn_off', { hws_id: id });
  }
}

module.exports = EmeraldClient;
