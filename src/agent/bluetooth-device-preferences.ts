/**
 * BluetoothDevicePreferences – Store per-device mode preferences
 *
 * Each Bluetooth audio device can have its own preferred mode (driving/normal).
 * Preferences are stored in AsyncStorage as JSON.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'bluetooth_device_preferences';

interface DevicePreferences {
  [deviceAddress: string]: {
    preferredMode: 'driving' | 'normal';
    deviceName: string;
  };
}

/**
 * Get the preferred mode for a device.
 * Returns 'driving' by default if device not found.
 */
export async function getDevicePreferredMode(
  deviceAddress: string,
): Promise<'driving' | 'normal'> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    if (!json) {
      return 'driving'; // Default to driving mode
    }
    const prefs: DevicePreferences = JSON.parse(json);
    return prefs[deviceAddress]?.preferredMode ?? 'driving';
  } catch {
    return 'driving'; // Default on error
  }
}

/**
 * Set the preferred mode for a device.
 */
export async function setDevicePreferredMode(
  deviceAddress: string,
  deviceName: string,
  preferredMode: 'driving' | 'normal',
): Promise<void> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    const prefs: DevicePreferences = json ? JSON.parse(json) : {};
    prefs[deviceAddress] = {
      preferredMode,
      deviceName,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Silently fail - preferences are not critical
  }
}

/**
 * Get all device preferences.
 */
export async function getAllDevicePreferences(): Promise<DevicePreferences> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}
