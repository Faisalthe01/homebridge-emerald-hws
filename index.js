const EmeraldClient = require('./lib/EmeraldClient');
const EmeraldHwsAccessory = require('./lib/EmeraldHwsAccessory');

const PLATFORM_NAME = 'EmeraldHws';
const PLUGIN_NAME = 'homebridge-emerald-hws';

class EmeraldHwsPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.accessories = new Map();

    // 🚨 1. Config missing entirely
    if (!config) {
      this.log.warn('EmeraldHws: No configuration found. Plugin disabled.');
      return; // ← SAFE RETURN
    }

    // Store config safely
    this.config = config;

    // 🚨 2. Missing required auth values
    if (!config.email || !config.password) {
      this.log.error(
        'EmeraldHws: "email" and "password" are required in config.json. ' +
        'Plugin will not load until these are added.'
      );
      return; // ← SAFE RETURN (NO CRASH)
    }

    // 🚨 3. Invalid poll interval → enforce minimum 15s
    this.pollInterval = Number(config.pollInterval);
    if (isNaN(this.pollInterval) || this.pollInterval < 15) {
      this.pollInterval = 60;
      this.log.warn('EmeraldHws: pollInterval invalid or too low. Using default 60 seconds.');
    }

    // 🚨 4. pythonPath missing → default to python3
    this.pythonPath = config.pythonPath || 'python3';

    // Create client (wrapped in try/catch so constructor errors never crash HB)
    try {
      this.client = new EmeraldClient(this.log, config);
    } catch (err) {
      this.log.error('EmeraldHws: Failed to initialize client:', err.message);
      return; // ← SAFE RETURN
    }

    // Only run discovery once Homebridge has fully loaded
    api.on('didFinishLaunching', () => {
      this.log.info('EmeraldHws: discovering devices...');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    if (accessory.context.firmware) {
      const infoService = accessory.getService(this.api.hap.Service.AccessoryInformation);

      if (infoService) {
        infoService.setCharacteristic(
          this.api.hap.Characteristic.FirmwareRevision,
          accessory.context.firmware
        );
      }
    }

    this.accessories.set(accessory.UUID, accessory);
  }

  async discoverDevices() {
    if (!this.client) {
      this.log.error('EmeraldHws: Client not initialized. Discovery aborted.');
      return; // ← SAFE RETURN
    }

    let devices;
    try {
      devices = await this.client.discoverDevices();
    } catch (e) {
      this.log.error('EmeraldHws: Device discovery failed:', e.message);
      return; // ← SAFE RETURN
    }

    const { uuid } = this.api.hap;

    for (const dev of devices || []) {
      const id = dev.id;
      const name = dev.name;
      const accUUID = uuid.generate('emerald-hwsys:' + id);
      let accessory = this.accessories.get(accUUID);

      if (!accessory) {
        accessory = new this.api.platformAccessory(name, accUUID);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(accUUID, accessory);
      }

      // Fetch initial status safely
      let initialStatus = {};
      try {
        initialStatus = await this.client.getStatus(dev.id);
      } catch (e) {
        this.log.error(`EmeraldHws: Failed to get initial status for ${dev.id}:`, e.message);
      }

      try {
        const wrapper = new EmeraldHwsAccessory(
          this,
          accessory,
          dev,
          initialStatus,
          this.client
        );
        this.startPolling(wrapper);
      } catch (err) {
        this.log.error(`EmeraldHws: Failed to create accessory for ${id}:`, err.message);
      }
    }
  }

  startPolling(wrapper) {
    if (!wrapper || !wrapper.refreshFromCloud) {
      this.log.error('EmeraldHws: Polling failed — invalid wrapper object.');
      return;
    }

    setInterval(() => {
      try {
        wrapper.refreshFromCloud();
      } catch (err) {
        this.log.error('EmeraldHws: Polling error:', err.message);
      }
    }, this.pollInterval * 1000);
  }
}

module.exports = api => api.registerPlatform(PLATFORM_NAME, EmeraldHwsPlatform);
