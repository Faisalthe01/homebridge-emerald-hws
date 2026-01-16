const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class EmeraldClient {
  constructor(log, config) {
    this.log = log;
    this.email = config.email;
    this.password = config.password;
    this.python = config.pythonPath || 'python3';
    this.scriptPath = path.join(__dirname, '..', 'python', 'emerald_daemon.py');

    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.proc = null;
    
    // Auto-restart counter
    this.restartCount = 0;
    
    this.startDaemon();
  }

  startDaemon() {
    if (this.proc && !this.proc.killed) return;

    // Safety: Prevent rapid crash loops (5 restarts in 1 min)
    if (this.restartCount > 5) {
        this.log.error("EmeraldHws: Too many crashes. Giving up for safety.");
        return;
    }

    const args = [this.scriptPath, '--email', this.email, '--password', this.password];
    
    // CHANGED: "starting..." is now DEBUG (Hidden) so it doesn't spam you every 10 mins
    this.log.debug('EmeraldHws: launching python daemon...');

    try {
      this.proc = spawn(this.python, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      this.log.error('EmeraldHws: spawn() failed:', err.message);
      return;
    }

    // Reset crash counter if process stays alive for 1 minute
    setTimeout(() => { this.restartCount = 0; }, 60000);

    this.proc.stderr.on('data', (chunk) => {
      this.log.debug('emerald-hws(py):', chunk.toString().trim());
    });

    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString();
      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;

        let msg;
        try { msg = JSON.parse(line); } catch { continue; }

        const entry = this.pending.get(msg.id);
        if (entry) {
          this.pending.delete(msg.id);
          if (msg.ok === false) entry.reject(new Error(msg.error));
          else entry.resolve(msg.result);
        }
      }
    });

    this.proc.on('exit', (code) => {
      // Code 0 means "Scheduled 10m Restart" (Clean) -> We HIDE this.
      // Code 1 means "Error" (Crash) -> We SHOW this.
      if (code === 0) {
          this.log.debug('EmeraldHws: Scheduled maintenance restart.');
      } else {
          this.log.warn(`EmeraldHws: python exited (code ${code}). Restarting...`);
          this.restartCount++;
      }
      
      this.proc = null;
      
      for (const { reject } of this.pending.values()) {
        reject(new Error('Daemon exited'));
      }
      this.pending.clear();

      // Restart in 2 seconds (Standard logic, no "already restarted" warning)
      setTimeout(() => this.startDaemon(), 2000);
    });
  }

  sendCommand(cmd, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this.proc) {
        // This error message is used in the Accessory to detect the restart
        return reject(new Error('Python daemon starting...'));
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ id, cmd, ...payload }) + '\n';
      try {
        this.proc.stdin.write(msg);
      } catch (e) {
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  async discoverDevices() { return this.sendCommand('discover'); }
  async getStatus(id) { return this.sendCommand('status', { hws_id: id }); }
  async setMode(id, mode) { return this.sendCommand('set_mode', { hws_id: id, mode }); }
  async turnOn(id) { return this.sendCommand('turn_on', { hws_id: id }); }
  async turnOff(id) { return this.sendCommand('turn_off', { hws_id: id }); }
}

module.exports = EmeraldClient;
