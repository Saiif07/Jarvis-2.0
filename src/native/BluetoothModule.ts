/**
 * TypeScript bridge for BluetoothModule native module
 */
import { NativeModules, NativeEventEmitter } from 'react-native';

const { BluetoothModule } = NativeModules;

export interface BluetoothAudioStatus {
  connected: boolean;
  deviceName?: string;
  deviceAddress?: string;
}

export interface BluetoothModuleType {
  getBluetoothAudioStatus(): Promise<BluetoothAudioStatus>;
  startMonitoring(): Promise<string>;
  stopMonitoring(): Promise<string>;
}

export interface BluetoothAudioConnectedEvent {
  deviceName: string;
  deviceAddress: string;
}

export interface BluetoothAudioDisconnectedEvent {
  deviceName: string;
  deviceAddress: string;
}

export const BluetoothEvents = new NativeEventEmitter(BluetoothModule);

export default BluetoothModule as BluetoothModuleType;
