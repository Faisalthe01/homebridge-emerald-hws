const EmeraldClient = require('./lib/EmeraldClient');
const EmeraldHwsAccessory = require('./lib/EmeraldHwsAccessory');

const PLATFORM_NAME = 'EmeraldHws';
const PLUGIN_NAME = 'homebridge-emerald-hws';

class EmeraldHwsPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.accessories = new Map();
    this.client = null;

    if (!config || !config.email || !config.password) {
      this.log.error('EmeraldHws: email and password required.');
      return;
    }

    this.client = new EmeraldClient(this.log, config);
    // Ensure poll interval is at least 15 seconds
    this.pollInterval = Math.max(config.pollInterval || 60, 15);

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
    let devices;
    try {
      devices = await this.client.discoverDevices();
    } catch (e) {
      this.log.error('Discover failed:', e.message);
      return;
    }

    const { uuid } = this.api.hap;

    for (const dev of devices) {
      const id = dev.id;
      const name = dev.name;
      const accUUID = uuid.generate('emerald-hwsys:' + id);
      let accessory = this.accessories.get(accUUID);

      if (!accessory) {
        accessory = new this.api.platformAccessory(name, accUUID);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(accUUID, accessory);
      }

      // Fetch initial status before constructing accessory
      let initialStatus = {};
      try {
        initialStatus = await this.client.getStatus(dev.id);
      } catch (e) {
        this.log.error(`Failed to get initial status for ${dev.id}:`, e.message);
      }

      // Pass initial status into accessory constructor
      // The Accessory class starts its own safe poll loop in its constructor.
      // We do NOT call startPolling here anymore.
      try {
        new EmeraldHwsAccessory(
            this,
            accessory,
            dev,
            initialStatus,
            this.client
        );
      } catch (err) {
        this.log.error(`Failed to initialize accessory ${name}:`, err.message);
      }
    }
  }
}

module.exports = api => api.registerPlatform(PLATFORM_NAME, EmeraldHwsPlatform);
