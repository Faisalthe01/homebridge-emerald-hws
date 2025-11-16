# homebridge-emerald-hws
Homebridge plugin for Emerald Heat Pump Hot Water Systems.  
Provides monitoring and basic control of the Emerald HWS through Apple HomeKit.

<img src="./images/Emerald-HWS.png" width="320"/>

---

## Features

- Turn heating on or off  
- View current tank temperature  
- View target temperature (read-only)  
- Turn Boost Mode on or off  
- View water level (exposed as a humidity sensor)  
- Report online/offline system status  
- Uses the standard HomeKit Heater/Cooler service with additional accessories where appropriate

---

## HomeKit Screenshots

### Main Control Interface
<img src="./images/screenshot-main.jpg" width="300"/>

### Accessory Tiles
<img src="./images/screenshot-tiles.jpg" width="300"/>

---

## Requirements

### Python 3.9 or newer  
This plugin relies on the `emerald_hws_py` Python library, which requires Python to be installed on the system running Homebridge.

#### Install Python on Debian/Ubuntu (including Raspberry Pi OS)
Update packages and install Python:

```bash
sudo apt update
sudo apt install -y python3 python3-pip
```

Confirm installation:

```bash
python3 --version
pip3 --version
```

#### Homebridge (hb-service) installations  
When Homebridge is installed using hb-service, Python must still be installed system-wide using the commands above.  
The library will then be installed under the Homebridge user.

---

### emerald_hws_py Python library  
This library must be installed under the Homebridge service user on systems where Homebridge is run using a dedicated service user (commonly homebridge).
It should not be installed as root.

Install:

```bash
sudo -u homebridge pip3 install emerald_hws
```

Verify:

```bash
sudo -u homebridge python3 -c "import emerald_hws"
```

If no output or errors appear, the installation is correct.

---

## Installation

Install the plugin:

```bash
sudo npm install -g homebridge-emerald-hws
```

---

## Configuration

Add the following to your Homebridge `config.json`:

```json
{
  "platform": "EmeraldHWS",
  "devices": [
    {
      "name": "Emerald HWS",
      "username": "YOUR_EMERALD_EMAIL",
      "password": "YOUR_EMERALD_PASSWORD",
      "pollInterval": 60
    }
  ]
}
```

### Configuration Options

| Key            | Description |
|----------------|-------------|
| `name`         | Accessory display name in HomeKit |
| `username`     | Emerald account email |
| `password`     | Emerald account password |
| `pollInterval` | Data refresh interval in seconds (default and recommended: 60) |

---

## How It Works

This plugin communicates with the Emerald cloud API through the  
`emerald_hws_py` Python library.

The plugin retrieves:

- Current tank temperature  
- Target temperature (read-only)  
- Water level  
- Heating state  
- Boost state  
- Online/offline availability  

It can also send commands to control heating and Boost Mode.

All data is exposed to HomeKit using standard HomeKit services.  
If the system becomes unreachable, the accessory will report "No Response" until the next successful update.

---

## Troubleshooting

### emerald_hws_py not found  
Install under the Homebridge user:

```bash
sudo -u homebridge pip3 install emerald_hws_py
```

### Python not in Homebridge PATH  
Edit the service file:

```
sudo nano /etc/systemd/system/homebridge.service
```

Add the following line:

```
Environment=PATH=/usr/bin:/usr/local/bin
```

Reload:

```bash
sudo systemctl daemon-reload
sudo systemctl restart homebridge
```

### Frequent "No Response"
Increase the polling interval:

```json
"pollInterval": 60
```

---

## Acknowledgements

This plugin relies on the `emerald_hws_py` Python library created and maintained by  
**ross-w**: https://github.com/ross-w/emerald_hws_py

Without this library, Homebridge integration for Emerald HWS would not be possible.

---

## License  
MIT License
